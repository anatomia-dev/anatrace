import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyze.js';
import { resolvePack } from '../src/registry.js';
import { applyIgnores } from '../src/config.js';
import type { Config, Finding } from '../src/types.js';
import type { NormalizedSession, SessionEvent } from '../src/session.js';
import type { ProvenanceCounts } from '../src/provenance.js';

function counts(model: string): ProvenanceCounts {
  return {
    tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0 },
    price_table_version: '2026-06-08',
    derive_version: '1',
    duration_ms: 0,
    turns: 0,
    tool_calls: 0,
    commands_run: 0,
    tests_executed: 0,
    failures_encountered: 0,
    files_touched: 0,
    model,
  };
}

function session(events: SessionEvent[], harness: 'claude' | 'codex' = 'claude'): NormalizedSession {
  return {
    schemaVersion: 1,
    harness,
    sessionId: 's',
    observedVersions: ['1.0.0'],
    subagents: [],
    events,
    counts: counts('claude-opus-4-8'),
  };
}

// One Codex interrupt + one Claude isError → exactly two friction findings (both default `warn`).
const frictionEvents: SessionEvent[] = [
  { type: 'interrupt', reason: 'interrupted', agent: { kind: 'root' }, blobName: 'p', lineIndex: 0 },
  { type: 'toolResult', text: 'boom', isError: true, agent: { kind: 'root' }, blobName: 'p', lineIndex: 1 },
];

describe('A1 — analyze consumes Config', () => {
  it('default (no config) is byte-identical to R2 (determinism guard)', () => {
    const withUndef = analyze(session(frictionEvents));
    const withEmpty = analyze(session(frictionEvents), undefined);
    expect(JSON.stringify(withUndef)).toBe(JSON.stringify(withEmpty));
    expect(withUndef.findings.map((f) => f.severity)).toEqual(['warn', 'warn']);
  });

  it('an `off` rule does not fire', () => {
    const config: Config = { schemaVersion: 1, rules: { interrupt: 'off' } };
    const report = analyze(session(frictionEvents), config);
    expect(report.findings.map((f) => f.ruleId)).toEqual(['claude-tool-failure']);
  });

  it('a severity override changes the stamped severity', () => {
    const config: Config = { schemaVersion: 1, rules: { 'claude-tool-failure': 'error' } };
    const report = analyze(session(frictionEvents), config);
    const tf = report.findings.find((f) => f.ruleId === 'claude-tool-failure');
    const intr = report.findings.find((f) => f.ruleId === 'interrupt');
    expect(tf?.severity).toBe('error'); // overridden
    expect(intr?.severity).toBe('warn'); // untouched default
  });

  it('the `[severity, options]` tuple form resolves severity', () => {
    const config: Config = { schemaVersion: 1, rules: { interrupt: ['info', { foo: 1 }] } };
    const report = analyze(session(frictionEvents), config);
    expect(report.findings.find((f) => f.ruleId === 'interrupt')?.severity).toBe('info');
  });

  it('`ignores` is a no-op on the location-less friction findings (determinism preserved)', () => {
    const config: Config = { schemaVersion: 1, ignores: ['packages/'] };
    expect(analyze(session(frictionEvents), config).findings.length).toBe(2);
  });

  it('applyIgnores drops findings at/under an ignore path, keeps the rest', () => {
    const findings: Finding[] = [
      { ruleId: 'r', severity: 'warn', message: 'a', location: { file: 'src/a.ts' } }, // under src/ → drop
      { ruleId: 'r', severity: 'warn', message: 'b', location: { file: 'src/sub/b.ts' } }, // under src/ → drop
      { ruleId: 'r', severity: 'warn', message: 'c', location: { file: 'other/c.ts' } }, // keep
      { ruleId: 'r', severity: 'warn', message: 'd' }, // no location → keep
      { ruleId: 'r', severity: 'warn', message: 'e', location: { file: 'src' } }, // exact match → drop
      { ruleId: 'r', severity: 'warn', message: 'f', location: { file: 'srcfoo/x.ts' } }, // NOT under src/ → keep
    ];
    const kept = applyIgnores(findings, { schemaVersion: 1, ignores: ['src'] });
    expect(kept.map((f) => f.message).sort()).toEqual(['c', 'd', 'f']);
    expect(applyIgnores(findings, { schemaVersion: 1 }).length).toBe(6); // empty ignores → no-op
  });

  it('resolvePack defaults to recommended (= friction); unknown extends are ignored', () => {
    expect(resolvePack().map((r) => r.id).sort()).toEqual(['claude-tool-failure', 'interrupt']);
    expect(resolvePack({ schemaVersion: 1, extends: ['nope'] }).length).toBe(0);
    expect(
      resolvePack({ schemaVersion: 1, extends: ['recommended', 'friction'] }).map((r) => r.id).sort(),
    ).toEqual(['claude-tool-failure', 'interrupt']); // de-duped across packs
  });
});

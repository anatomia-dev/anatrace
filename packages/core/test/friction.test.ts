import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyze.js';
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

describe('A8 — friction rules via analyze()', () => {
  it('one Codex interrupt + one Claude isError toolResult → exactly 2 findings', () => {
    const events: SessionEvent[] = [
      { type: 'interrupt', reason: 'interrupted', agent: { kind: 'root' }, blobName: 'p', lineIndex: 0 },
      { type: 'toolResult', text: 'boom', isError: true, agent: { kind: 'root' }, blobName: 'p', lineIndex: 1 },
    ];
    const report = analyze(session(events));
    expect(report.findings.length).toBe(2);
    expect(report.findings.map((f) => f.ruleId).sort()).toEqual(['claude-tool-failure', 'codex-interrupt']);
  });

  it('a clean session → 0 findings, with a populated session summary', () => {
    const events: SessionEvent[] = [
      { type: 'message', role: 'assistant', model: 'claude-opus-4-8', agent: { kind: 'root' }, blobName: 'p', lineIndex: 0 },
      { type: 'toolResult', text: 'ok', isError: false, agent: { kind: 'root' }, blobName: 'p', lineIndex: 1 },
    ];
    const report = analyze(session(events));
    expect(report.findings.length).toBe(0);
    expect(report.session.harness).toBe('claude');
    expect(report.session.model).toBe('claude-opus-4-8');
    expect(report.schemaVersion).toBe(1);
  });
});

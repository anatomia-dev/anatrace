/**
 * CLI render coverage — the P0.6 honesty breadcrumb in `renderPretty`: an out-of-range harness
 * version and a suspect parse must surface as visible ⚠ lines, and a clean current session must not.
 */
import { describe, it, expect } from 'vitest';
import { analyze, claudeAdapter, codexAdapter } from 'anatrace-core';
import type { Report, ComplianceVerdict, Finding } from 'anatrace-core';
import { renderPretty } from '../src/render.js';

/** A minimal Report for unit-testing the verdict headline / ledger without a full session. */
function mkReport(opts: {
  compliance?: ComplianceVerdict[];
  version?: string;
  findings?: Finding[];
}): Report {
  return {
    schemaVersion: 2,
    session: {
      harness: 'claude',
      model: 'claude-opus-4-8',
      sessionId: 's',
      observedVersions: opts.version ? [opts.version] : ['2.1.170'],
      counts: {
        tokens: { input: 10, output: 20, cache_create: 0, cache_read: 0 },
        turns: 1, tool_calls: 1, tool_errors: 0, commands_run: 1, files_touched: 0, edits: 0,
      } as Report['session']['counts'],
    },
    findings: opts.findings ?? [],
    ...(opts.compliance ? { compliance: opts.compliance } : {}),
  };
}
const v = (claimId: string, status: ComplianceVerdict['status'], reason: ComplianceVerdict['reason']): ComplianceVerdict =>
  ({ claimId, status, reason, evidence: [], source: 'deterministic' });
const headline = (r: Report): string => renderPretty(r).split('\n')[0]!;

describe('N1 — the verdict-leading front door (headline worst-wins + refuse-green)', () => {
  it('LEADS with the verdict line (always the first line)', () => {
    expect(headline(mkReport({}))).toMatch(/^anatrace — VERDICT:/);
  });

  it('worst-wins: VIOLATED outranks UNVERIFIABLE even when both are present', () => {
    const r = mkReport({ compliance: [v('a', 'violated', 'predicate-not-matched'), v('b', 'unverifiable', 'codex-blind'), v('c', 'satisfied', 'predicate-matched')] });
    expect(headline(r)).toContain('✗ VIOLATED');
    expect(headline(r)).not.toContain('UNVERIFIABLE');
  });

  it('UNVERIFIABLE refuses green (no violations, but something could not be proven)', () => {
    const r = mkReport({ compliance: [v('a', 'unverifiable', 'delegate-coverage-incomplete'), v('b', 'satisfied', 'predicate-matched')] });
    expect(headline(r)).toContain('⚠ UNVERIFIABLE');
  });

  it('ALL CLEAR only when every claim is satisfied AND evidence is not degraded', () => {
    expect(headline(mkReport({ compliance: [v('a', 'satisfied', 'predicate-matched')] }))).toContain('✓ ALL CLEAR');
  });

  it('an all-satisfied mandate over a DEGRADED transcript does NOT go green', () => {
    const r = mkReport({ compliance: [v('a', 'satisfied', 'predicate-matched')], version: '3.0.0' });
    expect(headline(r)).toContain('⚠ DEGRADED EVIDENCE');
    expect(headline(r)).not.toContain('ALL CLEAR');
  });

  it('a clean BARE run (no mandate) says "nothing to verify", not a fake green', () => {
    const h = headline(mkReport({}));
    expect(h).toContain('no mandate');
    expect(h).not.toContain('CLEAR');
  });

  it('a DEGRADED bare run (no mandate, out-of-range version) REFUSES green', () => {
    expect(headline(mkReport({ version: '3.0.0' }))).toContain('⚠ DEGRADED EVIDENCE');
  });

  it('keeps violated and unverifiable visibly DISTINCT in the ledger (never collapsed)', () => {
    const out = renderPretty(mkReport({ compliance: [v('a', 'violated', 'predicate-not-matched'), v('b', 'unverifiable', 'codex-blind')] }));
    expect(out).toContain('✗ violated: 1');
    expect(out).toContain('⚠ unverifiable: 1');
  });

  it('aggregates friction by ruleId instead of dumping every line', () => {
    const f = (ruleId: string): Finding => ({ ruleId, severity: 'info', message: 'x' });
    const out = renderPretty(mkReport({ findings: [f('tool-failure'), f('tool-failure'), f('interrupt')] }));
    expect(out).toContain('friction (3): tool-failure×2 · interrupt×1');
  });
});

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (o: unknown[]): string => o.map((x) => JSON.stringify(x)).join('\n');

function claudeAtVersion(version: string): ReturnType<typeof analyze> {
  const session = claudeAdapter.parse([
    {
      name: 'parent',
      bytes: enc(
        jsonl([
          {
            type: 'assistant', version, uuid: 'a1', timestamp: '2026-06-08T00:00:01.000Z', sessionId: 's',
            message: {
              id: 'm1', role: 'assistant', model: 'claude-opus-4-8',
              content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } }],
              usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          },
        ]),
      ),
    },
  ])!;
  return analyze(session);
}

describe('renderPretty — P0.6 harness-version & parse-health breadcrumb', () => {
  it('an out-of-major version surfaces ⚠ harness version unrecognized', () => {
    const out = renderPretty(claudeAtVersion('3.0.0'));
    expect(out).toContain('harness version unrecognized');
  });

  it('a current 2.1.x version does NOT surface the version warning', () => {
    const out = renderPretty(claudeAtVersion('2.1.170'));
    expect(out).not.toContain('harness version unrecognized');
    expect(out).not.toContain('parse suspect');
  });

  it('a non-empty transcript that parsed to ZERO events surfaces ⚠ parse suspect', () => {
    const session = codexAdapter.parse([
      {
        name: 'parent',
        bytes: enc(
          jsonl([
            { type: 'session_meta', payload: { id: 'P', cli_version: '0.139.0', cwd: '/r' } },
            { timestamp: '2026-06-13T12:00:02.000Z', type: 'response_item', payload: { type: 'renamed_event_v2', cmd: 'git push --force' } },
          ]),
        ),
      },
    ])!;
    const out = renderPretty(analyze(session));
    expect(out).toContain('parse suspect');
  });
});

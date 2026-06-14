/**
 * P0.8 (Phase 0, Step 8) — the shared absence gate closes the cardinal-sin path.
 *
 * A within-range misparse (e.g. a renamed event type the parser silently skips) yields a non-empty
 * transcript that parses to ZERO structured events. Before this gate, a forbidden-command
 * `not_contains "git push --force"` over such a session found no command events → `satisfied`: a
 * FALSE PASS on a forbidden check (the cardinal sin). The absence gate now degrades absence-based
 * verdicts to `unverifiable(session-parse-suspect)` when `parseHealth` is suspect — but must NOT
 * over-abstain on a legitimately short (but healthy) session.
 */
import { describe, it, expect } from 'vitest';
import { codexAdapter } from '../src/adapters/codex.js';
import { verdictForClaim } from '../src/verdict.js';
import type { CheckableClaim } from '../src/mandate.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

function forbiddenCommandClaim(value: string): CheckableClaim {
  return {
    id: `cmd:${value}`,
    says: `must not run ${value}`,
    kind: 'command-run',
    scope: { kind: 'whole-session' },
    source: { kind: 'in-blob', blob: 'agents/ana-verify.md', fidelity: 'verbatim' },
    predicate: { target: 'command-content', matcher: 'not_contains', scope: 'transcript', value },
  };
}

// A NON-EMPTY Codex transcript whose events use an UNRECOGNIZED payload type → the parser produces
// ZERO structured events (a within-range misparse / format drift). session_meta is metadata, not an
// event, so events.length === 0 while the input clearly carried bytes.
const misparsedCodex = jsonl([
  { type: 'session_meta', payload: { id: 'P-misparse', cli_version: '0.139.0', cwd: '/repo' } },
  { timestamp: '2026-06-13T12:00:02.000Z', type: 'response_item', payload: { type: 'tool_invocation_v2_RENAMED', tool: 'shell', cmd: 'git push --force origin main' } },
  { timestamp: '2026-06-13T12:00:03.000Z', type: 'response_item', payload: { type: 'tool_invocation_v2_RENAMED', tool: 'shell', cmd: 'rm -rf /' } },
]);

// A legitimately SHORT but healthy session: one recognized exec_command, no force-push.
const healthyTinyCodex = jsonl([
  { type: 'session_meta', payload: { id: 'P-tiny', cli_version: '0.139.0', cwd: '/repo' } },
  { timestamp: '2026-06-13T12:00:02.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'git status --porcelain' }), call_id: 'c1' } },
]);

describe('P0.8 — the absence gate closes the zero-event false-PASS', () => {
  it('PRECONDITION: the misparse yields parseHealth = non-empty input, ZERO structured events', () => {
    const s = codexAdapter.parse([{ name: 'parent', bytes: enc(misparsedCodex) }]);
    expect(s).not.toBeNull();
    expect(s!.parseHealth).toBeDefined();
    expect(s!.parseHealth!.inputNonEmpty).toBe(true);
    expect(s!.parseHealth!.structuredEventCount).toBe(0);
    expect(s!.parseHealth!.tokenTotalSuspect).toBe(false); // NOT the gating signal
  });

  it('CARDINAL SIN CLOSED: a misparsed forbidden-command session → unverifiable(session-parse-suspect), NOT satisfied', () => {
    const s = codexAdapter.parse([{ name: 'parent', bytes: enc(misparsedCodex) }])!;
    const v = verdictForClaim(forbiddenCommandClaim('git push --force'), s);
    expect(v).toMatchObject({ status: 'unverifiable', reason: 'session-parse-suspect' });
    expect(v.status).not.toBe('satisfied');
  });

  it('NO OVER-ABSTAIN: a healthy short session (≥1 event) verifies normally — absence stands', () => {
    const s = codexAdapter.parse([{ name: 'parent', bytes: enc(healthyTinyCodex) }])!;
    expect(s.parseHealth!.structuredEventCount).toBeGreaterThan(0);
    const v = verdictForClaim(forbiddenCommandClaim('git push --force'), s);
    expect(v.status).toBe('satisfied'); // no force-push ran; absence is provable on a healthy parse
  });

  it('gate is parse-suspect-FIRST: a misparse abstains even though no command channel exists to flag', () => {
    // The post-dispatch coverage gate keys on command-execution; a zero-event session has no such
    // channel gap, so ONLY the parse-suspect check catches it. Reason must be session-parse-suspect.
    const s = codexAdapter.parse([{ name: 'parent', bytes: enc(misparsedCodex) }])!;
    const v = verdictForClaim(forbiddenCommandClaim('rm -rf'), s);
    expect(v.reason).toBe('session-parse-suspect');
  });
});

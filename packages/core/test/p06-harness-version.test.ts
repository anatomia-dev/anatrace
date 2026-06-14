/**
 * P0.6 (Phase 0, Step 5) — wire the observed harness version into a fail-loud signal, and stop the
 * CC `toolUseId`-drift false gap. The version floor is a COARSE catastrophic check (whole-major
 * drift) — it must NOT false-fire on current 2.1.x / 0.13x sessions, and being in-range must NOT
 * imply trust (within-major drift is the absence gate's job, Step 8).
 */
import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { verdictForClaim } from '../src/verdict.js';
import { harnessVersionStatus, harnessVersionAtLeast, parseSemver } from '../src/harness-support.js';
import type { CheckableClaim } from '../src/mandate.js';
import type { NormalizedSession } from '../src/session.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

/** A Claude session stamped with a top-level `version` (what claudeAdapter reads into observedVersions). */
function claudeSessionAtVersion(version: string, commands: string[] = ['git status']): NormalizedSession {
  const content = commands.map((command, i) => ({ type: 'tool_use', id: `b${i}`, name: 'Bash', input: { command } }));
  const line = {
    type: 'assistant',
    version,
    sessionId: 's',
    uuid: 'a1',
    timestamp: '2026-06-08T00:00:01.000Z',
    message: {
      id: 'm-a1',
      role: 'assistant',
      model: 'claude-opus-4-8',
      content,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
  return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([line])) }])!;
}

function readPathClaim(value: string, matcher: 'contains' | 'not_contains'): CheckableClaim {
  return {
    id: 'rp',
    says: `reads ${value}`,
    kind: 'human-constraint',
    scope: { kind: 'whole-session' },
    source: { kind: 'cross-artifact', workItemSlug: 'p', path: 'contract.yaml', fidelity: 'verbatim' },
    predicate: { target: 'read-paths', matcher, scope: 'transcript', value },
  };
}

describe('P0.6 — harnessVersionStatus: coarse catastrophic-floor (never false-fires on real versions)', () => {
  it('recognizes current Claude 2.1.x and Codex 0.13x', () => {
    expect(harnessVersionStatus('claude', ['2.1.170'])).toBe('recognized');
    expect(harnessVersionStatus('claude', ['2.1.90'])).toBe('recognized');
    expect(harnessVersionStatus('codex', ['0.139.0'])).toBe('recognized');
  });
  it('flags a whole-major drift as out-of-range', () => {
    expect(harnessVersionStatus('claude', ['3.0.0'])).toBe('out-of-range');
    expect(harnessVersionStatus('claude', ['1.9.0'])).toBe('out-of-range');
    expect(harnessVersionStatus('codex', ['1.0.0'])).toBe('out-of-range');
  });
  it('reports absent for empty / unparseable / undefined version lists', () => {
    expect(harnessVersionStatus('claude', [])).toBe('absent');
    expect(harnessVersionStatus('claude', ['nightly'])).toBe('absent');
    expect(harnessVersionStatus('claude', undefined)).toBe('absent');
  });
});

describe('P0.6 — harnessVersionAtLeast: the toolUseId feature boundary (CC > 2.1.90)', () => {
  it('2.1.90 is NOT >= 2.1.91; 2.1.91 and 2.1.170 are', () => {
    expect(harnessVersionAtLeast(['2.1.90'], '2.1.91')).toBe(false);
    expect(harnessVersionAtLeast(['2.1.91'], '2.1.91')).toBe(true);
    expect(harnessVersionAtLeast(['2.1.170'], '2.1.91')).toBe(true);
    expect(harnessVersionAtLeast([], '2.1.91')).toBe(false); // absent → conservative (not expected)
  });
  it('parseSemver handles partial versions and junk', () => {
    expect(parseSemver('2.1')).toEqual({ major: 2, minor: 1, patch: 0 });
    expect(parseSemver('nope')).toBeNull();
  });
});

describe('P0.6 — the verdict pre-check EMITS harness-version-unrecognized (not a dead enum member)', () => {
  it('a whole-major-drift session → unverifiable(harness-version-unrecognized)', () => {
    const s = claudeSessionAtVersion('3.0.0');
    const v = verdictForClaim(readPathClaim('secret', 'not_contains'), s);
    expect(v).toMatchObject({ status: 'unverifiable', reason: 'harness-version-unrecognized' });
  });
  it('a current 2.1.x session is NOT gated by the floor — it verifies normally', () => {
    const s = claudeSessionAtVersion('2.1.170');
    const v = verdictForClaim(readPathClaim('secret', 'not_contains'), s);
    // The floor must not abstain on a real current session — whatever the verdict, it is NOT the
    // version reason (it may be unverifiable for an unrelated honest cause like channel coverage).
    expect(v.reason).not.toBe('harness-version-unrecognized');
  });
  it('a version-less session is NOT gated by the floor (absent ≠ out-of-range)', () => {
    const s = claudeSessionAtVersion(''); // version '' → unparseable → absent
    const v = verdictForClaim(readPathClaim('secret', 'not_contains'), s);
    expect(v.reason).not.toBe('harness-version-unrecognized');
  });
});

describe('P0.6 — parseHealth is pinned on the session at parse time', () => {
  it('a real parse carries parseHealth with the structured-event count and inputNonEmpty', () => {
    const s = claudeSessionAtVersion('2.1.170', ['git status', 'ls']);
    expect(s.parseHealth).toBeDefined();
    expect(s.parseHealth!.inputNonEmpty).toBe(true);
    expect(s.parseHealth!.structuredEventCount).toBeGreaterThan(0);
    expect(typeof s.parseHealth!.tokenTotalSuspect).toBe('boolean');
  });
});

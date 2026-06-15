/**
 * N7 — the sticky PR comment (pure). The load-bearing behaviors: it LEADS with the unverifiables (the
 * gate publishes its own blind spots), keeps the gate (artifact-integrity → block) and the detector
 * (reads/egress → surface, not block) visibly distinct, and stays sticky via a stable marker.
 */
import { describe, it, expect } from 'vitest';
import type { Report, ComplianceVerdict } from 'anatrace-core';
import { buildPrComment, COMMENT_MARKER } from '../src/comment.js';

const v = (claimId: string, status: ComplianceVerdict['status'], reason: ComplianceVerdict['reason']): ComplianceVerdict =>
  ({ claimId, status, reason, evidence: [], source: 'deterministic' });

function report(compliance: ComplianceVerdict[]): Report {
  return {
    schemaVersion: 2,
    session: { harness: 'claude', model: 'm', sessionId: 's', observedVersions: [], counts: {} as Report['session']['counts'] },
    findings: [],
    compliance,
  };
}

describe('N7 — buildPrComment', () => {
  it('carries the sticky marker (so it is updated, never duplicated)', () => {
    expect(buildPrComment(report([]))).toContain(COMMENT_MARKER);
  });

  it('LEADS with the unverifiables (the gate publishes its blind spots), before satisfied', () => {
    const out = buildPrComment(report([v('a', 'satisfied', 'predicate-matched'), v('b', 'unverifiable', 'codex-blind')]));
    expect(out.indexOf('Could not verify')).toBeGreaterThan(-1);
    expect(out.indexOf('Could not verify')).toBeLessThan(out.indexOf('Verified:'));
    expect(out).toContain('`codex-blind` — b');
  });

  it('an artifact-integrity violation BLOCKS the merge (gate)', () => {
    const out = buildPrComment(report([v('no-test-edits', 'violated', 'predicate-not-matched')]));
    expect(out).toContain('⛔');
    expect(out).toContain('Blocked the merge');
    expect(out).toContain('no-test-edits');
  });

  it('a reads/egress violation is a DETECTOR — surfaced, never pitched as a merge gate', () => {
    const out = buildPrComment(report([v('no-secret', 'violated', 'predicate-not-matched')]), new Set(['no-secret']));
    expect(out).toContain('Detected — review / revoke, NOT a merge gate');
    expect(out).not.toContain('Blocked the merge');
  });

  it('gate and detector violations are kept distinct in one comment', () => {
    const out = buildPrComment(
      report([v('no-test-edits', 'violated', 'predicate-not-matched'), v('no-secret', 'violated', 'predicate-not-matched')]),
      new Set(['no-secret']),
    );
    expect(out).toContain('Blocked the merge (1)');
    expect(out).toContain('Detected — review / revoke, NOT a merge gate (1)');
  });

  it('a clean run reports all-verified', () => {
    expect(buildPrComment(report([v('a', 'satisfied', 'predicate-matched')]))).toContain('✅ anatrace — all 1 obligations verified');
  });

  it('keeps the zero-LLM claim scoped to the published verdict path (wording discipline)', () => {
    expect(buildPrComment(report([]))).toContain('zero-LLM in the published verdict path');
  });
});

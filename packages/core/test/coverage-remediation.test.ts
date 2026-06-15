/**
 * N3 — coverage gaps → remediation. The reason→capture table is EXHAUSTIVE over all three gap enums by
 * CONSTRUCTION: `Record<VerdictReason, …>` / `Record<LineageGapReason, …>` / `Record<ChannelCoverageGapReason, …>`
 * are total maps, so a new enum member cannot ship without its remediation (a compile error otherwise —
 * the reachability lock). These tests pin the runtime behavior: the partition, the capture-closable-first
 * ordering, dedup, and that the intrinsic floor is named (so the loop never reads as "tops out").
 */
import { describe, it, expect } from 'vitest';
import { captureActionsFor, remediationFor } from '../src/coverage-remediation.js';
import type { Report } from '../src/report.js';
import type { ComplianceVerdict } from '../src/verdict.js';

const v = (claimId: string, reason: ComplianceVerdict['reason']): ComplianceVerdict =>
  ({ claimId, status: 'unverifiable', reason, evidence: [], source: 'deterministic' });

function report(opts: { compliance?: ComplianceVerdict[]; lineageGaps?: Array<{ reason: string }>; channelGaps?: Array<{ claimId: string; reason: string }> }): Report {
  return {
    schemaVersion: 2,
    session: { harness: 'claude', model: 'm', sessionId: 's', observedVersions: [], counts: {} as Report['session']['counts'] },
    findings: [],
    ...(opts.compliance ? { compliance: opts.compliance } : {}),
    ...(opts.lineageGaps ? { lineage: { gaps: opts.lineageGaps } as Report['lineage'] } : {}),
    ...(opts.channelGaps
      ? { verificationCoverage: { totalClaims: 1, fullyCheckedClaims: 0, unverifiableClaims: [], claims: opts.channelGaps.map((g) => ({ claimId: g.claimId, requiredChannels: [], checkedChannels: [], gaps: [{ channel: 'filesystem-read', reason: g.reason }] })) } as Report['verificationCoverage'] }
      : {}),
  };
}

describe('N3 — the reason→remediation partition (capture-closable vs intrinsic floor)', () => {
  it('partitions the capture-closable reasons correctly', () => {
    expect(remediationFor('verdict', 'delegate-coverage-incomplete').kind).toBe('capture-closable');
    expect(remediationFor('verdict', 'channel-coverage-incomplete').kind).toBe('capture-closable');
    expect(remediationFor('verdict', 'subject-unresolvable').kind).toBe('capture-closable');
    expect(remediationFor('verdict', 'window-unresolvable').kind).toBe('capture-closable');
    expect(remediationFor('lineage-gap', 'delegate-call-without-child-transcript').kind).toBe('capture-closable');
  });

  it('partitions the INTRINSIC floor correctly (no capture closes these)', () => {
    expect(remediationFor('verdict', 'routed-to-llm').kind).toBe('intrinsic');
    expect(remediationFor('verdict', 'runtime-scoped').kind).toBe('intrinsic');
    expect(remediationFor('verdict', 'codex-blind').kind).toBe('intrinsic');
    expect(remediationFor('verdict', 'low-confidence').kind).toBe('intrinsic');
    expect(remediationFor('verdict', 'command-unresolvable').kind).toBe('intrinsic'); // 0a obfuscation
    expect(remediationFor('lineage-gap', 'harness-lineage-unsupported').kind).toBe('intrinsic');
  });

  it('every remediation carries a non-empty action string', () => {
    for (const r of ['routed-to-llm', 'delegate-coverage-incomplete', 'codex-blind', 'content-unresolvable'] as const) {
      expect(remediationFor('verdict', r).action.length).toBeGreaterThan(10);
    }
  });
});

describe('N3 — captureActionsFor over a report', () => {
  it('orders capture-closable rungs BEFORE the intrinsic floor', () => {
    const r = report({ compliance: [v('a', 'codex-blind'), v('b', 'delegate-coverage-incomplete')] });
    const actions = captureActionsFor(r);
    expect(actions.map((a) => a.kind)).toEqual(['capture-closable', 'intrinsic']);
    expect(actions[0]!.claimId).toBe('b');
  });

  it('draws from ALL THREE gap vocabularies (verdict + lineage + channel)', () => {
    const r = report({
      compliance: [v('a', 'subject-unresolvable')],
      lineageGaps: [{ reason: 'delegate-call-without-child-transcript' }],
      channelGaps: [{ claimId: 'a', reason: 'unknown-tool' }],
    });
    const sources = new Set(captureActionsFor(r).map((a) => a.source));
    expect(sources).toEqual(new Set(['verdict', 'lineage-gap', 'channel-gap']));
  });

  it('dedups identical (source, reason, claim) gaps', () => {
    const r = report({ compliance: [v('a', 'codex-blind'), v('a', 'codex-blind')] });
    expect(captureActionsFor(r)).toHaveLength(1);
  });

  it('a fully-resolved report yields no actions', () => {
    const r = report({ compliance: [{ claimId: 'a', status: 'satisfied', reason: 'predicate-matched', evidence: [], source: 'deterministic' }] });
    expect(captureActionsFor(r)).toHaveLength(0);
  });
});

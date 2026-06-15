/**
 * CONFORMANCE soundness guard (the false-PASS / false-VIOLATE regression gate). This is NOT the
 * published N2 benchmark — it is an INTERNAL test that the engine does not regress into false-PASS or
 * false-VIOLATE on a set of KNOWN seeded violation/clean classes. The headline assertion is the one the
 * whole thesis stakes itself on: ZERO false-PASS (a `satisfied` where ground truth is `violated`). A
 * false-PASS here is thesis-breaking, not a normal test failure.
 *
 * Why it is NOT a published number: ground truth here is CONSTRUCTIVE (we seeded each session, so the
 * label is the seed, not a judgment), over SYNTHETIC sessions — it proves the engine is sound on these
 * known classes, NOT that it generalizes to real-transcript variety. A real measured number requires
 * real `~/.claude`/`~/.codex` sessions at volume (gated on a real user / the external audit). So the
 * console diagnostic below is an internal regression read, never a figure to quote externally.
 */
import { describe, it, expect } from 'vitest';
import { scoreCorpus, wilsonUpper95 } from './conformance/scorer.js';

describe('conformance soundness guard — the false-PASS / false-VIOLATE regression gate', () => {
  const s = scoreCorpus();

  it('prints the internal conformance read (NOT a published figure)', () => {
    const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '  ─── INTERNAL conformance read (synthetic corpus, constructive truth — NOT a published number) ───',
        `  known-class pairs (claim,session): ${s.applicable}   answered: ${s.answered}   abstained: ${pct(s.abstentionRate)}`,
        `  FALSE-PASS: ${s.falsePass} over ${s.answeredViolatedTruth} answered violated-truth pairs (the regression gate)`,
        `  FALSE-VIOLATE: ${s.falseViolate} over ${s.answeredSatisfiedTruth} answered satisfied-truth pairs`,
        '  → a real measured number waits for real sessions at volume; do not quote these externally.',
        '',
      ].join('\n'),
    );
    expect(s.applicable).toBeGreaterThan(0);
  });

  it('ZERO false-PASS — no `satisfied` on any seeded breach (the cardinal sin)', () => {
    const offenders = s.pairs.filter((p) => p.outcome === 'false-pass');
    expect(offenders, JSON.stringify(offenders)).toHaveLength(0);
  });

  it('ZERO false-VIOLATE — no `violated` on any genuinely-clean pair (post-0a)', () => {
    const offenders = s.pairs.filter((p) => p.outcome === 'false-violate');
    expect(offenders, JSON.stringify(offenders)).toHaveLength(0);
  });

  it('every corpus claim resolves (no `absent` — guards corpus/engine drift)', () => {
    expect(s.pairs.filter((p) => p.outcome === 'unresolved')).toHaveLength(0);
  });

  it('degraded/blind pairs abstain honestly (no confident verdict where evidence is degraded)', () => {
    expect(s.pairs.filter((p) => p.outcome === 'wrong-on-degraded')).toHaveLength(0);
  });

  it('the conformance corpus is a stable deterministic baseline (drift is deliberate)', () => {
    // PINNED — update DELIBERATELY when the corpus changes, so a silent corpus/engine drift is caught.
    expect(s.applicable).toBe(39);
    expect(s.answered).toBe(32);
    expect(s.falsePass).toBe(0);
    expect(s.falseViolate).toBe(0);
  });

  it('the Wilson helper is correct (used only as an internal selective-prediction read, never a public %)', () => {
    expect(wilsonUpper95(0, 14)).toBeCloseTo(3.8416 / (14 + 3.8416), 3);
    expect(wilsonUpper95(0, 0)).toBe(0);
  });
});

import type { Mandate, MandateClaim } from './mandate.js';

/**
 * The C5 predicate-coverage stat — counted over CLAIMS, not kinds (frozen REQ, the
 * freeze-blocker; a `kind` can be partly checkable, so per-claim is the only honest unit).
 *
 *  - numerator   = claims with a `predicate` whose `scope === 'transcript'`
 *  - denominator = ALL claims
 *
 * EXCLUDED from the NUMERATOR (but KEPT in the denominator — they are real declared
 * obligations): `runtime`-scoped predicates, predicate-absent claims (`intent` + LLM-routed),
 * AND any claim carrying `confidence` (the `superpowers` adapter emits `confidence:'low'` on
 * nested/overlapping windows → `unverifiable`, so a low-confidence claim is NOT a clean
 * mechanical check). Do NOT collapse runtime/confidence claims out of the denominator — that
 * inflates X/Y and is the exact overstatement `predicate.scope` exists to prevent.
 */
export interface CoverageStat {
  /** X — mechanically (transcript) checkable claims. */
  checkable: number;
  /** Y — all declared obligations. */
  total: number;
}

/**
 * Is this claim counted in the coverage NUMERATOR? It must (a) carry a `transcript`-scoped
 * predicate AND (b) carry NO `confidence` field (a `confidence:'low'` claim routes to
 * `unverifiable`, so it is excluded from the numerator per the frozen REQ).
 */
export function isTranscriptCheckable(c: MandateClaim): boolean {
  return (
    c.predicate !== undefined && c.predicate.scope === 'transcript' && c.confidence === undefined
  );
}

/** Compute the per-claim coverage stat for a mandate. Pure projection — no verdicts, no LLM. */
export function coverageStat(mandate: Mandate): CoverageStat {
  let checkable = 0;
  for (const c of mandate.claims) {
    if (isTranscriptCheckable(c)) checkable += 1;
  }
  return { checkable, total: mandate.claims.length };
}

/** The honest, user-facing one-liner. */
export function renderCoverageLine(stat: CoverageStat): string {
  return `anatrace mechanically checks ${stat.checkable} of ${stat.total} declared obligations on this transcript; the rest route to your model.`;
}

/**
 * C4 MECHANICAL boundary negative test (frozen REQ Done-state 1; the brand bright line).
 *
 * This file is TYPECHECKED on its own (`tsconfig.negative.json`, wired into `pnpm typecheck`).
 * A green `pnpm build` does NOT prove the absence of a field nobody added — so this file uses
 * `// @ts-expect-error` to assert the two type-invariants are COMPILE-ENFORCED:
 *
 *  (a) the E2 guard — a `MandateClaim` carrying ANY LLM-result field is a TYPE ERROR; and
 *  (b) a predicate-absent `intent` claim is type-VALID (reachable), while a predicate-CARRYING
 *      `intent` claim is a TYPE ERROR (only `kind:'intent'` forbids a predicate).
 *
 * If an invariant breaks, an `@ts-expect-error` goes UNUSED → `tsc` raises TS2578 → CI reds.
 * Conversely, removing the guard so the "error" line compiles ALSO trips TS2578. The file
 * therefore fails to typecheck the moment either bright line is eroded — exactly the gate.
 */
import type {
  MandateClaim,
  IntentClaim,
  CheckableClaim,
  ClaimSource,
} from '../../src/mandate.js';

const src: ClaimSource = { kind: 'in-blob', blob: 'parent', fidelity: 'verbatim' };

// (b1) POSITIVE: a predicate-absent `intent` claim is type-VALID (the boundary is a field).
const intentOk: IntentClaim = {
  id: 'i1',
  says: 'do the thing well',
  kind: 'intent',
  scope: { kind: 'whole-session' },
  source: src,
};
void intentOk;

// (b2) POSITIVE: a non-`intent` claim WITHOUT a predicate is valid (routes to the LLM in E).
const checkableNoPredicate: CheckableClaim = {
  id: 'c1',
  says: 'announces the skill',
  kind: 'skill-announced',
  scope: { kind: 'whole-session' },
  source: src,
};
void checkableNoPredicate;

// (b3) NEGATIVE: an `intent` claim carrying a predicate must be a TYPE ERROR.
const intentWithPredicate: IntentClaim = {
  id: 'i2',
  says: 'no predicate allowed here',
  kind: 'intent',
  scope: { kind: 'whole-session' },
  source: src,
  // @ts-expect-error — only `kind:'intent'` FORBIDS a predicate (predicate?: never).
  predicate: { target: 'tool-names', scope: 'transcript', matcher: 'exists' },
};
void intentWithPredicate;

// (a) NEGATIVE: a `MandateClaim` carrying ANY LLM-result field must be a TYPE ERROR (E2 guard).
const claimWithVerdict: MandateClaim = {
  id: 'c2',
  says: 'must not carry a verdict',
  kind: 'command-run',
  scope: { kind: 'whole-session' },
  source: src,
  // @ts-expect-error — a MandateClaim carries NO LLM-result field, ever (the E2 guard).
  verdict: 'satisfied',
};
void claimWithVerdict;

const claimWithJudge: MandateClaim = {
  id: 'c3',
  says: 'must not carry a judge result',
  kind: 'file-scope',
  scope: { kind: 'whole-session' },
  source: src,
  // @ts-expect-error — no `judgeResult`/LLM-result field is expressible on a MandateClaim.
  judgeResult: { confidence: 0.9 },
};
void claimWithJudge;

/**
 * Versioned model → CONTEXT-WINDOW-LIMIT table (meta-facts M1 / OQ-M2).
 *
 * REFERENCE DATA of the SAME category as the shipped `PRICES` table (model → a number) — it is
 * NOT a judge-model reference (it names no judge, makes no quality call). It is permitted in
 * anatrace-core exactly as `PRICES` is: pure data + arithmetic, no fetch / clock, so the
 * `dependencies:{}` purity invariant holds.
 *
 * Used ONLY to turn `rootPeakTokens` into a `rootContextUtilization` RATIO. Unknown model ⇒
 * the ratio is OMITTED (never guessed) — the same honesty discipline as `computeCost`'s
 * `priced:false`. Limits are in TOKENS (the context window's input budget).
 */

/** The version stamp for the bundled context-limit table. Bump when any limit changes. */
export const CONTEXT_LIMITS_VERSION = '2026-06-11';

/** One model's context-window limit, in tokens. */
export interface ContextLimitEntry {
  /** Exact model id as it appears in the transcript. */
  model: string;
  /** Context-window limit in tokens (the input budget the session can fill before compaction). */
  limit: number;
}

/**
 * The bundled context-limit table (the `PRICES` pattern). Hand-curated; every figure is stamped
 * by {@link CONTEXT_LIMITS_VERSION}. Models absent here yield NO `rootContextUtilization` (the
 * ratio is omitted, never guessed). The `[1m]` extended-context variants ride a distinct id and
 * would be a distinct row when a transcript emits one.
 */
export const CONTEXT_LIMITS: ContextLimitEntry[] = [
  { model: 'claude-fable-5', limit: 200_000 },
  { model: 'claude-opus-4-8', limit: 200_000 },
  { model: 'claude-opus-4-7', limit: 200_000 },
  { model: 'claude-opus-4-6', limit: 200_000 },
  { model: 'claude-sonnet-4-6', limit: 200_000 },
  { model: 'claude-haiku-4-5', limit: 200_000 },
  { model: 'gpt-5.5', limit: 400_000 },
];

/**
 * The context-window limit for a model, or `undefined` when the model is unknown (⇒ the caller
 * OMITS `rootContextUtilization`, never guesses). Pure lookup; mirrors `computeCost`'s find.
 */
export function contextLimitFor(model: string): number | undefined {
  return CONTEXT_LIMITS.find((e) => e.model === model)?.limit;
}

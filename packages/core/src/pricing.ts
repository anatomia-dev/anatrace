/**
 * Versioned model price table — data + pure arithmetic, no fetch, no clock.
 *
 * Ported into anatrace-core from anatomia `data/pricing.ts` (REQ Item 7 / A4a). The
 * seed's `computeCost(tokens, model)` is widened to the 3-arg INJECTABLE form
 * `computeCost(tokens, model, { priceTable })` (OQ8) so pricing is not a frozen const —
 * commercial-cadence decoupling. Cost is a render-time return value ONLY; it is NEVER a
 * field on `Report` or `ProvenanceCounts` (the no-`cost_usd` decision, Item 10). The
 * `dependencies:{}` purity invariant holds: pure data + arithmetic, no fs/net.
 */

import type { TokenCounts } from './provenance.js';

/** The version stamp for the bundled price table. Bump when any rate changes. */
export const PRICE_TABLE_VERSION = '2026-06-14';

/**
 * One model's price row, in USD per 1,000,000 tokens of each token type.
 * Models without a cache tier contribute `0` for those counts.
 */
export interface PriceEntry {
  /** Exact model id as it appears in the transcript. */
  model: string;
  /** USD per 1M fresh input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cache-write tokens. */
  cache_create: number;
  /** USD per 1M cache-read tokens. */
  cache_read: number;
  /**
   * OPTIONAL machine-readable provenance: the source the rate was verified against. Promoted from a
   * free-text comment to a field so it travels with the data (0c). Populated where a row was
   * explicitly sourced; absent ⇒ provenance was not recorded for that row (honest, never guessed).
   */
  source?: string;
  /** OPTIONAL provenance: the date (YYYY-MM-DD) the rate was last verified against {@link PriceEntry.source}. */
  asOf?: string;
}

/**
 * The bundled price table. Rates are per 1,000,000 tokens, in USD. Hand-curated;
 * every figure is an estimate stamped by {@link PRICE_TABLE_VERSION}. The default
 * table injected into {@link computeCost} when the CLI renders cost.
 */
export const PRICES: PriceEntry[] = [
  { model: 'claude-fable-5', input: 10, output: 50, cache_create: 12.5, cache_read: 1 },
  { model: 'claude-opus-4-8', input: 5, output: 25, cache_create: 6.25, cache_read: 0.5 },
  { model: 'claude-opus-4-7', input: 5, output: 25, cache_create: 6.25, cache_read: 0.5 },
  { model: 'claude-opus-4-6', input: 5, output: 25, cache_create: 6.25, cache_read: 0.5 },
  { model: 'claude-sonnet-4-6', input: 3, output: 15, cache_create: 3.75, cache_read: 0.3 },
  { model: 'claude-haiku-4-5', input: 1, output: 5, cache_create: 1.25, cache_read: 0.1 },
  // GPT-5.5 standard tier: $5.00 input / $0.50 cached input / $30.00 output per 1M (no separate
  // cache-write charge). Provenance promoted to the `source`/`asOf` data fields below (0c).
  {
    model: 'gpt-5.5',
    input: 5,
    output: 30,
    cache_create: 0,
    cache_read: 0.5,
    source: 'https://developers.openai.com/api/docs/pricing',
    asOf: '2026-06-14',
  },
];

/** The result of a cost computation: the estimate plus the table version used. */
export interface CostResult {
  /** Estimated cost in USD, rounded to 6 decimal places. `0` for unknown models. */
  cost_usd: number;
  /**
   * Whether `model` was found in the price table. When `false`, `cost_usd` is `0`
   * because the model is UNPRICED — not because the session was free. Callers render
   * unpriced models distinctly (e.g. "n/a"), never "$0.00".
   */
  priced: boolean;
  /** The price-table version this estimate was computed against. */
  price_table_version: string;
}

/**
 * Compute an estimated session cost from token counts and an INJECTED price table.
 *
 * Pure and deterministic — no network, no clock, no randomness. Same inputs always
 * yield the same output. An unknown model returns `{ cost_usd: 0, priced: false }`
 * with the version still stamped (never throws), so the missing rate is visible and
 * the estimate is recomputable once a row is added.
 *
 * @param tokens - Token counts for the session
 * @param model - The model id to price against
 * @param opts - `{ priceTable }` — the injectable price rows (OQ8)
 * @returns The estimated cost and the price-table version used
 */
export function computeCost(
  tokens: TokenCounts,
  model: string,
  opts: { priceTable: PriceEntry[] },
): CostResult {
  const entry = opts.priceTable.find((p) => p.model === model);
  if (!entry) {
    return { cost_usd: 0, priced: false, price_table_version: PRICE_TABLE_VERSION };
  }
  const raw =
    (tokens.input / 1_000_000) * entry.input +
    (tokens.output / 1_000_000) * entry.output +
    (tokens.cache_create / 1_000_000) * entry.cache_create +
    (tokens.cache_read / 1_000_000) * entry.cache_read;
  // Round to 6 dp for a stable, byte-identical estimate across runs.
  const cost_usd = Math.round(raw * 1_000_000) / 1_000_000;
  return { cost_usd, priced: true, price_table_version: PRICE_TABLE_VERSION };
}

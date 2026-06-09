/**
 * Token counts for one session. FROZEN — mirrors anatomia `pricing.ts:TokenCounts`
 * field-for-field and in key order. Bit-locked: the published JSON shape is a contract.
 */
export interface TokenCounts {
  input: number;
  output: number;
  cache_create: number;
  cache_read: number;
}

/**
 * Durable, derived provenance for one finished session. FROZEN — mirrors anatomia
 * `forensics.ts:ProvenanceCounts` field-for-field and in KEY ORDER. No `cost_usd`:
 * cost is recomputed at display from tokens + model + price_table_version.
 *
 * @remarks Runbook 2 narrows the FROZEN (bit-identical) tier to `tokens` / `model` /
 *   `price_table_version` / `derive_version`. The four count fields below
 *   (`commands_run` / `tests_executed` / `failures_encountered` / `files_touched`) stay
 *   in the object (key set unchanged → opaque consumers keep working) but are
 *   BEST-EFFORT — capability-fragile, demoted out of the bit-frozen guarantee (Item 4).
 */
export interface ProvenanceCounts {
  tokens: TokenCounts;
  price_table_version: string;
  /**
   * Monotonic derive-version stamp (Item 4). The first CORRECTED anatrace derive ships
   * `"1"`; absence of the field ⇒ `"0"` by convention (anatomia's committed history has
   * no stamp). Bumps on any change that moves a frozen-tier value. Sibling of
   * `price_table_version` — part of the bit-frozen tier.
   */
  derive_version: string;
  duration_ms: number;
  turns: number;
  tool_calls: number;
  /** Best-effort (demoted from the bit-frozen tier — capability-fragile). */
  commands_run: number;
  /** Best-effort (demoted). */
  tests_executed: number;
  /** Best-effort (demoted). */
  failures_encountered: number;
  /** Best-effort (demoted). */
  files_touched: number;
  model: string;
}

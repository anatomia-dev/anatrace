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
 * @remarks `files_touched` shape is frozen; its Codex VALUE is currently best-effort 0
 *   (apply_patch file-ops land in Runbook 2). Populating it later is additive.
 */
export interface ProvenanceCounts {
  tokens: TokenCounts;
  price_table_version: string;
  duration_ms: number;
  turns: number;
  tool_calls: number;
  commands_run: number;
  tests_executed: number;
  failures_encountered: number;
  files_touched: number;
  model: string;
}

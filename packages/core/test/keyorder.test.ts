import { describe, it, expect } from 'vitest';
import type { ProvenanceCounts } from '../src/provenance.js';
import golden from './fixtures/provenance-golden.json';

/**
 * Bit-compat / key-order lock (Runbook 1 scope). The seed is generated from the
 * CURRENT anatomia `deriveTranscript` output (never the proof chain, which holds a
 * stale mid-development snapshot). This freezes the published shape: exact field
 * set, exact KEY ORDER, and the absence of `cost_usd`.
 *
 * The full parse-twice / Claude-vs-Codex determinism test lands in Runbook 2 with
 * the adapters (there is no parser/derive in core yet).
 */
describe('ProvenanceCounts bit-compat (frozen key order)', () => {
  const EXPECTED_KEYS = [
    'tokens',
    'price_table_version',
    'duration_ms',
    'turns',
    'tool_calls',
    'commands_run',
    'tests_executed',
    'failures_encountered',
    'files_touched',
    'model',
  ];
  const EXPECTED_TOKEN_KEYS = ['input', 'output', 'cache_create', 'cache_read'];

  it('golden seed has exactly the frozen keys in order', () => {
    expect(Object.keys(golden)).toEqual(EXPECTED_KEYS);
    expect(Object.keys((golden as { tokens: Record<string, number> }).tokens)).toEqual(
      EXPECTED_TOKEN_KEYS,
    );
  });

  it('has no cost_usd (cost is display-time only)', () => {
    expect('cost_usd' in golden).toBe(false);
  });

  it('an independently-constructed object serializes byte-identical to the golden', () => {
    const g = golden as ProvenanceCounts;
    const rebuilt: ProvenanceCounts = {
      tokens: {
        input: g.tokens.input,
        output: g.tokens.output,
        cache_create: g.tokens.cache_create,
        cache_read: g.tokens.cache_read,
      },
      price_table_version: g.price_table_version,
      duration_ms: g.duration_ms,
      turns: g.turns,
      tool_calls: g.tool_calls,
      commands_run: g.commands_run,
      tests_executed: g.tests_executed,
      failures_encountered: g.failures_encountered,
      files_touched: g.files_touched,
      model: g.model,
    };
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(golden));
  });
});

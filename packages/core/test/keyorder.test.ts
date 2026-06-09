import { describe, it, expect } from 'vitest';
import type { ProvenanceCounts } from '../src/provenance.js';
import claudeGolden from './fixtures/provenance-golden-claude.json';
import codexGolden from './fixtures/provenance-golden-codex.json';

/**
 * Bit-compat / key-order lock. Runbook 2 supersedes the R1 parent-only golden with two
 * goldens re-seeded from the CORRECTED derive (split by harness + `derive_version`). The
 * frozen tier is shape + per-version reproducibility: exact field set, exact KEY ORDER,
 * `derive_version` present (sibling of `price_table_version`), and the absence of
 * `cost_usd`. The four best-effort count fields stay in the key set (opaque consumers
 * keep working) but are out of the bit-frozen value guarantee.
 *
 * EDIT SITES kept in lockstep (Item 4 / A15): (1) EXPECTED_KEYS, (2) the Object.keys
 * assertion, (3) the rebuilt-object literal — across BOTH per-harness goldens.
 */
const EXPECTED_KEYS = [
  'tokens',
  'price_table_version',
  'derive_version',
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

/** Rebuild a fresh object in the DECLARED key order from the golden's values. */
function rebuild(g: ProvenanceCounts): ProvenanceCounts {
  return {
    tokens: {
      input: g.tokens.input,
      output: g.tokens.output,
      cache_create: g.tokens.cache_create,
      cache_read: g.tokens.cache_read,
    },
    price_table_version: g.price_table_version,
    derive_version: g.derive_version,
    duration_ms: g.duration_ms,
    turns: g.turns,
    tool_calls: g.tool_calls,
    commands_run: g.commands_run,
    tests_executed: g.tests_executed,
    failures_encountered: g.failures_encountered,
    files_touched: g.files_touched,
    model: g.model,
  };
}

describe.each([
  { name: 'claude', golden: claudeGolden as unknown as ProvenanceCounts },
  { name: 'codex', golden: codexGolden as unknown as ProvenanceCounts },
])('ProvenanceCounts bit-compat — $name golden (frozen key order, derive_version)', ({ golden }) => {
  it('has exactly the frozen keys in order', () => {
    expect(Object.keys(golden)).toEqual(EXPECTED_KEYS);
    expect(Object.keys(golden.tokens)).toEqual(EXPECTED_TOKEN_KEYS);
  });

  it('carries derive_version "1" (the first corrected anatrace derive)', () => {
    expect(golden.derive_version).toBe('1');
  });

  it('has no cost_usd (cost is render-time only)', () => {
    expect('cost_usd' in golden).toBe(false);
  });

  it('an independently-constructed object serializes byte-identical to the golden', () => {
    expect(JSON.stringify(rebuild(golden))).toBe(JSON.stringify(golden));
  });
});

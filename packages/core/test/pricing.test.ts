import { describe, it, expect } from 'vitest';
import { computeCost, PRICES, PRICE_TABLE_VERSION } from '../src/pricing.js';

describe('A4a — computeCost (3-arg injectable, OQ8)', () => {
  it('prices a known model from the injected table', () => {
    const r = computeCost(
      { input: 1_000_000, output: 1_000_000, cache_create: 0, cache_read: 0 },
      'claude-opus-4-8',
      { priceTable: PRICES },
    );
    expect(r.priced).toBe(true);
    expect(r.cost_usd).toBe(30); // 5 (input) + 25 (output)
    expect(r.price_table_version).toBe(PRICE_TABLE_VERSION);
  });

  it('unknown model → cost 0, priced:false, never throws', () => {
    const r = computeCost({ input: 1, output: 1, cache_create: 0, cache_read: 0 }, 'no-such-model', {
      priceTable: PRICES,
    });
    expect(r).toEqual({ cost_usd: 0, priced: false, price_table_version: PRICE_TABLE_VERSION });
  });
});

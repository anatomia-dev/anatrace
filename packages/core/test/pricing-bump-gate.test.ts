/**
 * 0c — the price / context-limit BUMP-GATE.
 *
 * The hole this closes: nothing pinned the price/limit *values*, so a silent rate drift (the kind
 * the gpt-5.5 4x error was) would sail through CI. This gate binds each table's rate-bearing data to
 * its version stamp via a content digest: a `version => digest` registry. Change a value without
 * moving the version stamp ⇒ the live digest no longer matches the registry entry ⇒ FAIL. Fixing it
 * forces a deliberate decision (new version + new digest), which the changeset gate + human review see.
 *
 * Scope of the digest is the RATE-bearing fields ONLY (not `source`/`asOf`): re-verifying a rate's
 * provenance without changing the number must NOT force a table-version bump (that would conflate
 * "the price changed" with "we re-checked the same price"). So the digest answers exactly one
 * question — "did a number change?" — which is the one a version stamp exists to track.
 *
 * NOTE (review red-flag): a diff that changes a digest under an UNCHANGED version key is the gate
 * being defeated — same version, different data. Treat it the way the semver-level rule treats a
 * patch on a breaking change: a lie CI can't catch on its own, so the reviewer must.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { PRICES, PRICE_TABLE_VERSION } from '../src/pricing.js';
import { CONTEXT_LIMITS, CONTEXT_LIMITS_VERSION } from '../src/meta/context-limits.js';

function digest(rows: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}

const priceRateDigest = (): string =>
  digest(PRICES.map((r) => [r.model, r.input, r.output, r.cache_create, r.cache_read]));
const contextLimitDigest = (): string => digest(CONTEXT_LIMITS.map((r) => [r.model, r.limit]));

/**
 * version ⟺ exact-rate-data. Append a NEW pair when a rate changes (and bump the version stamp in
 * the same edit); never silently rewrite an existing version's digest (see the file header).
 */
const PRICE_RATE_DIGESTS: Record<string, string> = {
  '2026-06-14': '285a68e62952b476',
};
const CONTEXT_LIMIT_DIGESTS: Record<string, string> = {
  '2026-06-11': '9cc1e5f9a9c49b67',
};

describe('0c — price table bump-gate (value drift cannot slip CI)', () => {
  it('the current PRICES rates match the digest registered for PRICE_TABLE_VERSION', () => {
    expect(PRICE_RATE_DIGESTS[PRICE_TABLE_VERSION]).toBe(priceRateDigest());
  });
  it('gpt-5.5 is priced exactly $5 in / $30 out / $0.50 cache-read (the corrected rate is pinned)', () => {
    const gpt = PRICES.find((p) => p.model === 'gpt-5.5');
    expect(gpt).toMatchObject({ input: 5, output: 30, cache_create: 0, cache_read: 0.5 });
  });
});

describe('0c — context-limit table bump-gate', () => {
  it('the current CONTEXT_LIMITS match the digest registered for CONTEXT_LIMITS_VERSION', () => {
    expect(CONTEXT_LIMIT_DIGESTS[CONTEXT_LIMITS_VERSION]).toBe(contextLimitDigest());
  });
});

describe('0c — version stamps are honest to their data (independent, not force-aligned)', () => {
  // The two tables change on independent cadences; their version stamps are deliberately NOT forced
  // equal. context-limits.ts has a single commit in its history (2026-06-11) and the data is unchanged
  // since, so its stamp is CORRECTLY older than the 2026-06-14 price stamp. Force-bumping it to match
  // would claim a re-verification that never happened — an honesty-floor violation. This test pins
  // that each version stamp is a plausible ISO date, leaving the value to the digest gates above.
  it('both version stamps are ISO YYYY-MM-DD dates', () => {
    expect(PRICE_TABLE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CONTEXT_LIMITS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

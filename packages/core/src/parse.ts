import { claudeAdapter } from './adapters/claude.js';
import { codexAdapter } from './adapters/codex.js';
import type { NormalizedSession, Harness } from './session.js';
import type { NamedBlob, Adapter } from './adapter.js';

const ADAPTERS: Adapter[] = [claudeAdapter, codexAdapter];

/**
 * detect → select adapter → parse. Optional harness override. Ambiguous (>1 detect) or
 * none → null (never throws).
 *
 * NAVIGATOR-CORRECTED (validation round 3): the prior `harness ? .find() : .filter()` form
 * produced an `Adapter | Adapter[] | undefined` union the next ternary did NOT narrow →
 * `TS2339`. This split-branch form compiles clean under the repo's strict flags
 * (exactOptionalPropertyTypes + noUncheckedIndexedAccess).
 */
export function parseSession(group: NamedBlob[], harness?: Harness): NormalizedSession | null {
  if (!group.length) return null;
  const probe = group[0]!.bytes; // bounded detect on the first (parent) blob
  let adapter: Adapter | null;
  if (harness) {
    adapter = ADAPTERS.find((a) => a.harness === harness) ?? null;
  } else {
    const matched = ADAPTERS.filter((a) => a.detect(probe)); // none OR ambiguous (>1) → null
    adapter = matched.length === 1 ? matched[0]! : null;
  }
  if (!adapter) return null;
  try {
    return adapter.parse(group);
  } catch {
    return null; // degrade-never-throw
  }
}

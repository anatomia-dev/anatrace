import type { ProvenanceCounts } from './provenance.js';
import type { Finding } from './types.js';
import type { Harness } from './session.js';

/**
 * The stable, versioned run-output envelope (REQ Item 10). Consumers script against it ⇒
 * it IS a contract. Cost is NOT a field here — it is a render-time projection from
 * `session.counts.tokens` + `model` + an injected price table (never baked into the
 * envelope; see Item 10 / the no-baked-cost decision).
 */
export interface Report {
  schemaVersion: number;
  session: { harness: Harness; model: string; counts: ProvenanceCounts; observedVersions: string[] };
  findings: Finding[];
}

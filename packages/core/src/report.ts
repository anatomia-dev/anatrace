import type { ProvenanceCounts } from './provenance.js';
import type { Finding } from './types.js';
import type { Harness } from './session.js';

/**
 * The stable, versioned run-output envelope (REQ Item 10). Consumers script against it ⇒
 * it IS a contract. Cost is NOT a field here — it is a render-time projection from
 * `session.counts.tokens` + `model` + an injected price table (never baked into the
 * envelope; see Item 10 / the no-baked-cost decision).
 *
 * A5 — schemaVersion 2: adds `session.sessionId` + `session.timeBounds?` (additive; v1
 * consumers ignore the new keys; `ProvenanceCounts` is byte-identical). This is the ONE
 * coherent v2 bump for the A+B pass.
 *
 * RESERVED v2 keys — declared by COMMENT, NOT as fields (founder-decided): the payloads
 * `Report.dossier?`, `Report.compliance?`, and `Report.hookRequests?` land at Phases C/D
 * (their shape needs the schema C + verdict layer D that define them). Defining them now
 * would ship scaffolding; since the envelope is already v2, those keys appearing fresh at
 * D is fully additive (no re-pin). Obligation: do NOT reuse these three names for anything
 * else.
 */
export interface Report {
  schemaVersion: number;
  session: {
    harness: Harness;
    model: string;
    /** A5: the session's stable id (also "which session produced this verdict"). */
    sessionId: string;
    counts: ProvenanceCounts;
    observedVersions: string[];
    /** A5: absolute epoch-ms window of the session's timestamped events; absent when none carry a ts. */
    timeBounds?: { start: number; end: number };
  };
  findings: Finding[];
}

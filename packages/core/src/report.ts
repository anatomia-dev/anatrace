import type { ProvenanceCounts } from './provenance.js';
import type { Finding } from './types.js';
import type { Harness, ParseHealth } from './session.js';
import type { ComplianceVerdict } from './verdict.js';
import type {
  CompactionFacts,
  ContextFacts,
  EnvironmentFacts,
  FlowFacts,
  ScopeShapeFacts,
} from './meta/facts.js';
import type { GitOpsSummary } from './meta/git-ops.js';
import type { VerificationCoverage } from './channels.js';
import type { LineageExtraction } from './lineage.js';

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
 * v2 RESERVED keys — FILLED at Phase D (no schemaVersion re-bump; additive, founder-decided):
 *  - `compliance?` — the per-claim deterministic `ComplianceVerdict[]` (the brand). Surveillance
 *    guardrail: a verdict keys ONLY on `claimId`, NEVER an author/identity.
 *  - `verificationCoverage?` — the claim-keyed channel-coverage receipt.
 * Both are OPTIONAL: a no-mandate run omits them, so R2 byte-identity holds. They ride the
 * deterministic channel ONLY — `JudgeVerdict`/`rationale`/`model` NEVER appear here. (The LLM-judge
 * input `dossier`/`hookRequests` was DEMOTED off this surface in N4/Tier-3 — built internally, never
 * attached: zero-LLM in the published verdict path is a SURFACE property, not just a runtime one.)
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
    /**
     * Meta-facts (M1–M4) — ADDITIVE optional per-session FACTS blocks. Each is a pure
     * projection of the parsed timeline, ZERO LLM, NO verdict, NO person-score, NO author/
     * identity field (the bright line). A domain with no signal is OMITTED, so a v1 consumer
     * and the R2 byte-identity are untouched; `schemaVersion` STAYS 2 (additive, A5/D precedent).
     * VOLUME facts (`context`/`gitOps`) are root-scoped or root-vs-subagent split; PRESENCE facts
     * (`environment`/`scopeShape`) use the flat root∪subagent union (the lane principle, ADD-1).
     */
    compaction?: CompactionFacts;
    context?: ContextFacts;
    gitOps?: GitOpsSummary;
    environment?: EnvironmentFacts;
    flow?: FlowFacts;
    scopeShape?: ScopeShapeFacts;
    /** P0.6 — per-parse health (token-monotonicity / zero-event drift). OMITTED for synthetic sessions. */
    parseHealth?: ParseHealth;
  };
  findings: Finding[];
  /** D — per-claim deterministic verdicts (no severity/rationale/model); present iff a mandate was supplied. */
  compliance?: ComplianceVerdict[];
  // N4/Tier-3 — `dossier` and `hookRequests` were DEMOTED off this public contract and the `--json`
  // envelope. They are the LLM-judge's input (said-vs-did + scrubbed evidence) — an LLM-judge-shaped
  // artifact that has no place on the deterministic, zero-LLM-in-the-published-verdict-path surface.
  // The capability is untouched: `runCompliance` still builds them internally (the quarantined
  // `Config.judge`/`adjudicate` seam, a config-flip away), they are simply no longer attached to Report.
  /** Claim-keyed receipt for which behavioral channels were completely inspected. */
  verificationCoverage?: VerificationCoverage;
  /**
   * Delegation lineage and coverage gaps projected from transcripts, sidecars, and hook records.
   * Optional for embedded callers; the CLI supplies it for every run as an additive v2 field.
   */
  lineage?: LineageExtraction;
}

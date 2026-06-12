import type { ProvenanceCounts } from './provenance.js';
import type { Finding } from './types.js';
import type { Harness } from './session.js';
import type { ComplianceVerdict } from './verdict.js';
import type { Dossier } from './dossier.js';
import type { HookRequest } from './hook.js';
import type {
  CompactionFacts,
  ContextFacts,
  EnvironmentFacts,
  FlowFacts,
  ScopeShapeFacts,
} from './meta/facts.js';
import type { GitOpsSummary } from './meta/git-ops.js';
import type { VerificationCoverage } from './channels.js';

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
 *  - `dossier?` — the said-vs-did artifact (bounded scrubbed evidence; the judge's input).
 *  - `hookRequests?` — the `routed-to-llm` residue manifest (a team with no judge ships ZERO
 *    LLM calls and still gets a complete, inspectable list).
 * All three are OPTIONAL: a no-mandate run omits them, so R2 byte-identity holds. They ride
 * the deterministic channel ONLY — `JudgeVerdict`/`rationale`/`model` NEVER appear here.
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
  };
  findings: Finding[];
  /** D — per-claim deterministic verdicts (no severity/rationale/model); present iff a mandate was supplied. */
  compliance?: ComplianceVerdict[];
  /** D — the said-vs-did dossier (bounded scrubbed evidence); present iff a mandate was supplied. */
  dossier?: Dossier;
  /** D — the `routed-to-llm` residue manifest (the judge's input); present iff a mandate was supplied. */
  hookRequests?: HookRequest[];
  /** Claim-keyed receipt for which behavioral channels were completely inspected. */
  verificationCoverage?: VerificationCoverage;
}

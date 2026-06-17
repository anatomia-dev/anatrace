// Frozen provenance contract (R1 + Item 4 derive_version).
export type { TokenCounts, ProvenanceCounts } from './provenance.js';

// Eval seam (Item 5/6): findings, rules, the mandate/context stubs.
export type {
  Severity,
  Finding,
  Mandate,
  RepoSnapshot,
  MandateAdapter,
  EvalContext,
  Tree,
  ParserCapability,
  ContentResolver,
  Capabilities,
  RuleOptions,
  Rule,
  RuleSetting,
  Config,
} from './types.js';

// The Mandate schema (Phase C — the moat). The boundary-as-a-field keystone.
export { validateMandate, isValidMandate } from './mandate-validate.js';
export { loadPolicyYaml } from './policy.js';
export type { PolicyVerb, PolicyLoadResult } from './policy.js';
export {
  coverageStat,
  isTranscriptCheckable,
  renderCoverageLine,
} from './mandate-coverage.js';
export type { CoverageStat } from './mandate-coverage.js';
export type {
  MandateClaim,
  IntentClaim,
  CheckableClaim,
  ClaimKind,
  ClaimScope,
  ClaimPredicate,
  MessageTextPredicate,
  GenericPredicate,
  ClaimSource,
  SourceFidelity,
  PredicateTarget,
  PredicateScope,
  PredicateGuard,
  Matcher,
  Matcher as PredicateMatcher,
  WindowOpensOn,
  WindowClosesOn,
  ClaimSubject,
  FileScopeDeviationHandling,
  ExtractionDiagnostic,
} from './mandate.js';
export type {
  DelegateManifest,
  LaneCaptureCoverage,
  CaptureCoverage,
  ExpectedLaunchLane,
  ExpectedLaunchBoundary,
  MandateEvaluationContext,
} from './capture-coverage.js';
export { coverageFromExpectedLaunchBoundary } from './capture-coverage.js';
export { extractLineage } from './lineage.js';
export type {
  HarnessLineageHook,
  LineageCompleteness,
  LineageExtraction,
  LineageFanoutCall,
  LineageGap,
  LineageGapReason,
  LineagePointer,
} from './lineage.js';
export {
  channelCoverageForClaim,
  inspectBehavioralChannels,
  summarizeVerificationCoverage,
} from './channels.js';
export type {
  BehavioralChannel,
  ChannelCoverageGapReason,
  ChannelEvidencePointer,
  ChannelCoverageGap,
  ClaimChannelCoverage,
  VerificationCoverage,
  ObservedRead,
  ObservedEgress,
  ChannelInspection,
} from './channels.js';
// N3 — coverage gaps → remediation (the capture loop's step 1): each typed abstention → the precise
// capture that would close it, partitioned {capture-closable vs intrinsic}.
export { captureActionsFor, remediationFor } from './coverage-remediation.js';
export type { CaptureAction, Remediation, RemediationKind } from './coverage-remediation.js';

// The subagent-aware ordered timeline (Item 1).
export type {
  Harness,
  AgentRef,
  SubagentMeta,
  EditEvent,
  MessageEvent,
  ToolEvent,
  ToolResultEvent,
  SkillEvent,
  SkillOrigin,
  InterruptEvent,
  UsageEvent,
  CommandEvent,
  SessionEventBody,
  SessionEvent,
  NormalizedSession,
  ParseHealth,
} from './session.js';

// Harness version support (P0.6) — the coarse catastrophic-floor + feature-presence helpers.
// `parseSemver` is INTERNAL (used only within harness-support); not part of the public surface.
export { harnessVersionStatus, harnessVersionAtLeast } from './harness-support.js';
export type { HarnessVersionStatus, Semver } from './harness-support.js';

// The multi-blob adapter contract (Item 2).
export type { NamedBlob, AdapterCapabilities, Adapter } from './adapter.js';
export { readJsonlLines, parseJsonObject } from './adapter.js';

// Canonical event order (Item 9).
export { canonicalSort } from './order.js';

// The SkillEvent consumer (B2) — render/rule reader, never a ProvenanceCounts field.
// FI-15: `skillsInvokedInScope` is the lane-aware (concurrency-correct) variant for verdicts.
// `matchAnnouncedSkills` is INTERNAL (the Codex adapter imports it directly); not public surface.
export { skillsInvoked, skillsInvokedInScope } from './skills.js';
export type { SkillInvocation } from './skills.js';
export type { SkillSource } from './session.js';

// The read-paths projection (D1 / verify-independence) — Read-tool file_path ONLY (Spike B).
export { readPathsOf } from './read-paths.js';
export type { ReadPath } from './read-paths.js';

// The deterministic verdict layer (D1 — the brand). Zero LLM; closed reason enum; pointer evidence.
export { verdictForClaim, verdictsForMandate, fileScopeVerdict } from './verdict.js';
export type {
  ComplianceVerdict,
  VerdictStatus,
  VerdictReason,
  EvidencePointer,
} from './verdict.js';

// The file-scope SET-rule classifier + normalization (D1-FILESCOPE; golden-tested constant).
export { classifyEditPath, normalizeEditPath } from './file-scope.js';
export type { PathClass } from './file-scope.js';

// The dossier (D2) — the said-vs-did + scrubbed-evidence LLM-JUDGE INPUT — is DEMOTED off the public
// surface and the `--json` envelope in N4/Tier-3: it is an LLM-judge-shaped artifact, out of place on a
// deterministic, zero-LLM-in-the-published-verdict-path API. `buildDossier`/`DOSSIER_SCHEMA_VERSION`/
// `EVIDENCE_CAP` + the `Dossier*` types stay INTERNAL (still built by `runCompliance` for the quarantined
// `Config.judge` seam, a config-flip away — never gating, never the deterministic verdict path).

// The canonical scrub (D2) — versioned, bit-identical to crack3d; covers Finding output.
export { scrubText, scrubFinding, scrubDeep, SCRUB_VERSION } from './scrub.js';
export type { ScrubbedExcerpt } from './scrub.js';

// The verdict config layer (D-CONFIG) — ComplianceCheckId-keyed severities (NOT ClaimKind).
export {
  checkIdForClaim,
  severityForVerdict,
  complianceFindings,
  complianceKey,
  COMPLIANCE_CHECK_IDS,
} from './compliance-config.js';
export type { ComplianceCheckId } from './compliance-config.js';

// SARIF projection + CI gate semantics (D-CONFIG) — the retention rail; violated-only on SARIF.
export { toSarif, sarifLevel, ciExitCode } from './sarif.js';
export type { SarifLog, SarifResult } from './sarif.js';

// The opt-in compliance pack (D-CONFIG) — a SEPARATE pack, never unioned into recommended.
export { COMPLIANCE_RULES, COMPLIANCE_PACK } from './rules/compliance.js';

// The compliance orchestration (D3 glue) — verdicts + MASS Finding + the internal dossier/hookRequests
// seam. `runCompliance` still BUILDS the dossier + residue manifest (the quarantined judge's input),
// but they are no longer attached to the public `Report` / `--json` envelope (N4/Tier-3).
export { runCompliance } from './compliance.js';
export type { ComplianceResult } from './compliance.js';

// The LLM-judge SEAM (D-HOOK) — QUARANTINED off the public zero-LLM surface (P0.4). The LLM call site
// `adjudicate`, the Judge* I/O types, AND the `buildHookRequests`/`HookRequest` residue manifest are all
// INTERNAL: the verdict layer ships zero LLM in the published verdict path. `Config.judge` remains an
// internal injection seam (bundled, non-exported) — there is no public entrypoint that can call an LLM.
// `buildHookRequests` stays built by `runCompliance` for that seam (a config-flip away), un-exported.

// The transcript-content resolver (B4) — injectable content source, no disk in core.
export { transcriptContentResolver } from './content.js';

// The pure projection + cost (Item 4 / Item 7 / A4a).
export { deriveCounts, DERIVE_VERSION, commandStringOf } from './derive.js';
export { computeCost, PRICES, PRICE_TABLE_VERSION } from './pricing.js';
export type { PriceEntry, CostResult } from './pricing.js';

// The run loop + envelope + registry + dispatcher (Item 10).
export type { Report } from './report.js';
export { analyze } from './analyze.js';
export { parseSession } from './parse.js';

// Meta-facts (M1–M4) — the additive per-session FACTS layer (no LLM, no verdict, no person-score).
//
// SURFACE DECISION (reverses the P0.0 UN-EXPORT): these FACTS feeders are PUBLIC, as a stable
// CONSUMER surface for a downstream session-analytics aggregator (crack3d) that consumes anatrace
// for parsing + session facts only. They are deliberately NOT part of the anatrace brand story —
// the README/essay lead with the deterministic zero-LLM VERDICT, never these facts. Re-exporting is
// safe by construction: every block is a PURE projection of the parsed timeline, carries ZERO LLM,
// ZERO verdict, and NO author/identity or composite-score field (the bright line in `meta/facts.ts`).
// The COMPUTATION already shipped (`analyze()` attaches the optional blocks to `Report.session`); this
// just makes the direct feeders pinnable instead of reachable only transitively through `Report`.
// `meta/lane.ts` is SPINE (`verdict.ts` imports `laneCapture`/`isGradeableCapture`) and STAYS public.
export { rootLaneEvents, splitByLane, isRootLane } from './meta/lane.js';
// The per-session FACTS block + its named fact types (A0.1 — the crack3d card-serial feeders).
export { buildSessionMeta } from './meta/facts.js';
export type {
  SessionMetaFacts,
  CompactionBoundary,
  CompactionFacts,
  ContextFacts,
  EnvironmentFacts,
  FlowFacts,
  ScopeShapeFacts,
} from './meta/facts.js';
export type { GitOpsSummary, GitOpCounts } from './meta/git-ops.js';
// A2.2 — the POSITIONED mutating-git-op stream (the recovery-episode substrate; a FACT, not a verdict).
export { gitOpsTimeline } from './meta/git-ops.js';
export type { GitOpEvent } from './meta/git-ops.js';
// A2.3 — the STRUCTURED runner-outcome stream (runner-gated PASS/FAIL/unknown; a FACT, not a verdict).
export { runnerOutcomes } from './meta/runner.js';
export type { RunnerOutcome } from './meta/runner.js';
// The model→context-window calibration table (A1.4) — the SAME data category as `PRICES` (model → a
// number, pure data + arithmetic, no judge / fetch / clock). Public + versioned so a consumer's
// context receipt cannot silently drift when the table moves; bump `CONTEXT_LIMITS_VERSION` with it.
export { CONTEXT_LIMITS, CONTEXT_LIMITS_VERSION, contextLimitFor } from './meta/context-limits.js';
export type { ContextLimitEntry } from './meta/context-limits.js';
// `getRule`/`allRules` had zero consumers (core/CLI/action/anatomia) — removed from the surface.
export { defaultPack, resolvePack } from './registry.js';
export { resolveSeverity, resolveOptions, applyIgnores } from './config.js';
export { FRICTION_RULES, FRICTION_PACK, FRICTION_DEFAULT_SEVERITY } from './rules/friction.js';

// The adapters (Item 3).
export { claudeAdapter } from './adapters/claude.js';
export { codexAdapter } from './adapters/codex.js';

// The reference mandate adapters (C3) + their registry.
export { anatomiaAdapter } from './adapters/anatomia.js';
export { superpowersAdapter } from './adapters/superpowers.js';
export { MANDATE_ADAPTERS, detectMandateAdapter } from './adapters/mandate-registry.js';

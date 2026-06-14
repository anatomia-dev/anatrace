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

// The dossier (D2) — said-vs-did + bounded scrubbed evidence; standalone buildDossier (FI-5).
// `buildZeroMandateWedge` had zero consumers (core, CLI, action, anatomia) — removed from surface.
export { buildDossier, DOSSIER_SCHEMA_VERSION, EVIDENCE_CAP } from './dossier.js';
export type { Dossier, DossierClaim, DossierClaimSlice } from './dossier.js';

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

// The compliance orchestration (D3 glue) — verdicts + MASS Finding + dossier + hookRequests.
export { runCompliance } from './compliance.js';
export type { ComplianceResult } from './compliance.js';

// The LLM-judge SEAM (D-HOOK) — QUARANTINED off the public zero-LLM surface (P0.4). The LLM call
// site `adjudicate` and the Judge* I/O types are NOT public: the verdict layer ships zero LLM. Only
// the DETERMINISTIC residue manifest stays consumable. `Config.judge` remains an internal injection
// seam (bundled, non-exported) — there is no public entrypoint that can call an LLM.
export { buildHookRequests } from './hook.js';
export type { HookRequest } from './hook.js';

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
// Phase 0 P0.0 decision = UN-EXPORT (reversible; Cracked is not a committed near-term plan).
// The person-read FEEDER entry points (`buildSessionMeta`, `gitOpsOf`, `contextLimitFor`,
// `CONTEXT_LIMITS`/`CONTEXT_LIMITS_VERSION`) and their named fact types are intentionally NOT part
// of core's public surface: they feed a separate person-analytics aggregator ("Cracked"), which
// sits at odds with the zero-LLM verdict positioning and only adds surface to freeze at the P0.4
// API-lock. The COMPUTATION stays — `analyze()` still attaches the additive optional meta blocks to
// `Report.session` (so the fact types remain reachable transitively through the public `Report`;
// fully severing that is a separate "should `Report` expose meta-facts?" decision for P0.4).
// `meta/lane.ts` is SPINE (`verdict.ts` imports `laneCapture`/`isGradeableCapture`) and STAYS public.
export { rootLaneEvents, splitByLane, isRootLane } from './meta/lane.js';
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

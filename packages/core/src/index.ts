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
  JudgeInput,
  JudgeOutput,
  JudgeFn,
  Capabilities,
  RuleOptions,
  Rule,
  RuleSetting,
  Config,
} from './types.js';

// The Mandate schema (Phase C — the moat). The boundary-as-a-field keystone.
export { validateMandate, isValidMandate } from './mandate-validate.js';
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
  AgentScope,
} from './mandate.js';

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
} from './session.js';

// The multi-blob adapter contract (Item 2).
export type { NamedBlob, AdapterCapabilities, Adapter } from './adapter.js';
export { readJsonlLines, parseJsonObject } from './adapter.js';

// Canonical event order (Item 9).
export { canonicalSort } from './order.js';

// The SkillEvent consumer (B2) — render/rule reader, never a ProvenanceCounts field.
export { skillsInvoked, matchAnnouncedSkills } from './skills.js';
export type { SkillInvocation } from './skills.js';
export type { SkillSource } from './session.js';

// The transcript-content resolver (B4) — injectable content source, no disk in core.
export { transcriptContentResolver } from './content.js';

// The pure projection + cost (Item 4 / Item 7 / A4a).
export { deriveCounts, DERIVE_VERSION } from './derive.js';
export { computeCost, PRICES, PRICE_TABLE_VERSION } from './pricing.js';
export type { PriceEntry, CostResult } from './pricing.js';

// The run loop + envelope + registry + dispatcher (Item 10).
export type { Report } from './report.js';
export { analyze } from './analyze.js';
export { parseSession } from './parse.js';
export { getRule, defaultPack, allRules, resolvePack } from './registry.js';
export { resolveSeverity, resolveOptions, applyIgnores } from './config.js';
export { FRICTION_RULES, FRICTION_PACK, FRICTION_DEFAULT_SEVERITY } from './rules/friction.js';

// The adapters (Item 3).
export { claudeAdapter } from './adapters/claude.js';
export { codexAdapter } from './adapters/codex.js';

// The reference mandate adapters (C3) + their registry.
export { anatomiaAdapter } from './adapters/anatomia.js';
export { superpowersAdapter } from './adapters/superpowers.js';
export { MANDATE_ADAPTERS, detectMandateAdapter } from './adapters/mandate-registry.js';

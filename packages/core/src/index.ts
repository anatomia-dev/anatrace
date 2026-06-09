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
  RuleOptions,
  Rule,
  Config,
} from './types.js';

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
  InterruptEvent,
  UsageEvent,
  SessionEventBody,
  SessionEvent,
  NormalizedSession,
} from './session.js';

// The multi-blob adapter contract (Item 2).
export type { NamedBlob, AdapterCapabilities, Adapter } from './adapter.js';
export { readJsonlLines, parseJsonObject } from './adapter.js';

// Canonical event order (Item 9).
export { canonicalSort } from './order.js';

// The pure projection + cost (Item 4 / Item 7 / A4a).
export { deriveCounts, DERIVE_VERSION } from './derive.js';
export { computeCost, PRICES, PRICE_TABLE_VERSION } from './pricing.js';
export type { PriceEntry, CostResult } from './pricing.js';

// The run loop + envelope + registry + dispatcher (Item 10).
export type { Report } from './report.js';
export { analyze } from './analyze.js';
export { parseSession } from './parse.js';
export { getRule, defaultPack, allRules } from './registry.js';
export { FRICTION_RULES, FRICTION_PACK } from './rules/friction.js';

// The adapters (Item 3).
export { claudeAdapter } from './adapters/claude.js';
export { codexAdapter } from './adapters/codex.js';

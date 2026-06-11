import type { NormalizedSession, SessionEvent } from '../session.js';
import { splitByLane } from './lane.js';
import { contextLimitFor, CONTEXT_LIMITS_VERSION } from './context-limits.js';
import { gitOpsOf, type GitOpsSummary } from './git-ops.js';

/**
 * The meta-fact extraction layer (M1–M4) — an ADDITIVE, per-session FACTS projection that rides
 * NEW optional keys on `Report.session`. ZERO LLM, deterministic, pure projection of the
 * already-parsed event timeline. NO verdicts, NO person-scores.
 *
 * BRIGHT LINE (load-bearing): every block keys on the SESSION and carries NO author/identity
 * field and NO composite/score field (no `score`/`grade`/`rank`/`hygiene`/`sophistication`/…).
 * The cross-session composites Cracked names (session hygiene, environment sophistication, the
 * person-read) are NOT built here — anatrace emits FACTS, Cracked aggregates.
 *
 * LANE PRINCIPLE (ADD-1): VOLUME facts (context, git) are root-lane-scoped OR root-vs-subagent
 * split (subagent churn is orchestration noise + gameable); PRESENCE facts (skill origins, MCP,
 * edit-surface scopeShape) use the FLAT union (root ∪ subagents — don't miss a subagent's work).
 */

// ─── M1 — compaction + ROOT-LANE context ────────────────────────────────────────────────

/** One compaction boundary (from the structured `CompactBoundaryEvent`, S1). */
export interface CompactionBoundary {
  /** 0-based line index within its blob (the event's own `lineIndex`). */
  lineIndex: number;
  /** Compaction trigger when the harness records one (only `"manual"` observed); absent on Codex. */
  trigger?: string;
  /** The harness's own pre-compaction token total (Claude); absent on Codex. */
  preTokens?: number;
}

/** M1 — context-compaction facts. ROOT-scoped by nature (subagents don't compact the parent). */
export interface CompactionFacts {
  count: number;
  boundaries: CompactionBoundary[];
}

/** M1 — ROOT-LANE context-utilization facts (the gameability antidote: never the merged sum). */
export interface ContextFacts {
  /** Max over the ROOT lane's assistant turns of `input + cache_read + cache_create` (EXCLUDES output). */
  rootPeakTokens: number;
  /** The same max over the SUBAGENT lanes, aggregated SEPARATELY (orchestration volume). */
  subagentPeakTokens: number;
  /** `rootPeakTokens / contextLimit(model)`; present ONLY for a known model (unknown ⇒ omitted, never guessed). */
  rootContextUtilization?: number;
  /** The CONTEXT_LIMITS table version this ratio was computed against (present iff the ratio is). */
  contextLimitsVersion?: string;
  /** True iff the ROOT lane reached a compaction boundary — its own strong signal. */
  rootFlowCompacted: boolean;
}

// ─── M3 — environment FACTS (presence; trimmed to the two observable, non-poisoned bits) ──

/** M3 — environment facts: behaviors THIS session (skill origins + INVOKED MCP servers/calls). */
export interface EnvironmentFacts {
  /** Distinct-invocation counts of skill ORIGIN this session (from `SkillEvent.origin`, path-derived). */
  skillOriginCounts: { stock: number; plugin: number; project: number; personal: number };
  /** Distinct MCP server names the agent actually CALLED this session (`name.split('__')[1]` over `mcp__` tool_use). */
  mcpServers: string[];
  /** Total `mcp__`-prefixed tool calls this session (behavioral). */
  mcpToolCalls: number;
}

// ─── M4 — flow fact + scopeShape gate ────────────────────────────────────────────────────

/** M4 — a per-session FLOW fact (parallelism shape + dispatch volume + a pure framework signal). */
export interface FlowFacts {
  /** Whether the session fanned out into subagent lanes. `'sessions'` is DROPPED (not derivable from one session). */
  parallelism: 'none' | 'subagents';
  /**
   * Count of `Agent` tool_use (the dispatch primitive; `FANOUT_TOOLS` folds `Task`→`Agent`).
   * CAVEAT: the `dispatchToolUseId` link to a specific subagent is ~21%-present — an UNDERCOUNT,
   * NEVER a contract promise (so this is the dispatch VOLUME, not a per-subagent join).
   */
  subagentDispatchVolume: number;
  /**
   * A PURE SESSION signal that a framework was invoked: a `stock`-origin skill (superpowers, per
   * `originFromBaseDir`) OR an announce-match in assistant prose. NEVER calls `detectMandateAdapter`
   * (that reads mandate SOURCE files, not the session). Absent ⇒ no pure session signal observed.
   */
  frameworkInvoked?: boolean;
}

/**
 * M4 — the edit-surface PRESENCE gate (RENAMED from `realness` — the old label leaked a
 * person-judgment). A PRESENCE question ⇒ the FLAT union of edit-paths (root ∪ subagents): under
 * the fan-out norm the subagents do the edits, so a root-only read would say `multiFile:false`
 * for genuine work. (Contrast the VOLUME facts above, which are root-scoped.)
 */
export interface ScopeShapeFacts {
  /** ≥2 distinct edited paths. */
  multiFile: boolean;
  /** At least one edited path looks like source code (a code extension, not a doc/config/lockfile). */
  hasSrc: boolean;
  /** At least one edited path is a VCS/CI/config file (`.git*`, `.github/`, a config/dotfile). */
  hasGitOrConfig: boolean;
}

/**
 * The aggregate meta-facts block. Each domain is OPTIONAL: a domain with no signal is OMITTED
 * (a no-git/no-MCP/no-compaction session simply lacks that key — `ProvenanceCounts` and the
 * R2 byte-identity are untouched). `gitOps`/`flow`/`scopeShape` are always-derivable shapes
 * (zeros, not absent), so they are always present once `buildSessionMeta` runs.
 */
export interface SessionMetaFacts {
  compaction?: CompactionFacts;
  context?: ContextFacts;
  gitOps?: GitOpsSummary;
  environment?: EnvironmentFacts;
  flow?: FlowFacts;
  scopeShape?: ScopeShapeFacts;
}

// ─── projections ─────────────────────────────────────────────────────────────────────────

/** Token "context size" of one usage sample for the peak (EXCLUDES output — byte-validated to ~0.9%). */
function contextSizeOf(u: { input: number; cache_read: number; cache_create: number }): number {
  return u.input + u.cache_read + u.cache_create;
}

/** Max `input+cache_read+cache_create` over the USAGE samples in `events`. */
function peakContextOf(events: SessionEvent[]): number {
  let peak = 0;
  for (const e of events) {
    if (e.type !== 'usage') continue;
    const v = contextSizeOf(e.usage);
    if (v > peak) peak = v;
  }
  return peak;
}

function buildCompaction(root: SessionEvent[], all: SessionEvent[]): CompactionFacts | undefined {
  // Compaction is ROOT-scoped by nature; assert it by reading the root lane, but fall back to
  // the flat scan defensively (a marker should never land on a subagent lane).
  const boundaries: CompactionBoundary[] = [];
  for (const e of all) {
    if (e.type !== 'compact') continue;
    boundaries.push({
      lineIndex: e.lineIndex,
      ...(e.trigger ? { trigger: e.trigger } : {}),
      ...(e.preTokens !== undefined ? { preTokens: e.preTokens } : {}),
    });
  }
  if (boundaries.length === 0) return undefined;
  void root;
  return { count: boundaries.length, boundaries };
}

function buildContext(
  root: SessionEvent[],
  subagents: SessionEvent[],
  model: string,
): ContextFacts {
  const rootPeakTokens = peakContextOf(root);
  const subagentPeakTokens = peakContextOf(subagents);
  const rootFlowCompacted = root.some((e) => e.type === 'compact');
  const limit = contextLimitFor(model);
  const facts: ContextFacts = { rootPeakTokens, subagentPeakTokens, rootFlowCompacted };
  // rootContextUtilization — the REQ's explicitly-named RISKIEST fact (a normalized ratio, one
  // step from a person-score). It is emitted ONLY when it can be computed WITHOUT GUESSING:
  //   1. the model is in the CONTEXT_LIMITS table (else: omit — the REQ's "unknown model → omit"); AND
  //   2. the observed root peak does NOT EXCEED the table limit. A peak > limit is the tell-tale of
  //      a 1M-context-beta session: byte-verified, ~12% of the real corpus reaches ~976k tokens on
  //      `model:"claude-opus-4-6"` with NO byte-observable structured 1M marker (the "1m" string
  //      appears only in PROSE — `opus[1m]`, time estimates) — indistinguishable from a 200k session
  //      by the `model` field alone. A static limit would emit a NONSENSE >1.0 ratio (e.g. 4.88 on
  //      the REQ's own validation fixture 258fe16e). Per "never guess", OMIT rather than fabricate.
  //      The byte-EXACT `rootPeakTokens` (validated to 0.87% vs preTokens) is always emitted; only
  //      the un-guessable RATIO is withheld. (Logged as a spec-vs-bytes STOP in the build report;
  //      resolving the 1M-beta model identity is OQ-M2 — a model-id/beta-header signal upstream.)
  if (limit && limit > 0 && rootPeakTokens > 0 && rootPeakTokens <= limit) {
    // Round to 6 dp for a stable, byte-identical ratio across runs (the `computeCost` discipline).
    facts.rootContextUtilization = Math.round((rootPeakTokens / limit) * 1_000_000) / 1_000_000;
    facts.contextLimitsVersion = CONTEXT_LIMITS_VERSION;
  }
  return facts;
}

function buildEnvironment(all: SessionEvent[]): EnvironmentFacts {
  const skillOriginCounts = { stock: 0, plugin: 0, project: 0, personal: 0 };
  const mcpServers = new Set<string>();
  let mcpToolCalls = 0;
  for (const e of all) {
    if (e.type === 'skill' && e.origin) skillOriginCounts[e.origin] += 1;
    else if (e.type === 'tool' && e.name.startsWith('mcp__')) {
      mcpToolCalls += 1;
      const server = e.name.split('__')[1];
      if (server) mcpServers.add(server);
    }
  }
  return { skillOriginCounts, mcpServers: [...mcpServers].sort(), mcpToolCalls };
}

function buildFlow(root: SessionEvent[], subagents: SessionEvent[], all: SessionEvent[]): FlowFacts {
  const parallelism: FlowFacts['parallelism'] = subagents.length > 0 ? 'subagents' : 'none';
  // `Agent` is the dispatch primitive (the adapter folds `Task`→`Agent`). Count from the ROOT
  // lane — the dispatcher is the root agent (a subagent dispatching is itself orchestration we
  // don't double-count). dispatchToolUseId-linkage is ~21% (undercount) — this is VOLUME only.
  let subagentDispatchVolume = 0;
  for (const e of root) {
    if (e.type === 'tool' && e.name === 'Agent') subagentDispatchVolume += 1;
  }
  // frameworkInvoked — a PURE SESSION signal: a stock-origin skill OR an announce-text skill was
  // invoked in the transcript. NEVER calls detectMandateAdapter (mandate-layer, reads SOURCE).
  const frameworkInvoked = all.some(
    (e) => e.type === 'skill' && (e.origin === 'stock' || e.source === 'announce-text'),
  );
  return {
    parallelism,
    subagentDispatchVolume,
    ...(frameworkInvoked ? { frameworkInvoked: true } : {}),
  };
}

const SRC_EXT_RE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|sh|sql|vue|svelte)$/i;
const GIT_OR_CONFIG_RE =
  /(?:^|\/)(?:\.git[^/]*|\.github\/|\.gitlab[^/]*|\.circleci\/|Dockerfile|Makefile)|\.(?:ya?ml|toml|ini|cfg|conf|config|json|lock|env)$|(?:^|\/)\.[^/]+rc(?:\.[^/]+)?$/;

function editPaths(events: SessionEvent[]): string[] {
  const paths: string[] = [];
  for (const e of events) {
    if (e.type === 'edit') for (const p of e.paths) if (p) paths.push(p);
  }
  return paths;
}

function buildScopeShape(all: SessionEvent[]): ScopeShapeFacts {
  // PRESENCE gate → the FLAT union of edit-paths (root ∪ subagents).
  const paths = editPaths(all);
  const distinct = new Set(paths);
  const multiFile = distinct.size >= 2;
  let hasSrc = false;
  let hasGitOrConfig = false;
  for (const p of distinct) {
    const base = p.split('/').pop() ?? p;
    if (SRC_EXT_RE.test(base)) hasSrc = true;
    if (GIT_OR_CONFIG_RE.test(p)) hasGitOrConfig = true;
  }
  return { multiFile, hasSrc, hasGitOrConfig };
}

/**
 * Build the per-session meta-facts block (M1–M4) as a PURE projection of the parsed session.
 * Deterministic — no clock / fs / network. Optional domains with no signal are omitted
 * (`compaction`/`context`/`environment`); `gitOps`/`flow`/`scopeShape` are always-derivable
 * zero-shaped facts (a no-git session → all zeros, never absent-as-error). Returns `undefined`
 * only if NO block applies (so a maximally-empty session leaves `Report.session` untouched —
 * R2 byte-identity preserved).
 *
 * @param session - the normalized session (its `events` + `counts.model` are the only inputs)
 */
export function buildSessionMeta(session: NormalizedSession): SessionMetaFacts | undefined {
  const { root, subagents } = splitByLane(session);
  const all = session.events;
  const model = session.counts.model;

  const compaction = buildCompaction(root, all);
  const context = buildContext(root, subagents, model);
  const gitOps = gitOpsOf(root, subagents);
  const environment = buildEnvironment(all);
  const flow = buildFlow(root, subagents, all);
  const scopeShape = buildScopeShape(all);

  // `context` always has the peak fields; emit it whenever there is ANY usage signal OR a
  // compaction (so an empty/no-usage session omits it for R2-tidiness).
  const hasContextSignal =
    context.rootPeakTokens > 0 || context.subagentPeakTokens > 0 || context.rootFlowCompacted;
  // `environment` is emitted only when there is an actual environment behavior (any skill
  // origin OR an MCP call) — inheritance-poisoned config is NOT a this-session behavior.
  const hasEnvSignal =
    environment.mcpToolCalls > 0 ||
    environment.skillOriginCounts.stock +
      environment.skillOriginCounts.plugin +
      environment.skillOriginCounts.project +
      environment.skillOriginCounts.personal >
      0;

  const out: SessionMetaFacts = {
    ...(compaction ? { compaction } : {}),
    ...(hasContextSignal ? { context } : {}),
    gitOps,
    ...(hasEnvSignal ? { environment } : {}),
    flow,
    scopeShape,
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

import type { ProvenanceCounts, TokenCounts } from './provenance.js';

export type Harness = 'claude' | 'codex';

/** Per-event attribution. `subagentId` (= the subagent file's agentId) is 100%-derivable. */
export type AgentRef = { kind: 'root' } | { kind: 'subagent'; subagentId: string };

/**
 * Subagent metadata. agentId/agentType/description are 100%-present (sidecar + filename).
 * @experimental dispatchToolUseId — the link to the dispatching `Agent` call — is present
 * on only ~21% of sessions (sidecar `toolUseId`); NEVER a contract promise (REQ Item 1).
 */
export interface SubagentMeta {
  agentId: string;
  agentType: string;
  description: string;
  /** @experimental ~21% coverage. */
  dispatchToolUseId?: string;
}

/**
 * Cross-harness edit carrier. Carrier {op, paths} is FROZEN/rich; content fields are
 * @experimental + UNPOPULATED in R2 (the headline AST rule's inputs — deferring extraction
 * must never narrow the carrier). rename = paths:[from, to] (REQ OQ1, resolved).
 */
export interface EditEvent {
  type: 'edit';
  op: 'create' | 'modify' | 'delete' | 'rename';
  paths: string[];
  /** @experimental unpopulated R2 */ fullContent?: string;
  /** @experimental unpopulated R2 */ hunks?: { before: string; after: string; replaceAll?: boolean }[];
  /** @experimental unpopulated R2 */ appliedContent?: string;
}

export interface MessageEvent {
  type: 'message';
  role: 'user' | 'assistant';
  model?: string;
  text?: string;
}
export interface ToolEvent {
  type: 'tool';
  name: string;
  input?: unknown;
}
/** isError = the structured friction vocabulary (Claude tool_result.is_error / Codex patch_apply_end.success===false). */
export interface ToolResultEvent {
  type: 'toolResult';
  text?: string;
  isError?: boolean;
}
/** Skill-signal provenance (B2). 'tool' = a structured Skill invocation (Claude, high-confidence); 'announce-text' = a portable announce-string match (Codex has no Skill primitive — low-confidence, OQ5). */
export type SkillSource = 'tool' | 'announce-text';
export interface SkillEvent {
  type: 'skill';
  skill: string;
  /** B2: how the skill signal was derived; absent ⇒ treat as 'tool' (the R2 default). */
  source?: SkillSource;
}
/** Structured interrupt vocabulary (Codex turn_aborted.reason==='interrupted'). */
export interface InterruptEvent {
  type: 'interrupt';
  reason: string;
}

/**
 * Token-usage sample on the timeline — the sole input to the Item-4 token fold.
 *
 * ⚖︎ JUDGMENT (A1 taxonomy, founder review): a usage sample is a first-class
 * timeline fact, distinct from a `message` *turn*. This is what makes REQ Item 1's
 * "`counts` is a pure projection of events (`deriveCounts(session)`), NOT a parallel
 * computation" literally true for BOTH harnesses without overloading `MessageEvent`
 * (which would inflate Codex turn counts). The adapter maps raw bytes → these
 * samples (Claude: per-line usage, dedup key `message.id`; Codex: per-`token_count`
 * cumulative with cache already subtracted); `deriveCounts` does the harness-specific
 * fold (MAX-per-id sidechain-first vs last-cumulative). The carrier is `@internal`
 * substrate — never a friction signal, never rendered.
 */
export interface UsageEvent {
  type: 'usage';
  /** Per-harness mapped token counts (Codex: input already cache-subtracted). */
  usage: TokenCounts;
  /** Claude dedup key (`message.id`); absent ⇒ the sample is always included. */
  messageId?: string;
  /** Claude precedence: a non-sidechain copy wins even at a lower total. */
  isSidechain?: boolean;
  /** Codex: this sample is a running cumulative total (last wins). Claude: dedup+sum. */
  cumulative?: boolean;
}

export type SessionEventBody =
  | MessageEvent
  | ToolEvent
  | EditEvent
  | ToolResultEvent
  | SkillEvent
  | InterruptEvent
  | UsageEvent;

export type SessionEvent = SessionEventBody & {
  agent: AgentRef;
  /** epoch-ms parse of the line's own timestamp; undefined when the line carries none. */
  ts?: number;
  /** canonical blob name (Item 2) — part of the sort key (Item 9). */
  blobName: string;
  /** 0-based line index within blobName — final ordering tie-break (Item 9). */
  lineIndex: number;
};

export interface NormalizedSession {
  schemaVersion: number;
  harness: Harness;
  sessionId: string;
  observedVersions: string[]; // harness-specific source (Claude per-line; Codex session_meta once)
  subagents: SubagentMeta[];
  events: SessionEvent[]; // canonically ordered (Item 9)
  counts: ProvenanceCounts; // pure projection — deriveCounts(session) (Item 4)
}

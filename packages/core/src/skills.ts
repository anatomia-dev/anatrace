import type { NormalizedSession, SkillSource, AgentRef } from './session.js';

/**
 * Announce-string skill derive (B2 / OQ5) — the PORTABLE, LOW-CONFIDENCE cross-harness
 * signal for a harness with no Skill primitive (Codex). Matches the common announce
 * conventions ("using the X skill"; superpowers' "Using [X] skill"). Tagged
 * `source:'announce-text'` so a consumer weights it BELOW a structured Claude Skill-tool
 * invocation. Deliberately conservative, and honestly UNVALIDATED on the current corpus
 * (0 Codex skill announces) — shipped low-confidence rather than leave Codex skill-blind.
 */
const ANNOUNCE_RE = /\busing (?:the )?["'[]?([a-z][a-z0-9_-]+)["'\]]? skill\b/gi;

/** Extract announced skill names from assistant prose (Codex path). May be empty. */
export function matchAnnouncedSkills(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ANNOUNCE_RE)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/** One distinct skill invoked in a session, with the (highest-confidence) source seen. */
export interface SkillInvocation {
  skill: string;
  source: SkillSource;
}

/**
 * The `SkillEvent` CONSUMER (B2): distinct skills invoked across a session, as a PURE
 * projection of the event timeline — a render/rule reader, NEVER a `ProvenanceCounts`
 * field (adding one would break the M5 bit-freeze). A structured `tool` source outranks
 * an `announce-text` source for the same skill.
 *
 * ⚠️ LANE-BLIND (FI-15): this counts skills FLAT over ALL events — root AND every concurrent
 * subagent timeline — so under fan-out it OVER-COUNTS a root obligation (a subagent's skill
 * is attributed to root). For a verdict that must not mis-attribute across timelines, use
 * {@link skillsInvokedInScope} with the claim's resolved single-lane subject. The flat signature is kept
 * UNCHANGED for existing render/coverage callers (additive).
 */
export function skillsInvoked(session: NormalizedSession): SkillInvocation[] {
  return collectSkills(session.events.filter((e) => e.type === 'skill'));
}

/** Are two `AgentRef`s the same timeline? (root↔root, or the same subagentId.) */
function sameAgent(a: AgentRef, b: AgentRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'root' || a.subagentId === (b as { subagentId: string }).subagentId;
}

/**
 * Lane-scoped skill projection (FI-15) — distinct skills invoked ON A SINGLE resolved subject lane
 * timeline (concurrency-correct). D1's `skill-events` evaluator + the window resolver use
 * this so a subagent's skill is never attributed to root (the over-count {@link skillsInvoked}
 * documents). When `scope` is omitted, falls back to the flat (lane-blind) projection.
 */
export function skillsInvokedInScope(
  session: NormalizedSession,
  scope?: AgentRef,
): SkillInvocation[] {
  if (!scope) return skillsInvoked(session);
  return collectSkills(
    session.events.filter((e) => e.type === 'skill' && sameAgent(e.agent, scope)),
  );
}

/** Shared skill-dedup core (tool outranks announce-text), over a pre-filtered event slice. */
function collectSkills(events: { type: string; skill?: string; source?: SkillSource }[]): SkillInvocation[] {
  const seen = new Map<string, SkillInvocation>();
  for (const e of events) {
    if (e.type !== 'skill' || !e.skill) continue;
    const source: SkillSource = e.source ?? 'tool';
    const prev = seen.get(e.skill);
    if (!prev) seen.set(e.skill, { skill: e.skill, source });
    else if (prev.source === 'announce-text' && source === 'tool') prev.source = 'tool';
  }
  return [...seen.values()];
}

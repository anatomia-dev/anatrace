import type { NormalizedSession, SessionEvent } from '../session.js';

/**
 * S2 — the ROOT-LANE projection (meta-facts ADD-1 foundation).
 *
 * THE LANE PRINCIPLE (load-bearing, ADD-1): every VOLUME / heaviness count in the meta-facts
 * layer (context, bash-volume, git) is computed ROOT-LANE-scoped (`agent.kind==='root'`)
 * and/or emitted as a root-vs-subagent SPLIT — subagent churn is orchestration noise for
 * reading the human-driven work, and it is gameable (a fan-out inflates the merged total).
 *
 * CONTRAST (presence vs volume): skill / obligation / edit-surface PRESENCE uses the FLAT
 * union (root ∪ subagents — don't miss a subagent's edit); heaviness VOLUME uses root-scope
 * (don't inflate it with subagent churn). Different questions, different scoping — both correct.
 * These helpers serve the VOLUME side; presence facts read `session.events` flat.
 *
 * Pure: filters the already-parsed event timeline, no clock / fs / network. The root filter is
 * the same lane mechanism `skills.ts:sameAgent` uses for `root↔root` (`agent.kind==='root'`).
 */

/** True iff the event belongs to the ROOT (main-agent) lane. */
export function isRootLane(e: SessionEvent): boolean {
  return e.agent.kind === 'root';
}

/** The ROOT-lane events only (`agent.kind==='root'`) — the volume-fact substrate. */
export function rootLaneEvents(session: NormalizedSession): SessionEvent[] {
  return session.events.filter(isRootLane);
}

/**
 * Split the timeline into the ROOT lane and the (flat) subagent lanes. The volume facts read
 * `root` for the human-driven-heaviness signal and `subagents` for the orchestration aggregate
 * — emitted SEPARATELY, NEVER merged (the gameability antidote).
 */
export function splitByLane(session: NormalizedSession): {
  root: SessionEvent[];
  subagents: SessionEvent[];
} {
  const root: SessionEvent[] = [];
  const subagents: SessionEvent[] = [];
  for (const e of session.events) {
    if (e.agent.kind === 'root') root.push(e);
    else subagents.push(e);
  }
  return { root, subagents };
}

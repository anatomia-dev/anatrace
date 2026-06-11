import type { NormalizedSession, SessionEvent, AgentRef } from '../session.js';

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

// ─── completeness: the per-LANE `capture` discriminator (D-C, positive-obligations P2) ──────

/**
 * The deterministic per-LANE completeness classification (D-C). The honest core of the
 * positive-obligations gate: a `required` obligation's absence may flip to `violated` ONLY on a
 * lane whose `capture` is GRADEABLE; every other state degrades to `unverifiable`.
 *
 *  - `complete`             — NO structured compaction boundary on the lane → fully observed.
 *  - `compacted-in-place`   — a boundary with ≥1 real message event BEFORE it on the lane (the
 *                             history is RETAINED in-file) → still GRADEABLE.
 *  - `lane-start`           — a boundary with ZERO prior real message events on the lane (the
 *                             boundary is at line 0; the pre-history was never in this file) →
 *                             UNGRADEABLE (the 3 real subagent lane-start lanes).
 *  - `truncated` / `unknown`— reserved for history-loss with no usable signal → UNGRADEABLE.
 *
 * The discriminator is POSITIONAL: the count of real message events on the lane before the
 * lane's FIRST structured `compact` boundary (`0 → lane-start`; `≥1 → compacted-in-place`; no
 * boundary → `complete`). This separates gradeable from ungradeable on 100% of the real corpus.
 */
export type LaneCapture =
  | 'complete'
  | 'compacted-in-place'
  | 'lane-start'
  | 'truncated'
  | 'unknown';

/** The capture states from which an absent `required` obligation may honestly flip to `violated`. */
export function isGradeableCapture(capture: LaneCapture): boolean {
  return capture === 'complete' || capture === 'compacted-in-place';
}

/** Are two `AgentRef`s the same lane? (root↔root, or the same subagentId.) */
function sameLane(a: AgentRef, b: AgentRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'root' || a.subagentId === (b as { subagentId: string }).subagentId;
}

/**
 * Classify ONE lane's completeness from the already-parsed timeline (PURE — no clock/fs/network).
 *
 * Reads the lane's events in canonical order; finds the FIRST structured `compact` boundary and
 * counts the REAL MESSAGE events strictly before it on that lane. The detector keys ONLY on the
 * structured `CompactBoundaryEvent` (`type:'compact'`, S1) — NEVER a prose/substring scan (the
 * 6-vs-44 substring trap the M1 fixture is committed to avoid). A lane with NO events at all is
 * `unknown` (we observed nothing → never gradeable, never `violated`).
 */
export function laneCapture(session: NormalizedSession, lane: AgentRef): LaneCapture {
  const laneEvents = session.events.filter((e) => sameLane(e.agent, lane));
  if (laneEvents.length === 0) return 'unknown';
  let priorMessages = 0;
  for (const e of laneEvents) {
    if (e.type === 'compact') {
      // POSITIONAL discriminator: 0 real messages before the boundary → the pre-history was
      // never in this file (lane-start, ungradeable); ≥1 → history retained (gradeable).
      return priorMessages === 0 ? 'lane-start' : 'compacted-in-place';
    }
    if (e.type === 'message') priorMessages += 1;
  }
  // No structured boundary on the lane → fully observed.
  return 'complete';
}

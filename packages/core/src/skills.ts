import type { NormalizedSession, SkillSource } from './session.js';

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
 */
export function skillsInvoked(session: NormalizedSession): SkillInvocation[] {
  const seen = new Map<string, SkillInvocation>();
  for (const e of session.events) {
    if (e.type !== 'skill') continue;
    const source: SkillSource = e.source ?? 'tool';
    const prev = seen.get(e.skill);
    if (!prev) seen.set(e.skill, { skill: e.skill, source });
    else if (prev.source === 'announce-text' && source === 'tool') prev.source = 'tool';
  }
  return [...seen.values()];
}

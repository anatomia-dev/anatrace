import type { NamedBlob } from '../adapter.js';
import type { MandateAdapter } from '../types.js';
import type { Mandate, MandateClaim, ClaimSource, ClaimScope } from '../mandate.js';
import { decodeBlob } from './mandate-shared.js';

/**
 * The `superpowers` reference `MandateAdapter` (C3). Extracts from the WORKFLOW/COMMAND layer
 * of a SKILL.md (the `**Announce at start:**` convention, the dispatch model), NOT `spec.md` —
 * aim at `spec.md` and every claim collapses to `intent`.
 *
 * AUTHORING RULES (frozen REQ / runbook, byte-verified 2026-06-10):
 *  - `skill-announced`: match ONLY the real `**Announce at start:** "I'm using the X skill…"`
 *    shape (4 of 14 skills carry it). The graphviz META-template
 *    `"Announce: 'Using [skill] to [purpose]'"` in `using-superpowers` carries `[skill]`/
 *    `[purpose]` PLACEHOLDERS and is documentation-of-convention — it MUST NOT emit a claim
 *    (it could never match a transcript). Absent-announce → NO `violated` (the claim simply
 *    isn't emitted; at D, absence resolves `unverifiable`, never a false violation on the GTM
 *    cohort's own skills).
 *  - `scope` is adapter-ASSIGNED per skill kind, not source-extracted (no frontmatter `scope`).
 *  - `agentScope` is MANDATORY on every `event-triggered-window` claim (default = the opening
 *    event's root `AgentRef`) — concurrency is the GTM NORM (depth ≥3 fan-out + parallel
 *    dispatch), and a flat window without `agentScope` mis-attributes across subagent timelines.
 *    Overlapping/nested windows → `confidence:'low'` → `unverifiable` (flat windows in C; the
 *    `scope-depth` nesting model is RESERVED, not implemented).
 *
 * `extract` is PURE: reads only `group` bytes; never throws; degrades to `null`.
 */

/** The REAL per-skill announce literal: `**Announce at start:** "…"`. Captures the quoted text. */
const ANNOUNCE_RE = /\*\*Announce at start:\*\*\s*"([^"]+)"/;
/** A dispatch/fan-out skill body marker (the dispatch model). */
const DISPATCH_RE = /\b(?:Dispatch|dispatch)\b.*\b(?:subagent|agent|in [Pp]arallel)\b/;

/** Skill name from `name:` frontmatter, else the SKILL.md's parent directory name. */
function skillName(text: string, blobName: string): string {
  const fm = /^---\n([\s\S]*?)\n---/m.exec(text);
  const m = fm ? /^name:\s*(\S+)/m.exec(fm[1] ?? '') : null;
  if (m && m[1]) return m[1];
  // …/<skill>/SKILL.md → <skill>
  const parts = blobName.split('/');
  return parts.length >= 2 ? (parts[parts.length - 2] ?? blobName) : blobName;
}

function isSkillFile(name: string): boolean {
  return /(?:^|\/)SKILL\.md$/i.test(name);
}

/** A windowed claim's scope, with the MANDATORY root `agentScope` (concurrency axis). */
function windowScope(): ClaimScope {
  return {
    kind: 'event-triggered-window',
    opensOn: 'skill-announced',
    closesOn: 'next-skill-announce',
    agentScope: { kind: 'root' },
  };
}

function detect(group: NamedBlob[]): boolean {
  for (const b of group) {
    if (!isSkillFile(b.name)) continue;
    const t = decodeBlob(b.bytes);
    if (ANNOUNCE_RE.test(t) || /\bIron Law\b/.test(t) || DISPATCH_RE.test(t)) return true;
  }
  return false;
}

function extract(group: NamedBlob[]): Mandate | null {
  const claims: MandateClaim[] = [];

  for (const b of group) {
    if (!isSkillFile(b.name)) continue;
    const text = decodeBlob(b.bytes);
    const skill = skillName(text, b.name);

    // skill-announced — ONLY the real `**Announce at start:** "…"` literal (placeholder
    // graphviz templates carrying `[skill]`/`[purpose]` are excluded by the regex shape).
    const am = ANNOUNCE_RE.exec(text);
    if (am && am[1] && !/\[(?:skill|purpose)\]/.test(am[1])) {
      const announce = am[1];
      const src: ClaimSource = { kind: 'in-blob', blob: b.name, fidelity: 'verbatim' };
      claims.push({
        id: `${skill}:announced`,
        says: `announces "${announce}" at start`,
        kind: 'skill-announced',
        scope: windowScope(),
        source: src,
        // message-text predicate — literalsOnly pins it to a literal match (no prose-grep).
        predicate: {
          target: 'message-text',
          role: 'assistant',
          literalsOnly: true,
          scope: 'transcript',
          matcher: 'contains',
          value: announce,
        },
      });
    }

    // dispatch — the fan-out/parallel-dispatch model. A windowed claim with MANDATORY
    // agentScope; flat in C (nested fan-out degrades to unverifiable via confidence:'low').
    if (DISPATCH_RE.test(text)) {
      const src: ClaimSource = { kind: 'in-blob', blob: b.name, fidelity: 'derived' };
      claims.push({
        id: `${skill}:dispatch`,
        says: `${skill} dispatches subagents`,
        kind: 'dispatch',
        scope: windowScope(),
        source: src,
        confidence: 'low', // overlapping/nested windows are the GTM norm → unverifiable
        predicate: {
          target: 'subagent',
          scope: 'transcript',
          matcher: 'exists',
        },
      });
    }
  }

  if (!claims.length) return null;
  return { schemaVersion: 1, framework: 'superpowers', claims };
}

export const superpowersAdapter: MandateAdapter = { framework: 'superpowers', detect, extract };

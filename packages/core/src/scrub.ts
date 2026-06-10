/**
 * The CANONICAL scrub primitive (D2) — pure + versioned. Replaces absolute home paths,
 * emails, key-shaped tokens, and long hex with fixed glyphs so a scrubbed slice is still
 * deterministic and share-safe. anatrace OWNS this vocabulary; crack3d's local
 * `packages/engine/src/scrub.ts` ships the SAME `∎path`/`∎mail`/`∎key`/`∎hex` set and plans
 * to migrate onto these bytes when D ships, so the shared golden is bit-identical TODAY.
 *
 * `SCRUB_VERSION` stamps the vocabulary; the committed cross-repo in/out golden is the actual
 * drift guard (the stamp alone doesn't prevent drift). No code path builds an UNSCRUBBED dossier
 * slice — the slice constructor scrubs internally.
 */

/** The scrub vocabulary version (bumped on any rule change; pins the cross-repo golden). */
export const SCRUB_VERSION = '1';

/** A scrubbed excerpt — bounded, share-safe text pointing at a timeline location. */
export interface ScrubbedExcerpt {
  blobName: string;
  lineIndex: number;
  text: string;
}

const RULES: Array<[RegExp, string]> = [
  [/\/Users\/[^\s"'`)\]]+/g, '∎path'],
  [/\/home\/[a-z][^\s"'`)\]]*/g, '∎path'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '∎mail'],
  [/sk-[A-Za-z0-9_-]{8,}/g, '∎key'],
  [/ghp_[A-Za-z0-9]{8,}/g, '∎key'],
  [/AKIA[A-Z0-9]{8,}/g, '∎key'],
  [/\b[0-9a-f]{40}\b/g, '∎hex'],
];

/** Scrub one string (abs paths + emails + keys + long hex). Pure; bit-identical to crack3d. */
export function scrubText(text: string): string {
  let out = text;
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  return out;
}

/** Scrub a `Finding`-style message (the REQ requires scrub to cover finding output too). */
export function scrubFinding<T extends { message: string; location?: { file: string; line?: number } }>(
  finding: T,
): T {
  return {
    ...finding,
    message: scrubText(finding.message),
    ...(finding.location ? { location: { ...finding.location, file: scrubText(finding.location.file) } } : {}),
  };
}

/** Deep-scrub every string in a JSON-shaped value (returns a new value). Mirrors crack3d's `scrubDeep`. */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrubText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(v);
    return out as unknown as T;
  }
  return value;
}

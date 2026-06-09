import type { SessionEvent } from './session.js';

/**
 * Canonical event order (REQ Item 9): sort key = (ts ?? +Infinity, blobName, lineIndex).
 *
 * ts-absent lines sort last; blobName neutralizes filesystem discovery order; lineIndex
 * is the final tie-break for within/cross-file timestamp collisions. Pure + stable —
 * core re-sorts defensively and NEVER trusts input blob order (Item 9). Returns a new
 * array; does not mutate the input.
 */
export function canonicalSort(events: readonly SessionEvent[]): SessionEvent[] {
  return [...events].sort((a, b) => {
    const at = a.ts ?? Number.POSITIVE_INFINITY;
    const bt = b.ts ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    if (a.blobName !== b.blobName) return a.blobName < b.blobName ? -1 : 1;
    return a.lineIndex - b.lineIndex;
  });
}

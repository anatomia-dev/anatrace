import type { NormalizedSession } from './session.js';
import type { ContentResolver } from './types.js';

// Browser-safe ambient: core sets `types:[]` + `lib:["ES2022"]`, under which `TextEncoder`
// is unresolved. Declared minimally (no DOM lib → no fetch/window → purity wall stays green),
// mirroring the `TextDecoder` ambient in adapter.ts. `TextEncoder` is universal (Node + browser).
declare const TextEncoder: { new (): { encode(input?: string): Uint8Array } };

/**
 * Build a transcript-content {@link ContentResolver} (B4) PURELY from a parsed session's
 * edit events — NO disk read (the purity wall + browser/no-disk mode depend on this). It
 * returns the full bytes of a path the session ORIGINATED (Write/`add`), folding in-session
 * string-replace edits (Claude Edit/MultiEdit) on top, and an honest `null` for any path
 * whose full content is not reconstructible from the transcript alone:
 *   - a pre-existing-file edit (the base was never in the transcript),
 *   - a non-applicable / non-string diff (Codex `update`'s unified_diff, a NotebookEdit),
 *   - a hunk whose `before` text isn't found in the reconstructed content (faithful-or-null),
 *   - a deleted path.
 * This is the impl Cracked's browser mode runs on; disk is the CLI's separate impl.
 */
export function transcriptContentResolver(session: NormalizedSession): ContentResolver {
  const content = new Map<string, string | null>();

  for (const e of session.events) {
    if (e.type !== 'edit') continue;
    const path = e.paths[0];
    if (e.op === 'create') {
      if (path) content.set(path, typeof e.fullContent === 'string' ? e.fullContent : null);
    } else if (e.op === 'modify') {
      if (!path) continue;
      const base = content.get(path);
      if (typeof base === 'string' && e.hunks && e.hunks.length) {
        let next = base;
        let ok = true;
        for (const h of e.hunks) {
          if (next.includes(h.before)) next = next.replace(h.before, h.after);
          else {
            ok = false; // a hunk that doesn't apply ⇒ our reconstruction is unfaithful
            break;
          }
        }
        content.set(path, ok ? next : null);
      } else {
        content.set(path, null); // pre-existing base or non-string diff → honest null
      }
    } else if (e.op === 'rename') {
      const from = e.paths[0];
      const to = e.paths[1];
      if (from && to) {
        content.set(to, content.has(from) ? (content.get(from) ?? null) : null);
        content.delete(from);
      }
    } else if (e.op === 'delete') {
      if (path) content.set(path, null);
    }
  }

  const enc = new TextEncoder();
  return (path: string): Uint8Array | null => {
    const c = content.get(path);
    return typeof c === 'string' ? enc.encode(c) : null;
  };
}

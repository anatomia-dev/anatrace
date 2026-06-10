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

  // FI-13 (faithful-or-null): an Edit/Write whose adjacent tool_result was is_error:true was
  // VOIDED — the filesystem never received those bytes. Collect the voided tool_use ids and SKIP
  // the matching EditEvents below so the fold never replays bytes the FS never held. A path whose
  // ONLY basis was a voided edit therefore resolves null. (Claude-only: Codex patch_apply_end has
  // no edit↔result tool_use_id link to void by — see adapters/codex.ts.)
  const erroredToolUseIds = new Set<string>();
  for (const e of session.events) {
    if (e.type === 'toolResult' && e.isError === true && e.toolUseId) erroredToolUseIds.add(e.toolUseId);
  }

  for (const e of session.events) {
    if (e.type !== 'edit') continue;
    if (e.toolUseId && erroredToolUseIds.has(e.toolUseId)) continue; // FI-13: voided edit — do not fold
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
          if (!next.includes(h.before)) {
            ok = false; // a hunk that doesn't apply ⇒ our reconstruction is unfaithful
            break;
          }
          // FUNCTION replacement → literal semantics: `$&`/`$$`/`$\``/`$'`/`$1…` in the
          // edit's new text are inserted verbatim (a string replacement would interpret
          // them and corrupt regex-bearing code). `replaceAll` honors a `replace_all:true`
          // edit (a plain `.replace` only swaps the FIRST match → unfaithful bytes).
          next = h.replaceAll
            ? next.replaceAll(h.before, () => h.after)
            : next.replace(h.before, () => h.after);
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

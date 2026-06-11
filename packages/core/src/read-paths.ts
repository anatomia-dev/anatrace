import type { NormalizedSession, AgentRef } from './session.js';

/**
 * One read-tool `file_path`, with its timeline pointer (D1 `read-paths` / verify-independence).
 * POINTS into the canonical timeline (`blobName`/`lineIndex`) so a verdict's evidence is
 * scrub-safe and determinism-trivial, exactly like {@link EvidencePointer}.
 */
export interface ReadPath {
  path: string;
  agent: AgentRef;
  blobName: string;
  lineIndex: number;
}

/**
 * The `read-paths` projection (D1 deliverable — parallel to {@link skillsInvoked}).
 *
 * Spike-B PROVEN (precision 1.0 on 122 verify sessions / 1,362 paths / 0 FP): a verify-
 * independence verdict MUST bind to a READ TOOL's literal `file_path`, NEVER a substring
 * scan. So this pulls `file_path` ONLY from `ToolEvent{name:'Read'}.input.file_path` —
 *
 *   ✗ NEVER `Grep.pattern`/`Grep.path` (a query + a search root, not a read — 33 corpus
 *     `build_report` Grep hits, all correctly NOT a read);
 *   ✗ NEVER `Glob` (4 corpus hits);
 *   ✗ NEVER `Bash.command` substrings (281 corpus hits — `git diff … build_report.md`,
 *     `grep -v build_report` are diff-scoping, NOT reads; the 3 brand-lethal in-verify-session
 *     near-misses the binding kills).
 *
 * `NotebookRead` is NOT emitted by any adapter (zero in the engine) → not handled (this
 * SUPERSEDES the Spike-B draft's `{Read, NotebookRead}` list — `Read` ONLY).
 *
 * Bash-embedded reads (`cat`/`sed`/`head` of the report) live in a `Bash.command` string and
 * are OUT-OF-SCOPE here (Spike B: 17 corpus-wide, 0 inside verify sessions → zero recall cost);
 * D1 routes them to `unverifiable`, never a verdict.
 */
export function readPathsOf(session: NormalizedSession): ReadPath[] {
  const out: ReadPath[] = [];
  for (const e of session.events) {
    if (e.type !== 'tool' || e.name !== 'Read') continue;
    const input = e.input;
    if (typeof input !== 'object' || input === null) continue;
    const fp = (input as Record<string, unknown>)['file_path'];
    if (typeof fp !== 'string' || fp.length === 0) continue;
    out.push({ path: fp, agent: e.agent, blobName: e.blobName, lineIndex: e.lineIndex });
  }
  return out;
}

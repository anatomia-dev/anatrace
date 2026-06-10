import { rStr } from './shared.js';

/**
 * B1 human-message discriminator — the precision=1.0 moat-gate. A human `MessageEvent` is
 * emitted ONLY for genuinely human-typed prose. ALL exclusions are STRUCTURAL (flags +
 * EXACT wrapper tags), never semantic guesses, so a synthetic line is never emitted as
 * human (precision) and a genuine line is never dropped (recall) — both directions are
 * consumer-breaking, and a false human-constraint minted from a synthetic line is
 * brand-lethal for a verifier.
 *
 * ⚠️ FORWARD GUARD: the synthetic-tag denylists below are CORPUS-DERIVED (2026-06-10
 * byte-census of the real transcripts). They are FORMAT-DEPENDENT — the same fragility
 * class as the `isCompactSummary` flag: a NEW harness wrapper tag (`<…>`) shipped by a
 * future CLI version would slip through as "human" until added here. Periodically re-scan
 * user-role content for unrecognized leading `<tag>` wrappers; a new tag in the wild is the
 * signal to extend these lists (the B1 golden gate pins the current closed set).
 */

/** Claude interrupt marker — BOTH corpus variants (bare + "…for tool use"). → InterruptEvent, not prose. */
export const CLAUDE_INTERRUPT_RE = /^\[Request interrupted by user[^\]]*\]$/;

/**
 * Claude synthetic wrapper tags — EXACT leading-tag match (NOT a blanket `<`: a byte-census
 * found 0 genuine `<`-leading prose, and an exact list still protects future `<3`/code prose).
 * command-name/command-message = slash-command machinery; local-command-stdout = its output;
 * task-notification = a background-task injection; command-args = slash-command arguments
 * (C6a/FI-10 — added so a STRAY `<command-args>` line is excluded from prose even though the
 * normal `<command-name>` line is surfaced as a CommandEvent below). All model/harness-authored.
 */
export const CLAUDE_SYNTHETIC_TAG_RE =
  /^\s*<(command-name|command-message|command-args|local-command-stdout|task-notification)>/;

/**
 * A slash-command line (C6a): `<command-name>/foo</command-name>` with an optional
 * `<command-args>…</command-args>`. Extract `{command, args}` from the FIRST `<command-name>`
 * (the line may also carry a `<command-message>` echo, which we ignore). Returns `null` when
 * the text does not lead with `<command-name>`.
 */
const COMMAND_NAME_RE = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([^<]*)<\/command-args>/;
export function parseCommandLine(text: string): { command: string; args?: string } | null {
  if (!/^\s*<command-name>/.test(text)) return null;
  const nameM = COMMAND_NAME_RE.exec(text);
  if (!nameM) return null;
  const command = (nameM[1] ?? '').trim();
  if (!command) return null;
  const argsM = COMMAND_ARGS_RE.exec(text);
  const args = argsM ? (argsM[1] ?? '').trim() : '';
  return args ? { command, args } : { command };
}

/** Codex synthetic injections — structural markers only (genuine prose like "hey ana" emits). */
export const CODEX_SYNTHETIC_RE =
  /^\s*(# AGENTS\.md|<environment_context>|<user_instructions>|<turn_aborted>)/;

export type ClaudeUserKind =
  | { kind: 'message'; text: string }
  | { kind: 'interrupt' }
  | { kind: 'command'; command: string; args?: string }
  | { kind: 'skip' };

/**
 * Human text from a Claude `message.content`: a bare STRING (~17% of user lines) OR an
 * ARRAY of blocks (join the `text` blocks; drop `image`/`tool_result`). A multimodal line
 * thus yields its text and drops image blocks — never the whole line (a false negative
 * breaks consumers too).
 */
export function claudeUserText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (typeof b !== 'object' || b === null) continue;
      const block = b as Record<string, unknown>;
      if (rStr(block, 'type') === 'text') parts.push(rStr(block, 'text'));
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Classify a Claude `type:'user'` line. `line` carries the structural flags; `content` is
 * `message.content`; `isSubagentBlob` is the blob-level sidechain signal (sidecar files are
 * entirely sidechain). Returns the interrupt marker as `interrupt`, machine/synthetic lines
 * as `skip`, and genuine human prose as `message`.
 */
export function classifyClaudeUser(
  line: Record<string, unknown>,
  content: unknown,
  isSubagentBlob: boolean,
): ClaudeUserKind {
  if (
    isSubagentBlob ||
    line['isSidechain'] === true ||
    line['isCompactSummary'] === true ||
    line['isVisibleInTranscriptOnly'] === true ||
    line['isMeta'] === true
  ) {
    return { kind: 'skip' };
  }
  const text = claudeUserText(content);
  if (CLAUDE_INTERRUPT_RE.test(text.trim())) return { kind: 'interrupt' };
  // C6a: surface a slash-command line as a structured CommandEvent (instead of skipping it).
  // Must run BEFORE the synthetic-tag skip (which now also denylists <command-args> for prose).
  const cmd = parseCommandLine(text);
  if (cmd) return { kind: 'command', ...cmd };
  if (CLAUDE_SYNTHETIC_TAG_RE.test(text)) return { kind: 'skip' };
  if (!text.trim()) return { kind: 'skip' };
  return { kind: 'message', text };
}

/** True when a Codex user message is a synthetic injection (skip); false for genuine prose (emit). */
export function isCodexSynthetic(text: string): boolean {
  return CODEX_SYNTHETIC_RE.test(text);
}

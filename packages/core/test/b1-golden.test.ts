import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import type { NamedBlob } from '../src/adapter.js';
import type { MessageEvent, SessionEvent } from '../src/session.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

/**
 * B1.e — the human-message extraction GOLDEN GATE (the moat-gate). A labeled synthetic
 * fixture set (NEVER real transcripts — house rule) covering EVERY discriminator class.
 * Gate: precision = 1.0 (no synthetic line emitted as human) AND recall = 1.0 (no human
 * line dropped). A leaked synthetic line — above all an `isCompactSummary` essay — would
 * mint a false `human-constraint` and is brand-lethal for a verifier, so it gets its own
 * named assertion.
 *
 * Labels: 'human' (must emit), 'synthetic' (must NOT emit), 'interrupt' (→ InterruptEvent),
 * 'toolresult' (→ toolResult, not a human message).
 */

interface Labeled {
  label: 'human' | 'synthetic' | 'interrupt' | 'toolresult';
  note: string;
  line: Record<string, unknown>;
}

let ts = 0;
const at = (): string => `2026-06-08T00:00:${String(ts++).padStart(2, '0')}.000Z`;
const uline = (content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'user',
  sessionId: 'sess-b1',
  uuid: `u-${ts}`,
  timestamp: at(),
  ...extra,
  message: { role: 'user', content },
});

const CLAUDE: Labeled[] = [
  { label: 'human', note: 'string content (the ~17% bare-string class)', line: uline('please refactor the parser') },
  { label: 'human', note: 'array text block', line: uline([{ type: 'text', text: 'add tests too' }]) },
  { label: 'human', note: 'terse prose', line: uline('yes') },
  { label: 'human', note: 'prose starting with < but not a wrapper tag', line: uline([{ type: 'text', text: '<3 thanks, ship it' }]) },
  { label: 'human', note: 'multimodal — text emitted, image dropped', line: uline([{ type: 'text', text: 'look at this screenshot' }, { type: 'image', source: {} }]) },
  { label: 'synthetic', note: 'isCompactSummary (HIGHEST severity)', line: uline('This session is being continued from a previous conversation that ran out of context. The summary below covers everything...', { isCompactSummary: true, isVisibleInTranscriptOnly: true }) },
  { label: 'synthetic', note: 'isVisibleInTranscriptOnly', line: uline([{ type: 'text', text: 'not visible to model' }], { isVisibleInTranscriptOnly: true }) },
  { label: 'synthetic', note: 'isMeta', line: uline([{ type: 'text', text: 'meta line' }], { isMeta: true }) },
  { label: 'synthetic', note: 'slash-command <command-name>', line: uline('<command-name>commit</command-name>') },
  { label: 'synthetic', note: '<local-command-stdout>', line: uline('<local-command-stdout>build ok</local-command-stdout>') },
  { label: 'synthetic', note: '<task-notification>', line: uline('<task-notification>\n<task-id>abc</task-id>\n</task-notification>') },
  { label: 'synthetic', note: '<command-message>', line: uline('<command-message>running</command-message>') },
  { label: 'interrupt', note: 'interrupt marker — bare', line: uline([{ type: 'text', text: '[Request interrupted by user]' }]) },
  { label: 'interrupt', note: 'interrupt marker — for tool use', line: uline([{ type: 'text', text: '[Request interrupted by user for tool use]' }]) },
  { label: 'toolresult', note: 'tool_result delivery (not human prose)', line: uline([{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }]) },
];

// The set of texts that MUST appear as human messages (recall) and MUST NOT (precision).
const HUMAN_TEXTS = ['please refactor the parser', 'add tests too', 'yes', '<3 thanks, ship it', 'look at this screenshot'];

function humanMessages(events: SessionEvent[]): MessageEvent[] {
  return events.filter((e): e is MessageEvent & SessionEvent => e.type === 'message' && e.role === 'user');
}

describe('B1.e — Claude human-message golden gate (precision = recall = 1.0)', () => {
  // A seed assistant turn + all labeled user lines in the PARENT blob, plus a SUBAGENT blob
  // whose user line must never be emitted as human (blob-level sidechain).
  const parentLines = jsonl([
    { type: 'assistant', sessionId: 'sess-b1', uuid: 'a0', timestamp: at(), message: { id: 'm0', role: 'assistant', model: 'claude-opus-4-8', content: [], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    ...CLAUDE.map((c) => c.line),
  ]);
  const subagentLines = jsonl([
    uline([{ type: 'text', text: 'SUBAGENT-PROMPT-must-not-emit' }], { isSidechain: true }),
  ]);
  const group: NamedBlob[] = [
    { name: 'parent', bytes: enc(parentLines) },
    { name: 'subagents/agent-sub1.jsonl', bytes: enc(subagentLines) },
  ];
  const session = claudeAdapter.parse(group)!;
  const msgs = humanMessages(session.events);
  const emittedTexts = msgs.map((m) => m.text ?? '');

  it('recall = 1.0 — every human line emits exactly one human message', () => {
    for (const t of HUMAN_TEXTS) {
      expect(emittedTexts.filter((x) => x === t).length).toBe(1);
    }
  });

  it('precision = 1.0 — emits ONLY the human lines (no synthetic/interrupt/toolresult/sidechain)', () => {
    expect(emittedTexts.sort()).toEqual([...HUMAN_TEXTS].sort());
  });

  it('NAMED: zero isCompactSummary-derived human messages', () => {
    expect(emittedTexts.some((t) => t.includes('This session is being continued'))).toBe(false);
  });

  it('the subagent (sidechain) user line is never emitted as a human message', () => {
    expect(emittedTexts.some((t) => t.includes('SUBAGENT-PROMPT'))).toBe(false);
  });

  it('BOTH interrupt markers → InterruptEvent (symmetric), never human prose', () => {
    const interrupts = session.events.filter((e) => e.type === 'interrupt');
    expect(interrupts.length).toBe(2);
    expect(emittedTexts.some((t) => t.includes('Request interrupted'))).toBe(false);
  });

  it('the tool_result line still yields a toolResult event (unchanged)', () => {
    expect(session.events.some((e) => e.type === 'toolResult')).toBe(true);
  });
});

describe('B1.e — Codex human-message golden gate (symmetric, structural exclusions)', () => {
  let cts = 0;
  const cat = (): string => `2026-06-08T00:01:${String(cts++).padStart(2, '0')}.000Z`;
  const umsg = (text: string): Record<string, unknown> => ({
    type: 'response_item',
    timestamp: cat(),
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  });
  const lines = jsonl([
    { type: 'session_meta', timestamp: cat(), payload: { id: 'sess-codex-b1', originator: 'codex_cli', cli_version: '0.9.1' } },
    { type: 'turn_context', timestamp: cat(), payload: { model: 'gpt-5.5' } },
    umsg('hey ana'), // human
    umsg('# AGENTS.md instructions for /Users/x/proj\n<rules>...</rules>'), // synthetic
    umsg('<environment_context>\n<cwd>/tmp</cwd>\n</environment_context>'), // synthetic
    umsg('<user_instructions>\nbe terse\n</user_instructions>'), // synthetic
    umsg('<turn_aborted> The user interrupted the previous turn on purpose.'), // synthetic
    umsg('Do the PR merge. No squash.'), // human (no wrapper → emits, even though imperative)
  ]);
  const session = codexAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
  const emitted = humanMessages(session.events).map((m) => m.text ?? '');

  it('emits ONLY genuine prose; excludes all four synthetic structural classes', () => {
    expect(emitted.sort()).toEqual(['Do the PR merge. No squash.', 'hey ana'].sort());
  });
});

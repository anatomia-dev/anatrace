import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import type { NamedBlob } from '../src/adapter.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

function claudeAssistant(id: string, isSidechain: boolean, usage: Record<string, number>, ts: string) {
  return {
    type: 'assistant',
    isSidechain,
    requestId: `req-${id}-${usage['output_tokens'] ?? 0}`,
    sessionId: 'sess-claude-1',
    uuid: `u-${id}-${ts}`,
    version: '1.0.0',
    timestamp: ts,
    message: { id, model: 'claude-opus-4-8', type: 'message', role: 'assistant', content: [], usage },
  };
}

describe('A3 — Claude adapter: sidechain-first MAX dedup + canary', () => {
  // m1: same id, output 59 then 1 (trailing fragment) → MAX keeps 59; the decrease trips the canary.
  // m2: non-sidechain (total 10) vs sidechain replay (total 110) → keep the NON-sidechain copy.
  const lines = jsonl([
    claudeAssistant('m1', false, { input_tokens: 10, output_tokens: 59, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, '2026-06-08T00:00:01.000Z'),
    claudeAssistant('m1', false, { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, '2026-06-08T00:00:02.000Z'),
    claudeAssistant('m2', false, { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, '2026-06-08T00:00:03.000Z'),
    claudeAssistant('m2', true, { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 }, '2026-06-08T00:00:04.000Z'),
  ]);
  const group: NamedBlob[] = [{ name: 'parent', bytes: enc(lines) }];

  it('picks MAX total per message.id and the non-sidechain copy', () => {
    const s = claudeAdapter.parse(group);
    expect(s).not.toBeNull();
    // m1 → output 59 (not 1, not 60); m2 → non-sidechain (cache_read 0, not 100).
    expect(s!.counts.tokens.output).toBe(64); // 59 + 5
    expect(s!.counts.tokens.input).toBe(15); // 10 + 5
    expect(s!.counts.tokens.cache_read).toBe(0); // sidechain replay's 100 rejected
  });

  it('FLAGS the non-monotonic id via the canary (never throws/fails)', () => {
    claudeAdapter.parse(group);
    expect(claudeAdapter.capabilities.tokenTotalSuspect).toBe(true);
  });

  it('detect() is true for Claude bytes, false for Codex bytes', () => {
    expect(claudeAdapter.detect(enc(lines))).toBe(true);
    expect(claudeAdapter.detect(enc(JSON.stringify({ type: 'session_meta', payload: { originator: 'codex_cli' } })))).toBe(false);
  });
});

describe('A4 — Codex adapter: exec_command vs write_stdin + move_path rename + cache-subtract', () => {
  const lines = jsonl([
    { type: 'session_meta', timestamp: '2026-06-08T00:00:00.000Z', payload: { id: 'sess-codex-1', originator: 'codex_cli', cli_version: '0.9.1' } },
    { type: 'turn_context', timestamp: '2026-06-08T00:00:01.000Z', payload: { model: 'gpt-5.5' } },
    { type: 'response_item', timestamp: '2026-06-08T00:00:01.500Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    { type: 'response_item', timestamp: '2026-06-08T00:00:02.000Z', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1' } },
    { type: 'response_item', timestamp: '2026-06-08T00:00:03.000Z', payload: { type: 'function_call', name: 'write_stdin', call_id: 'c2' } },
    { type: 'event_msg', timestamp: '2026-06-08T00:00:04.000Z', payload: { type: 'patch_apply_end', success: true, changes: { '/work/proj/a.ts': { type: 'update', move_path: '/work/proj/b.ts' } } } },
    { type: 'event_msg', timestamp: '2026-06-08T00:00:05.000Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, total_tokens: 120 } } } },
  ]);
  const group: NamedBlob[] = [{ name: 'parent', bytes: enc(lines) }];

  it('counts exec_command as a command but NOT write_stdin', () => {
    const s = codexAdapter.parse(group);
    expect(s).not.toBeNull();
    expect(s!.counts.commands_run).toBe(1); // exec_command only
    expect(s!.counts.tool_calls).toBe(3); // exec_command + write_stdin + the rename edit
  });

  it('maps a move_path-bearing update to op:rename with two paths', () => {
    const s = codexAdapter.parse(group)!;
    const rename = s.events.find((e) => e.type === 'edit' && e.op === 'rename');
    expect(rename).toBeDefined();
    expect((rename as { paths: string[] }).paths).toEqual(['/work/proj/a.ts', '/work/proj/b.ts']);
  });

  it('cache-subtracts Codex input (non_cached = input - cached)', () => {
    const s = codexAdapter.parse(group)!;
    expect(s.counts.tokens.input).toBe(60); // 100 - 40
    expect(s.counts.tokens.cache_read).toBe(40);
    expect(s.counts.tokens.output).toBe(20);
    expect(s.counts.tokens.cache_create).toBe(0);
    expect(s.counts.model).toBe('gpt-5.5');
  });

  it('detect() is mutually exclusive with the Claude adapter', () => {
    expect(codexAdapter.detect(enc(lines))).toBe(true);
    expect(claudeAdapter.detect(enc(lines))).toBe(false);
  });
});

describe('A0 — detect-window robustness (metadata-front-loaded sessions)', () => {
  // Real shape (corpus): sessions front-load agent-setting / last-prompt / permission-mode /
  // mode / queue-operation metadata lines before the first real message. A real session
  // (ebdf7d39) carries its first `user` line at index 49 — past the old first-8 window.
  const metaPrefix = [
    { type: 'agent-setting', agentSetting: 'opus' },
    { type: 'last-prompt', value: 'continue' },
    { type: 'permission-mode', mode: 'default' },
    { type: 'mode', mode: 'normal' },
    { type: 'queue-operation', op: 'enqueue' },
    { type: 'agent-setting', agentSetting: 'sonnet' },
    { type: 'permission-mode', mode: 'plan' },
    { type: 'mode', mode: 'normal' },
    { type: 'last-prompt', value: 'go' },
    { type: 'agent-setting', agentSetting: 'opus' }, // 10 metadata lines — well past the old slice(0,8)
  ];

  it('detects a Claude session whose first 8+ lines are pure metadata', () => {
    const userLine = {
      type: 'user',
      sessionId: 'sess-claude-meta',
      uuid: 'u-1',
      timestamp: '2026-06-08T00:00:10.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hey ana' }] },
    };
    expect(claudeAdapter.detect(enc(jsonl([...metaPrefix, userLine])))).toBe(true);
  });

  it('does NOT over-detect a metadata-only stub (no conversation anywhere)', () => {
    // The 3 corpus "failures" are 2-3-line abandoned stubs with no message → correctly false.
    const stub = jsonl([
      { type: 'last-prompt', value: 'x' },
      { type: 'permission-mode', mode: 'default' },
    ]);
    expect(claudeAdapter.detect(enc(stub))).toBe(false);
  });
});

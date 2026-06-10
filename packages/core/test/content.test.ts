import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { transcriptContentResolver } from '../src/content.js';
import type { NamedBlob } from '../src/adapter.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null): string | null => (b ? new TextDecoder().decode(b) : null);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

function assistantWithTools(tools: unknown[], ts: string): Record<string, unknown> {
  return {
    type: 'assistant',
    sessionId: 's',
    uuid: `u-${ts}`,
    timestamp: ts,
    message: { id: `m-${ts}`, role: 'assistant', model: 'claude-opus-4-8', content: tools, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  };
}
const tool = (name: string, input: unknown) => ({ type: 'tool_use', name, input });

describe('B4 — transcript-content resolver (pure, no disk; honest null)', () => {
  it('returns FULL content for a Write-originated file', () => {
    const lines = jsonl([
      assistantWithTools([tool('Write', { file_path: '/r/a.ts', content: 'export const a = 1;\n' })], '2026-06-08T00:00:01.000Z'),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    const resolve = transcriptContentResolver(s);
    expect(dec(resolve('/r/a.ts'))).toBe('export const a = 1;\n');
  });

  it('FOLDS an in-session Edit on a session-created file', () => {
    const lines = jsonl([
      assistantWithTools([tool('Write', { file_path: '/r/a.ts', content: 'const x = 1;' })], '2026-06-08T00:00:01.000Z'),
      assistantWithTools([tool('Edit', { file_path: '/r/a.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' })], '2026-06-08T00:00:02.000Z'),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(dec(transcriptContentResolver(s)('/r/a.ts'))).toBe('const x = 2;');
  });

  it('honest NULL for a pre-existing-file edit (base never in the transcript)', () => {
    const lines = jsonl([
      assistantWithTools([tool('Edit', { file_path: '/r/preexisting.ts', old_string: 'foo', new_string: 'bar' })], '2026-06-08T00:00:01.000Z'),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(transcriptContentResolver(s)('/r/preexisting.ts')).toBeNull();
  });

  it('honest NULL when a hunk does not apply to the reconstructed content', () => {
    const lines = jsonl([
      assistantWithTools([tool('Write', { file_path: '/r/a.ts', content: 'alpha' })], '2026-06-08T00:00:01.000Z'),
      assistantWithTools([tool('Edit', { file_path: '/r/a.ts', old_string: 'NOT-PRESENT', new_string: 'x' })], '2026-06-08T00:00:02.000Z'),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(transcriptContentResolver(s)('/r/a.ts')).toBeNull();
  });

  it('null for an unknown path', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistantWithTools([], '2026-06-08T00:00:01.000Z')])) }])!;
    expect(transcriptContentResolver(s)('/nope')).toBeNull();
  });

  it('LITERAL replacement: an Edit whose new_string contains $&/$1 reconstructs byte-exactly (no $-pattern corruption)', () => {
    const before = 'PLACEHOLDER';
    const after = 'const re = s.replace(/(\\w+)/, "$1=$&"); // $$ $` literal';
    const lines = jsonl([
      assistantWithTools([tool('Write', { file_path: '/r/a.ts', content: `x ${before} y` })], '2026-06-08T00:00:01.000Z'),
      assistantWithTools([tool('Edit', { file_path: '/r/a.ts', old_string: before, new_string: after })], '2026-06-08T00:00:02.000Z'),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(dec(transcriptContentResolver(s)('/r/a.ts'))).toBe(`x ${after} y`);
  });

  it('replace_all:true folds ALL occurrences of old_string', () => {
    const lines = jsonl([
      assistantWithTools([tool('Write', { file_path: '/r/a.ts', content: 'foo foo foo' })], '2026-06-08T00:00:01.000Z'),
      assistantWithTools([tool('Edit', { file_path: '/r/a.ts', old_string: 'foo', new_string: 'bar', replace_all: true })], '2026-06-08T00:00:02.000Z'),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(dec(transcriptContentResolver(s)('/r/a.ts'))).toBe('bar bar bar');
  });

  it('without replace_all only the FIRST occurrence folds (default Edit semantics)', () => {
    const lines = jsonl([
      assistantWithTools([tool('Write', { file_path: '/r/a.ts', content: 'foo foo foo' })], '2026-06-08T00:00:01.000Z'),
      assistantWithTools([tool('Edit', { file_path: '/r/a.ts', old_string: 'foo', new_string: 'bar' })], '2026-06-08T00:00:02.000Z'),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(dec(transcriptContentResolver(s)('/r/a.ts'))).toBe('bar foo foo');
  });

  it('a non-applicable hunk still yields honest null (guard preserved under the function-replace)', () => {
    const lines = jsonl([
      assistantWithTools([tool('Write', { file_path: '/r/a.ts', content: 'alpha' })], '2026-06-08T00:00:01.000Z'),
      assistantWithTools([tool('Edit', { file_path: '/r/a.ts', old_string: 'NOPE', new_string: '$&x', replace_all: true })], '2026-06-08T00:00:02.000Z'),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(transcriptContentResolver(s)('/r/a.ts')).toBeNull();
  });

  it('Codex `add` carries full content; `update` (unified_diff) → honest null', () => {
    const lines = jsonl([
      { type: 'session_meta', timestamp: '2026-06-08T00:00:00.000Z', payload: { id: 'sc', originator: 'codex_cli', cli_version: '0.9' } },
      { type: 'turn_context', timestamp: '2026-06-08T00:00:01.000Z', payload: { model: 'gpt-5.5' } },
      { type: 'event_msg', timestamp: '2026-06-08T00:00:02.000Z', payload: { type: 'patch_apply_end', success: true, changes: { '/r/new.ts': { type: 'add', content: 'created by codex\n' } } } },
      { type: 'event_msg', timestamp: '2026-06-08T00:00:03.000Z', payload: { type: 'patch_apply_end', success: true, changes: { '/r/old.ts': { type: 'update', unified_diff: '@@ -1 +1 @@\n-a\n+b\n' } } } },
    ]);
    const s = codexAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    const resolve = transcriptContentResolver(s);
    expect(dec(resolve('/r/new.ts'))).toBe('created by codex\n');
    expect(resolve('/r/old.ts')).toBeNull();
  });
});

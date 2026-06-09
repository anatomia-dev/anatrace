import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import type { NamedBlob } from '../src/adapter.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

function assistant(id: string, ts: string) {
  return {
    type: 'assistant',
    isSidechain: false,
    sessionId: 'sess-1',
    uuid: `u-${id}-${ts}`,
    version: '1.0.0',
    timestamp: ts,
    message: { id, model: 'claude-opus-4-8', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  };
}

describe('A10 — canonical event order (shuffled blob order → byte-identical events)', () => {
  // A timestamp collision (T1 on both the parent and a subagent line) forces the
  // (blobName, lineIndex) tie-break — the part that input blob order could corrupt.
  const T1 = '2026-06-08T00:00:01.000Z';
  const T2 = '2026-06-08T00:00:02.000Z';
  const parent = enc(jsonl([assistant('m1', T1), assistant('m2', T2)]));
  const subA = enc(jsonl([assistant('s1', T1)]));
  const subB = enc(jsonl([assistant('s2', T2)]));

  const sorted: NamedBlob[] = [
    { name: 'parent', bytes: parent },
    { name: 'subagents/agent-aaa.jsonl', bytes: subA },
    { name: 'subagents/agent-bbb.jsonl', bytes: subB },
  ];
  const shuffled: NamedBlob[] = [
    { name: 'subagents/agent-bbb.jsonl', bytes: subB },
    { name: 'parent', bytes: parent },
    { name: 'subagents/agent-aaa.jsonl', bytes: subA },
  ];

  it('core re-sorts defensively: events are identical regardless of input blob order', () => {
    const a = claudeAdapter.parse(sorted);
    const b = claudeAdapter.parse(shuffled);
    expect(a).not.toBeNull();
    expect(JSON.stringify(a!.events)).toBe(JSON.stringify(b!.events));
  });
});

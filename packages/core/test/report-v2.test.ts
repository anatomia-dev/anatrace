import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyze.js';
import { claudeAdapter } from '../src/adapters/claude.js';
import type { NamedBlob } from '../src/adapter.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

describe('A5 — Report v2 envelope (sessionId + timeBounds?)', () => {
  const lines = jsonl([
    {
      type: 'assistant',
      sessionId: 'sess-abc',
      uuid: 'u1',
      timestamp: '2026-06-08T00:00:01.000Z',
      message: { id: 'm1', role: 'assistant', model: 'claude-opus-4-8', content: [], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
    {
      type: 'assistant',
      sessionId: 'sess-abc',
      uuid: 'u2',
      timestamp: '2026-06-08T00:00:05.000Z',
      message: { id: 'm2', role: 'assistant', model: 'claude-opus-4-8', content: [], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
  ]);
  const group: NamedBlob[] = [{ name: 'parent', bytes: enc(lines) }];

  it('schemaVersion is 2', () => {
    const s = claudeAdapter.parse(group)!;
    expect(analyze(s).schemaVersion).toBe(2);
  });

  it('carries session.sessionId from the parsed session', () => {
    const s = claudeAdapter.parse(group)!;
    expect(analyze(s).session.sessionId).toBe('sess-abc');
  });

  it('timeBounds spans the events and end-start === counts.duration_ms', () => {
    const s = claudeAdapter.parse(group)!;
    const r = analyze(s);
    expect(r.session.timeBounds).toBeDefined();
    expect(r.session.timeBounds!.start).toBe(Date.parse('2026-06-08T00:00:01.000Z'));
    expect(r.session.timeBounds!.end).toBe(Date.parse('2026-06-08T00:00:05.000Z'));
    expect(r.session.timeBounds!.end - r.session.timeBounds!.start).toBe(r.session.counts.duration_ms);
  });

  it('timeBounds is ABSENT when no event carries a ts (exactOptionalPropertyTypes-safe)', () => {
    const noTs = jsonl([
      { type: 'assistant', sessionId: 'sess-x', uuid: 'u1', message: { id: 'm1', role: 'assistant', model: 'claude-opus-4-8', content: [], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(noTs) }])!;
    const r = analyze(s);
    expect('timeBounds' in r.session).toBe(false);
    expect(r.session.counts.duration_ms).toBe(0);
  });

  it('ProvenanceCounts is byte-identical regardless of v2 envelope (counts not touched)', () => {
    const s = claudeAdapter.parse(group)!;
    // The counts object on the report is the same one the derive produced.
    expect(JSON.stringify(analyze(s).session.counts)).toBe(JSON.stringify(s.counts));
  });
});

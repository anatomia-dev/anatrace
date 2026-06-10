import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyze.js';
import type { Capabilities } from '../src/types.js';
import type { NormalizedSession, SessionEvent } from '../src/session.js';
import type { ProvenanceCounts } from '../src/provenance.js';

function counts(): ProvenanceCounts {
  return {
    tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0 },
    price_table_version: '2026-06-08',
    derive_version: '1',
    duration_ms: 0,
    turns: 0,
    tool_calls: 0,
    commands_run: 0,
    tests_executed: 0,
    failures_encountered: 0,
    files_touched: 0,
    model: 'claude-opus-4-8',
  };
}

const events: SessionEvent[] = [
  { type: 'interrupt', reason: 'interrupted', agent: { kind: 'root' }, blobName: 'p', lineIndex: 0 },
  { type: 'toolResult', text: 'boom', isError: true, agent: { kind: 'root' }, blobName: 'p', lineIndex: 1 },
];

const session: NormalizedSession = {
  schemaVersion: 1,
  harness: 'claude',
  sessionId: 's',
  observedVersions: ['1.0.0'],
  subagents: [],
  events,
  counts: counts(),
};

describe('A4 — capability channel (parser + judge): threadable + inert in A+B', () => {
  it('injecting capabilities produces byte-identical output (no impl consumed this pass)', () => {
    // A fully-populated capability channel — both a parser and a judge impl.
    const capabilities: Capabilities = {
      parser: { parse: (src: string) => ({ root: src.length }) },
      judge: () => ({ verdict: 'unverifiable' }),
    };
    const without = analyze(session);
    const withCaps = analyze(session, undefined, capabilities);
    // The seam is the deliverable; nothing in A+B reads it → deterministic record unchanged.
    expect(JSON.stringify(withCaps)).toBe(JSON.stringify(without));
  });
});

import { describe, it, expect } from 'vitest';
import { deriveCounts, DERIVE_VERSION } from '../src/derive.js';
import type { NormalizedSession, SessionEvent } from '../src/session.js';

const root = { agent: { kind: 'root' as const } };
let li = 0;
const ev = (body: Partial<SessionEvent> & { type: string }, ts?: number): SessionEvent =>
  ({ ...root, blobName: 'p', lineIndex: li++, ...(ts !== undefined ? { ts } : {}), ...body }) as SessionEvent;

// R2-shaped base: assistant turn + usage + a tool, timestamps within [1000, 3000].
const base = (): SessionEvent[] => {
  li = 0;
  return [
    ev({ type: 'message', role: 'assistant', model: 'claude-opus-4-8' }, 1000),
    ev({ type: 'usage', usage: { input: 10, output: 20, cache_create: 0, cache_read: 0 }, messageId: 'm1', isSidechain: false, cumulative: false }, 1000),
    ev({ type: 'tool', name: 'Bash' }, 2000),
    ev({ type: 'toolResult', text: '3 passed', isError: false }, 3000),
  ];
};

/**
 * B1.d — emitting human MessageEvents carries user-line timestamps into the min/max window,
 * so `duration_ms` can widen for identical bytes → DERIVE_VERSION bumped to '2'. The frozen
 * tier is SAFE (foldTokens reads only `usage`; turns is assistant-guarded). This proves the
 * delta is EXACTLY `duration_ms`, in BOTH directions.
 */
describe('B1.d — determinism diff: ONLY duration_ms moves (both directions)', () => {
  it('DERIVE_VERSION is bumped to "2"', () => {
    expect(DERIVE_VERSION).toBe('2');
  });

  it('direction A — a human message + interrupt OUTSIDE the window: ONLY duration_ms changes', () => {
    const r2 = deriveCounts({ events: base() } as NormalizedSession);
    const withHuman = base();
    li = 100;
    withHuman.push(ev({ type: 'message', role: 'user', text: 'do the thing' }, 5000)); // widens maxTs 3000 → 5000
    withHuman.push(ev({ type: 'interrupt', reason: 'interrupted' }, 6000)); // widens further
    const b1 = deriveCounts({ events: withHuman } as NormalizedSession);

    // duration_ms MOVED (3000-1000=2000 → 6000-1000=5000)
    expect(r2.duration_ms).toBe(2000);
    expect(b1.duration_ms).toBe(5000);
    // EVERYTHING ELSE identical — compare with duration_ms neutralized.
    expect({ ...b1, duration_ms: 0 }).toEqual({ ...r2, duration_ms: 0 });
    // Frozen tier explicitly unchanged.
    expect(b1.tokens).toEqual(r2.tokens);
    expect(b1.turns).toBe(r2.turns); // human (role:user) message does NOT add a turn
    expect(b1.tool_calls).toBe(r2.tool_calls);
  });

  it('direction B — a human message INSIDE the window: ZERO delta', () => {
    const r2 = deriveCounts({ events: base() } as NormalizedSession);
    const withHuman = base();
    li = 200;
    withHuman.push(ev({ type: 'message', role: 'user', text: 'within window' }, 2500)); // inside [1000,3000]
    const b1 = deriveCounts({ events: withHuman } as NormalizedSession);
    expect(JSON.stringify(b1)).toBe(JSON.stringify(r2)); // byte-identical — no widening
  });
});

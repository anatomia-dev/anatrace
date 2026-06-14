/**
 * P0.9 (Phase 0, Step 6) — Codex multi-file tree discovery.
 *
 * Real Codex stores a delegate/subagent session as a SEPARATE `rollout-*.jsonl` in the same date
 * directory, linked to its parent by `session_meta.parent_thread_id`. Discovery used to pass core
 * only the single parent rollout, so the Codex reachability engine never ran on real input. This
 * test builds the REAL date-dir/`rollout-*` layout on a temp fs and proves discovery now gathers the
 * child tree and the reachability engine produces a non-empty lineage.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseSession, extractLineage } from 'anatrace-core';
import { discoverByPath } from '../src/discover.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

const PARENT_ID = '019e8006-parent';
const CHILD_ID = '019e8006-child';

const parentRollout = jsonl([
  { type: 'session_meta', payload: { id: PARENT_ID, cwd: '/r', originator: 'codex-tui', cli_version: '0.139.0', source: 'cli', thread_source: 'user' } },
  { timestamp: '2026-06-13T06:00:01.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'ls -la' }), call_id: 'c1' } },
]);

// A real child: a separate rollout whose session_meta links back via parent_thread_id.
const childRollout = jsonl([
  { type: 'session_meta', payload: { id: CHILD_ID, parent_thread_id: PARENT_ID, cwd: '/r', cli_version: '0.139.0', source: { subagent: { thread_spawn: { parent_thread_id: PARENT_ID, depth: 1 } } } } },
  { timestamp: '2026-06-13T06:00:02.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'grep -r foo .' }), call_id: 'c2' } },
]);

let tmpRoot: string | null = null;

function layoutRealCodexTree(): { parentPath: string } {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anatrace-codex-'));
  const dateDir = path.join(tmpRoot, 'sessions', '2026', '06', '13');
  fs.mkdirSync(dateDir, { recursive: true });
  const parentPath = path.join(dateDir, `rollout-2026-06-13T06-00-00-${PARENT_ID}.jsonl`);
  const childPath = path.join(dateDir, `rollout-2026-06-13T06-00-05-${CHILD_ID}.jsonl`);
  fs.writeFileSync(parentPath, parentRollout);
  fs.writeFileSync(childPath, childRollout);
  return { parentPath };
}

afterEach(() => {
  if (tmpRoot) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
});

describe('P0.9 — Codex discovery gathers the child rollout tree (not just the parent blob)', () => {
  it('discoverByPath collects the parent + the sibling child rollout (multi-file group)', () => {
    const { parentPath } = layoutRealCodexTree();
    const group = discoverByPath(parentPath);
    expect(group).not.toBeNull();
    expect(group!.harness).toBe('codex');
    // The old code returned exactly ONE blob; the tree must now have the parent + the child.
    expect(group!.blobs.length).toBe(2);
    expect(group!.blobs[0]!.name).toBe('parent');
    expect(group!.blobs.some((b) => b.name.startsWith('children/'))).toBe(true);
  });

  it('the reachability engine RUNS on the real tree → the child is an observed delegate', () => {
    const { parentPath } = layoutRealCodexTree();
    const group = discoverByPath(parentPath)!;
    const session = parseSession(group.blobs, 'codex');
    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe(PARENT_ID);
    const lineage = extractLineage(session!, group.blobs);
    // Non-empty lineage: the child rollout is reachable via parent_thread_id and surfaces as a delegate.
    expect(lineage.observedDelegates).toContainEqual({ kind: 'subagent', subagentId: CHILD_ID });
  });

  it('an unrelated same-day rollout is NOT pulled in as a child (reachability filters it)', () => {
    const { parentPath } = layoutRealCodexTree();
    // Add a same-day session with NO parent link — a candidate discovery gathers but reachability drops.
    const dateDir = path.dirname(parentPath);
    fs.writeFileSync(
      path.join(dateDir, 'rollout-2026-06-13T09-00-00-019e8006-stranger.jsonl'),
      jsonl([{ type: 'session_meta', payload: { id: '019e8006-stranger', cwd: '/r', cli_version: '0.139.0' } }]),
    );
    const group = discoverByPath(parentPath)!;
    expect(group.blobs.length).toBe(3); // discovery over-supplies candidates...
    const session = parseSession(group.blobs, 'codex')!;
    const lineage = extractLineage(session, group.blobs);
    // ...but only the true descendant is a delegate; the stranger is filtered by reachability.
    expect(lineage.observedDelegates).toContainEqual({ kind: 'subagent', subagentId: CHILD_ID });
    expect(lineage.observedDelegates).not.toContainEqual({ kind: 'subagent', subagentId: '019e8006-stranger' });
  });
});

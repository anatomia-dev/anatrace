import { describe, expect, it } from 'vitest';
import { parseSession } from '../src/parse.js';
import { extractLineage, type HarnessLineageHook } from '../src/lineage.js';
import type { NamedBlob } from '../src/adapter.js';
import { loadCorpus, type CorpusSession } from './_corpus.js';

const enc = (value: string): Uint8Array => new TextEncoder().encode(value);
const jsonl = (values: unknown[]): string => values.map((value) => JSON.stringify(value)).join('\n');
const corpus = loadCorpus();

function byName(name: string): CorpusSession {
  const session = corpus.find((entry) => entry.name === name);
  if (!session) throw new Error(`fixture not found: ${name}`);
  return session;
}

function freshBlobs(session: CorpusSession): NamedBlob[] {
  return session.blobs.map((blob) => ({ name: blob.name, bytes: new Uint8Array(blob.bytes) }));
}

function claudeParentWithFanout(): NamedBlob {
  return {
    name: 'parent',
    bytes: enc(jsonl([
      {
        type: 'assistant',
        sessionId: 'sess-lineage',
        uuid: 'u1',
        timestamp: '2026-06-08T00:00:01.000Z',
        message: {
          id: 'm1',
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_delegate',
              name: 'Agent',
              input: { subagent_type: 'explorer', description: 'Explore' },
            },
          ],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    ])),
  };
}

function claudeParentWithTwoFanouts(): NamedBlob {
  return {
    name: 'parent',
    bytes: enc(jsonl([
      {
        type: 'assistant',
        sessionId: 'sess-lineage',
        uuid: 'u1',
        timestamp: '2026-06-08T00:00:01.000Z',
        message: {
          id: 'm1',
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_delegate_a',
              name: 'Agent',
              input: { subagent_type: 'explorer', description: 'Explore A' },
            },
            {
              type: 'tool_use',
              id: 'toolu_delegate_b',
              name: 'Agent',
              input: { subagent_type: 'explorer', description: 'Explore B' },
            },
          ],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    ])),
  };
}

function claudeChild(id: string, declaredId = id): NamedBlob {
  return {
    name: `subagents/agent-${id}.jsonl`,
    bytes: enc(jsonl([
      {
        type: 'assistant',
        isSidechain: true,
        sessionId: 'sess-lineage',
        uuid: `u-${id}`,
        agentId: declaredId,
        timestamp: '2026-06-08T00:00:02.000Z',
        message: {
          id: `m-${id}`,
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [{ type: 'text', text: 'done' }],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    ])),
  };
}

function claudeMeta(id: string, toolUseId?: string): NamedBlob {
  return {
    name: `subagents/agent-${id}.meta.json`,
    bytes: enc(JSON.stringify({
      agentType: 'explorer',
      description: 'Explore',
      ...(toolUseId ? { toolUseId } : {}),
    })),
  };
}

function codexParentWithAgentTool(): NamedBlob {
  return {
    name: 'parent',
    bytes: enc(jsonl([
      {
        type: 'session_meta',
        payload: { id: 'codex-agent-tool', cli_version: '1.0.0' },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'Agent',
          call_id: 'call-agent',
          arguments: JSON.stringify({ task: 'explore' }),
        },
      },
    ])),
  };
}

describe('Phase 2 lineage extraction', () => {
  it('reports a complete Claude sidecar lineage with fanout call linkage', () => {
    const fixture = byName('claude-fanout');
    const blobs = freshBlobs(fixture);
    const session = parseSession(blobs, fixture.harness);
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage).toMatchObject({
      schemaVersion: 1,
      harness: 'claude',
      sessionId: 'sess-claude-fanout',
      completeness: 'observed-complete-by-harness',
    });
    expect(lineage.observedDelegates).toEqual([{ kind: 'subagent', subagentId: 'fan1' }]);
    expect(lineage.checkedLanes).toEqual([
      { kind: 'root' },
      { kind: 'subagent', subagentId: 'fan1' },
    ]);
    expect(lineage.fanoutCalls).toEqual([
      expect.objectContaining({
        toolName: 'Agent',
        toolUseId: 'toolu_disp',
        agentType: 'explorer',
        description: 'Explore the data layer',
      }),
    ]);
    expect(lineage.gaps).toEqual([]);
  });

  it('records a parent delegation call with no child transcript as a closed gap', () => {
    const blobs = [claudeParentWithFanout()];
    const session = parseSession(blobs, 'claude');
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.completeness).toBe('observed-partial');
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'delegate-call-without-child-transcript',
        toolUseId: 'toolu_delegate',
      }),
    ]);
    expect(lineage.gaps[0]).not.toHaveProperty('agent');
  });

  it('reports an unmatched Claude fanout call when only one of two children is captured', () => {
    const blobs = [
      claudeParentWithTwoFanouts(),
      claudeChild('fan1'),
      claudeMeta('fan1', 'toolu_delegate_a'),
    ];
    const session = parseSession(blobs, 'claude');
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.completeness).toBe('observed-partial');
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'delegate-call-without-child-transcript',
        toolUseId: 'toolu_delegate_b',
      }),
    ]);
  });

  it('reports a Claude sidecar dispatch link that points at no parent fanout call', () => {
    const blobs = [
      claudeParentWithFanout(),
      claudeChild('fan1'),
      claudeMeta('fan1', 'toolu_other'),
    ];
    const session = parseSession(blobs, 'claude');
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.completeness).toBe('observed-partial');
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'dispatch-link-mismatch',
        agent: { kind: 'subagent', subagentId: 'fan1' },
        toolUseId: 'toolu_other',
      }),
    ]);
  });

  it('keeps child lanes visible when metadata is missing', () => {
    const blobs = [claudeParentWithFanout(), claudeChild('fan1')];
    const session = parseSession(blobs, 'claude');
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.observedDelegates).toEqual([{ kind: 'subagent', subagentId: 'fan1' }]);
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'child-transcript-without-metadata',
        agent: { kind: 'subagent', subagentId: 'fan1' },
      }),
    ]);
  });

  it('reports metadata without a child transcript', () => {
    const blobs = [claudeParentWithFanout(), claudeMeta('fan1', 'toolu_delegate')];
    const session = parseSession(blobs, 'claude');
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.observedDelegates).toEqual([{ kind: 'subagent', subagentId: 'fan1' }]);
    expect(lineage.gaps.map((gap) => gap.reason)).toEqual([
      'delegate-call-without-child-transcript',
      'metadata-without-child-transcript',
    ]);
    expect(lineage.gaps[1]).toEqual(expect.objectContaining({
      reason: 'metadata-without-child-transcript',
      agent: { kind: 'subagent', subagentId: 'fan1' },
    }));
  });

  it('reports inconsistent child transcript ids without dropping the lane', () => {
    const blobs = [claudeParentWithFanout(), claudeChild('fan1', 'other'), claudeMeta('fan1', 'toolu_delegate')];
    const session = parseSession(blobs, 'claude');
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.observedDelegates).toEqual([{ kind: 'subagent', subagentId: 'fan1' }]);
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'child-transcript-metadata-mismatch',
        agent: { kind: 'subagent', subagentId: 'fan1' },
      }),
    ]);
  });

  it('reports a child transcript blob that parsed no checked lane', () => {
    const blobs = [
      claudeParentWithFanout(),
      { name: 'subagents/agent-fan1.jsonl', bytes: enc('{not json') },
      claudeMeta('fan1', 'toolu_delegate'),
    ];
    const session = parseSession(blobs, 'claude');
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.checkedLanes).toEqual([{ kind: 'root' }]);
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'delegate-transcript-unreadable',
        agent: { kind: 'subagent', subagentId: 'fan1' },
      }),
    ]);
  });

  it('uses Codex hooks as lineage evidence without claiming transcript coverage', () => {
    const fixture = byName('codex-plain');
    const blobs = freshBlobs(fixture);
    const session = parseSession(blobs, fixture.harness);
    expect(session).not.toBeNull();
    const hooks: HarnessLineageHook[] = [
      {
        harness: 'codex',
        event: 'SubagentStart',
        parentSessionId: session!.sessionId,
        agentId: 'agent-c1',
        agentType: 'Explore',
        turnId: 'turn-1',
      },
      {
        harness: 'codex',
        event: 'SubagentStop',
        parentSessionId: session!.sessionId,
        agentId: 'agent-c1',
        agentType: 'Explore',
        turnId: 'turn-1',
      },
    ];
    const lineage = extractLineage(session!, blobs, hooks);
    expect(lineage.observedDelegates).toEqual([{ kind: 'subagent', subagentId: 'agent-c1' }]);
    expect(lineage.checkedLanes).toEqual([{ kind: 'root' }]);
    expect(lineage.completeness).toBe('observed-partial');
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'codex-subagent-storage-unknown',
        agent: { kind: 'subagent', subagentId: 'agent-c1' },
      }),
    ]);
  });

  it('ignores hook records from a different parent session', () => {
    const fixture = byName('codex-plain');
    const blobs = freshBlobs(fixture);
    const session = parseSession(blobs, fixture.harness);
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs, [
      {
        harness: 'codex',
        event: 'SubagentStop',
        parentSessionId: 'other-session',
        agentId: 'agent-c1',
        agentType: 'Explore',
      },
    ]);
    expect(lineage.observedDelegates).toEqual([]);
    expect(lineage.gaps).toEqual([]);
    expect(lineage.completeness).toBe('root-only');
  });

  it('treats a Codex child transcript path as unscanned until child bytes are parsed', () => {
    const fixture = byName('codex-plain');
    const blobs = freshBlobs(fixture);
    const session = parseSession(blobs, fixture.harness);
    expect(session).not.toBeNull();
    const hooks: HarnessLineageHook[] = [
      {
        harness: 'codex',
        event: 'SubagentStop',
        parentSessionId: session!.sessionId,
        agentId: 'agent-c1',
        agentType: 'Explore',
        agentTranscriptPath: '/tmp/child-rollout.jsonl',
      },
    ];
    const lineage = extractLineage(session!, blobs, hooks);
    expect(lineage.checkedLanes).toEqual([{ kind: 'root' }]);
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'delegate-transcript-unreadable',
        agent: { kind: 'subagent', subagentId: 'agent-c1' },
      }),
    ]);
  });

  it('uses Codex session storage parent and child facts as observed lineage evidence', () => {
    const fixture = byName('codex-subagent-storage');
    const blobs = freshBlobs(fixture);
    const session = parseSession(blobs, fixture.harness);
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.observedDelegates).toEqual([
      { kind: 'subagent', subagentId: 'codex-child-storage' },
    ]);
    expect(lineage.checkedLanes).toEqual([{ kind: 'root' }]);
    expect(lineage.completeness).toBe('observed-partial');
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'delegate-transcript-unreadable',
        agent: { kind: 'subagent', subagentId: 'codex-child-storage' },
        blobName: 'subagents/agent-codex-child-storage.jsonl',
      }),
    ]);
  });

  it('reports parent-only Codex storage evidence as a missing child transcript', () => {
    const fixture = byName('codex-subagent-storage');
    const blobs = [freshBlobs(fixture)[0]!];
    const session = parseSession(blobs, fixture.harness);
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.observedDelegates).toEqual([
      { kind: 'subagent', subagentId: 'codex-child-storage' },
    ]);
    expect(lineage.gaps).toEqual([
      expect.objectContaining({
        reason: 'delegate-call-without-child-transcript',
        agent: { kind: 'subagent', subagentId: 'codex-child-storage' },
        blobName: 'parent',
      }),
    ]);
  });

  it('does not match Codex child storage facts when the parent session id is missing', () => {
    const blobs: NamedBlob[] = [
      {
        name: 'parent',
        bytes: enc(jsonl([{ type: 'session_meta', payload: { cli_version: '0.139.0' } }])),
      },
      {
        name: 'subagents/agent-unrelated.jsonl',
        bytes: enc(jsonl([{ type: 'session_meta', payload: { id: 'unrelated' } }])),
      },
    ];
    const session = parseSession(blobs, 'codex');
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.observedDelegates).toEqual([]);
    expect(lineage.gaps).toEqual([]);
  });

  it('chooses Codex duplicate storage blob names deterministically', () => {
    const parent = freshBlobs(byName('codex-subagent-storage'))[0]!;
    const duplicateA: NamedBlob = {
      name: 'subagents/agent-codex-child-storage-a.jsonl',
      bytes: enc(jsonl([
        {
          type: 'session_meta',
          payload: {
            id: 'codex-child-storage',
            parent_thread_id: 'codex-parent-storage',
          },
        },
      ])),
    };
    const duplicateB: NamedBlob = {
      name: 'subagents/agent-codex-child-storage-b.jsonl',
      bytes: duplicateA.bytes,
    };
    const sessionA = parseSession([parent, duplicateA, duplicateB], 'codex');
    const sessionB = parseSession([parent, duplicateB, duplicateA], 'codex');
    expect(sessionA).not.toBeNull();
    expect(sessionB).not.toBeNull();
    expect(JSON.stringify(extractLineage(sessionA!, [parent, duplicateA, duplicateB]))).toBe(
      JSON.stringify(extractLineage(sessionB!, [duplicateB, parent, duplicateA])),
    );
    expect(extractLineage(sessionA!, [parent, duplicateA, duplicateB]).gaps).toEqual([
      expect.objectContaining({ blobName: 'subagents/agent-codex-child-storage-a.jsonl' }),
    ]);
  });

  it('does not attribute nested Codex child spawns to the root session', () => {
    const fixture = byName('codex-subagent-storage');
    const blobs = [
      freshBlobs(fixture)[0]!,
      {
        name: 'subagents/agent-codex-child-storage.jsonl',
        bytes: enc(jsonl([
          {
            type: 'session_meta',
            payload: {
              id: 'codex-child-storage',
              parent_thread_id: 'codex-parent-storage',
            },
          },
          {
            type: 'response_item',
            payload: {
              type: 'function_call',
              name: 'spawn_agent',
              call_id: 'call_nested',
            },
          },
          {
            type: 'response_item',
            payload: {
              type: 'function_call_output',
              call_id: 'call_nested',
              output: JSON.stringify({ agent_id: 'codex-grandchild-storage' }),
            },
          },
        ])),
      },
    ];
    const session = parseSession(blobs, fixture.harness);
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs);
    expect(lineage.observedDelegates).toEqual([
      { kind: 'subagent', subagentId: 'codex-child-storage' },
    ]);
  });

  it('does not let a Codex AgentToolUse hook clear missing delegate lineage', () => {
    const blobs = [codexParentWithAgentTool()];
    const session = parseSession(blobs, 'codex');
    expect(session).not.toBeNull();
    const lineage = extractLineage(session!, blobs, [
      {
        harness: 'codex',
        event: 'AgentToolUse',
        parentSessionId: 'codex-agent-tool',
        toolUseId: 'call-agent',
        agentType: 'Explore',
      },
    ]);
    expect(lineage.observedDelegates).toEqual([]);
    expect(lineage.gaps).toEqual([
      expect.objectContaining({ reason: 'harness-lineage-unsupported' }),
    ]);
  });

  it('deduplicates duplicate hook records in the public lineage receipt', () => {
    const fixture = byName('codex-plain');
    const blobs = freshBlobs(fixture);
    const session = parseSession(blobs, fixture.harness);
    expect(session).not.toBeNull();
    const hook: HarnessLineageHook = {
      harness: 'codex',
      event: 'SubagentStop',
      parentSessionId: session!.sessionId,
      agentId: 'agent-c1',
      agentType: 'Explore',
    };
    const lineage = extractLineage(session!, blobs, [hook, hook]);
    expect(lineage.hooks).toEqual([hook]);
  });

  it('is deterministic for shuffled input blobs and hook order', () => {
    const sorted = [claudeParentWithFanout(), claudeChild('fan1'), claudeMeta('fan1', 'toolu_delegate')];
    const shuffled = [sorted[2]!, sorted[0]!, sorted[1]!];
    const sessionA = parseSession(sorted, 'claude');
    const sessionB = parseSession(shuffled, 'claude');
    expect(sessionA).not.toBeNull();
    expect(sessionB).not.toBeNull();
    const hooksA: HarnessLineageHook[] = [
      { harness: 'claude', event: 'SubagentStart', parentSessionId: 'sess-lineage', agentId: 'fan1', agentType: 'explorer', capturedAt: '2' },
      { harness: 'claude', event: 'SubagentStop', parentSessionId: 'sess-lineage', agentId: 'fan1', agentType: 'explorer', capturedAt: '3' },
    ];
    const hooksB = [hooksA[1]!, hooksA[0]!];
    expect(JSON.stringify(extractLineage(sessionA!, sorted, hooksA))).toBe(
      JSON.stringify(extractLineage(sessionB!, shuffled, hooksB)),
    );
  });
});

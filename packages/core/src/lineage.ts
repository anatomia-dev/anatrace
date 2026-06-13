import type { NamedBlob } from './adapter.js';
import { parseJsonObject, readJsonlLines } from './adapter.js';
import type { AgentRef, Harness, NormalizedSession, SessionEvent } from './session.js';

export type LineageGapReason =
  | 'delegate-call-without-child-transcript'
  | 'child-transcript-without-metadata'
  | 'metadata-without-child-transcript'
  | 'child-transcript-metadata-mismatch'
  | 'dispatch-link-missing'
  | 'dispatch-link-mismatch'
  | 'unknown-delegation-channel'
  | 'harness-lineage-unsupported'
  | 'codex-subagent-storage-unknown'
  | 'delegate-transcript-unreadable'
  | 'launch-record-expected-but-unobserved'
  | 'observed-unexpected-delegate'
  | 'schema-unknown'
  | 'negative-proof-not-available';

export type HarnessLineageHook =
  | {
      harness: Harness;
      event: 'SubagentStart';
      parentSessionId: string;
      parentTranscriptPath?: string;
      agentId: string;
      agentType: string;
      turnId?: string;
      capturedAt?: string;
    }
  | {
      harness: Harness;
      event: 'SubagentStop';
      parentSessionId: string;
      parentTranscriptPath?: string;
      agentId: string;
      agentType: string;
      agentTranscriptPath?: string;
      lastAssistantMessagePresent?: boolean;
      turnId?: string;
      capturedAt?: string;
    }
  | {
      harness: Harness;
      event: 'AgentToolUse';
      parentSessionId: string;
      toolUseId: string;
      agentType?: string;
      turnId?: string;
      capturedAt?: string;
    };

export type LineageCompleteness =
  | 'root-only'
  | 'observed-partial'
  | 'observed-complete-by-harness'
  | 'coverage-complete';

export interface LineagePointer {
  blobName: string;
  lineIndex: number;
  agent: AgentRef;
}

export interface LineageFanoutCall {
  toolName: 'Agent';
  pointer: LineagePointer;
  toolUseId?: string;
  agentType?: string;
  description?: string;
}

export interface LineageGap {
  reason: LineageGapReason;
  agent?: AgentRef;
  blobName?: string;
  hookEvent?: HarnessLineageHook['event'];
  toolUseId?: string;
}

export interface LineageExtraction {
  schemaVersion: 1;
  harness: Harness;
  sessionId: string;
  completeness: LineageCompleteness;
  lanes: AgentRef[];
  checkedLanes: AgentRef[];
  observedDelegates: AgentRef[];
  fanoutCalls: LineageFanoutCall[];
  hooks: HarnessLineageHook[];
  gaps: LineageGap[];
}

function agentKey(agent: AgentRef): string {
  return agent.kind === 'root' ? 'root' : `subagent:${agent.subagentId}`;
}

function uniqueAgents(agents: AgentRef[]): AgentRef[] {
  const seen = new Set<string>();
  const out: AgentRef[] = [];
  for (const agent of agents) {
    const key = agentKey(agent);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(agent);
  }
  return out.sort((a, b) => agentKey(a).localeCompare(agentKey(b)));
}

function lanesOf(session: NormalizedSession): AgentRef[] {
  return uniqueAgents(session.events.map((event) => event.agent));
}

function subagentIdFromBlobName(name: string): { id: string; kind: 'transcript' | 'metadata' } | null {
  const transcript = name.match(/(?:^|\/)subagents\/agent-([^/.]+)\.jsonl$/);
  if (transcript?.[1]) return { id: transcript[1], kind: 'transcript' };
  const metadata = name.match(/(?:^|\/)subagents\/agent-([^/.]+)\.meta\.json$/);
  if (metadata?.[1]) return { id: metadata[1], kind: 'metadata' };
  return null;
}

function stringField(value: Record<string, unknown> | undefined, key: string): string {
  const raw = value?.[key];
  return typeof raw === 'string' ? raw : '';
}

function fanoutCallsOf(session: NormalizedSession): LineageFanoutCall[] {
  const out: LineageFanoutCall[] = [];
  for (const event of session.events) {
    if (event.type !== 'tool' || event.name !== 'Agent') continue;
    const input = typeof event.input === 'object' && event.input !== null && !Array.isArray(event.input)
      ? (event.input as Record<string, unknown>)
      : undefined;
    const agentType = stringField(input, 'subagent_type') || stringField(input, 'agent_type');
    const description = stringField(input, 'description');
    out.push({
      toolName: 'Agent',
      pointer: { blobName: event.blobName, lineIndex: event.lineIndex, agent: event.agent },
      ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
      ...(agentType ? { agentType } : {}),
      ...(description ? { description } : {}),
    });
  }
  return out;
}

function hookSortKey(hook: HarnessLineageHook): string {
  return [
    hook.harness,
    hook.event,
    hook.parentSessionId,
    'agentId' in hook ? hook.agentId : '',
    'toolUseId' in hook ? hook.toolUseId : '',
    hook.turnId ?? '',
    hook.capturedAt ?? '',
  ].join('\0');
}

function hookKey(hook: HarnessLineageHook): string {
  return JSON.stringify(hook);
}

function normalizedHooks(
  harness: Harness,
  sessionId: string,
  hooks: HarnessLineageHook[] = [],
): HarnessLineageHook[] {
  const seen = new Set<string>();
  const out: HarnessLineageHook[] = [];
  for (const hook of hooks
    .filter((hook) => hook.harness === harness && hook.parentSessionId === sessionId)
    .slice()
    .sort((a, b) => hookSortKey(a).localeCompare(hookSortKey(b)))) {
    const key = hookKey(hook);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hook);
  }
  return out;
}

function sidecarFacts(blobs: NamedBlob[]): {
  transcripts: Map<string, string>;
  metadata: Map<string, { blobName: string; toolUseId?: string; agentType?: string }>;
  transcriptDeclaredIds: Map<string, string>;
} {
  const transcripts = new Map<string, string>();
  const metadata = new Map<string, { blobName: string; toolUseId?: string; agentType?: string }>();
  const transcriptDeclaredIds = new Map<string, string>();
  for (const blob of blobs) {
    const parsed = subagentIdFromBlobName(blob.name);
    if (!parsed) continue;
    if (parsed.kind === 'transcript') {
      transcripts.set(parsed.id, blob.name);
      const firstAgentId = readJsonlLines(blob.bytes)
        .map((line) => stringField(line, 'agentId'))
        .find((agentId) => agentId.length > 0);
      if (firstAgentId) transcriptDeclaredIds.set(parsed.id, firstAgentId);
    } else {
      const meta = parseJsonObject(blob.bytes);
      const toolUseId = meta ? stringField(meta, 'toolUseId') : '';
      const agentType = meta ? stringField(meta, 'agentType') : '';
      metadata.set(parsed.id, {
        blobName: blob.name,
        ...(toolUseId ? { toolUseId } : {}),
        ...(agentType ? { agentType } : {}),
      });
    }
  }
  return { transcripts, metadata, transcriptDeclaredIds };
}

function jsonObjectText(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function codexThreadParentIds(payload: Record<string, unknown>): string[] {
  const parentIds = new Set<string>();
  const directParentId = stringField(payload, 'parent_thread_id');
  const rawSource = payload['source'];
  const source = typeof rawSource === 'object' && rawSource !== null && !Array.isArray(rawSource)
    ? (rawSource as Record<string, unknown>)
    : undefined;
  const rawSubagent = source?.['subagent'];
  const subagent = rawSubagent && typeof rawSubagent === 'object' && !Array.isArray(rawSubagent)
    ? (rawSubagent as Record<string, unknown>)
    : undefined;
  const rawThreadSpawn = subagent?.['thread_spawn'];
  const threadSpawn = rawThreadSpawn && typeof rawThreadSpawn === 'object' && !Array.isArray(rawThreadSpawn)
    ? (rawThreadSpawn as Record<string, unknown>)
    : undefined;
  const spawnParentId = stringField(threadSpawn, 'parent_thread_id');
  if (directParentId) parentIds.add(directParentId);
  if (spawnParentId) parentIds.add(spawnParentId);
  return [...parentIds].sort();
}

function isCodexSpawnToolCall(payload: Record<string, unknown>): boolean {
  return (
    (stringField(payload, 'type') === 'function_call' || stringField(payload, 'type') === 'custom_tool_call')
    && stringField(payload, 'name') === 'spawn_agent'
  );
}

function isCodexToolCallOutput(payload: Record<string, unknown>): boolean {
  return stringField(payload, 'type') === 'function_call_output'
    || stringField(payload, 'type') === 'custom_tool_call_output';
}

function codexStorageFacts(blobs: NamedBlob[], parentSessionId: string): {
  spawnedAgents: Map<string, string>;
  childTranscripts: Map<string, string>;
} {
  const spawnedAgents = new Map<string, string>();
  const childTranscripts = new Map<string, string>();
  if (!parentSessionId) return { spawnedAgents, childTranscripts };
  const facts = blobs.slice().sort((a, b) => a.name.localeCompare(b.name)).map((blob) => {
    const lines = readJsonlLines(blob.bytes);
    let blobSessionId = '';
    const parentIds = new Set<string>();
    const spawnCallIds = new Set<string>();
    for (const line of lines) {
      const type = stringField(line, 'type');
      const rawPayload = line['payload'];
      const payload = typeof rawPayload === 'object' && rawPayload !== null && !Array.isArray(rawPayload)
        ? (rawPayload as Record<string, unknown>)
        : undefined;
      if (!payload) continue;
      if (type === 'session_meta') {
        if (!blobSessionId) blobSessionId = stringField(payload, 'id');
        for (const parentId of codexThreadParentIds(payload)) parentIds.add(parentId);
      }
      if (type === 'response_item' && isCodexSpawnToolCall(payload)) {
        const callId = stringField(payload, 'call_id');
        if (callId) spawnCallIds.add(callId);
      }
    }
    const spawned: string[] = [];
    for (const line of lines) {
      const type = stringField(line, 'type');
      const rawPayload = line['payload'];
      const payload = typeof rawPayload === 'object' && rawPayload !== null && !Array.isArray(rawPayload)
        ? (rawPayload as Record<string, unknown>)
        : undefined;
      if (!payload) continue;
      if (
        type === 'response_item'
        && isCodexToolCallOutput(payload)
        && spawnCallIds.has(stringField(payload, 'call_id'))
      ) {
        const output = jsonObjectText(stringField(payload, 'output'));
        if (output) {
          const agentId = stringField(output, 'agent_id');
          if (agentId && !spawned.includes(agentId)) spawned.push(agentId);
        }
      }
    }
    return { blobName: blob.name, sessionId: blobSessionId, parentIds: [...parentIds].sort(), spawned };
  });

  const reachableSessionIds = new Set<string>([parentSessionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of facts) {
      if (fact.parentIds.some((parentId) => reachableSessionIds.has(parentId))) {
        if (fact.sessionId && !reachableSessionIds.has(fact.sessionId)) {
          reachableSessionIds.add(fact.sessionId);
          changed = true;
        }
        for (const agentId of fact.spawned) {
          if (!reachableSessionIds.has(agentId)) {
            reachableSessionIds.add(agentId);
            changed = true;
          }
        }
      }
      if (fact.sessionId && reachableSessionIds.has(fact.sessionId)) {
        for (const agentId of fact.spawned) {
          if (!reachableSessionIds.has(agentId)) {
            reachableSessionIds.add(agentId);
            changed = true;
          }
        }
      }
    }
  }
  for (const fact of facts) {
    if (fact.sessionId && fact.sessionId !== parentSessionId && fact.parentIds.some((parentId) => reachableSessionIds.has(parentId))) {
      if (!childTranscripts.has(fact.sessionId)) childTranscripts.set(fact.sessionId, fact.blobName);
    }
    if (!fact.sessionId || !reachableSessionIds.has(fact.sessionId)) continue;
    for (const agentId of fact.spawned) {
      if (!spawnedAgents.has(agentId)) spawnedAgents.set(agentId, fact.blobName);
    }
  }
  return { spawnedAgents, childTranscripts };
}

function hookAgents(hooks: HarnessLineageHook[]): AgentRef[] {
  return hooks
    .filter((hook): hook is Extract<HarnessLineageHook, { agentId: string }> => 'agentId' in hook)
    .map((hook) => ({ kind: 'subagent', subagentId: hook.agentId }));
}

function claudeGaps(
  fanoutCalls: LineageFanoutCall[],
  facts: ReturnType<typeof sidecarFacts>,
  hooks: HarnessLineageHook[],
  checkedLanes: AgentRef[],
): LineageGap[] {
  const gaps: LineageGap[] = [];
  const transcriptIds = new Set(facts.transcripts.keys());
  const metadataIds = new Set(facts.metadata.keys());
  const metadataToolUseIds = new Set(
    [...facts.metadata.values()]
      .map((meta) => meta.toolUseId)
      .filter((toolUseId): toolUseId is string => typeof toolUseId === 'string' && toolUseId.length > 0),
  );
  const fanoutToolUseIds = new Set(
    fanoutCalls
      .map((call) => call.toolUseId)
      .filter((toolUseId): toolUseId is string => typeof toolUseId === 'string' && toolUseId.length > 0),
  );
  const lifecycleHookDelegateIds = new Set(
    hooks
      .filter((hook) => hook.event === 'SubagentStart' || hook.event === 'SubagentStop')
      .map((hook) => hook.agentId),
  );
  const hookDelegateIds = new Set(
    hooks
      .filter((hook): hook is Extract<HarnessLineageHook, { agentId: string }> => 'agentId' in hook)
      .map((hook) => hook.agentId),
  );
  if (fanoutCalls.length > 0 && transcriptIds.size === 0) {
    for (const call of fanoutCalls) {
      gaps.push({
        reason: 'delegate-call-without-child-transcript',
        blobName: call.pointer.blobName,
        ...(call.toolUseId ? { toolUseId: call.toolUseId } : {}),
      });
    }
  }
  if (transcriptIds.size > 0 && fanoutCalls.length > transcriptIds.size) {
    const unmatched = fanoutCalls.filter(
      (call) => !call.toolUseId || !metadataToolUseIds.has(call.toolUseId),
    );
    for (const call of unmatched.slice(0, fanoutCalls.length - transcriptIds.size)) {
      gaps.push({
        reason: 'delegate-call-without-child-transcript',
        blobName: call.pointer.blobName,
        ...(call.toolUseId ? { toolUseId: call.toolUseId } : {}),
      });
    }
  }
  const checked = new Set(checkedLanes.map(agentKey));
  for (const id of transcriptIds) {
    const agent: AgentRef = { kind: 'subagent', subagentId: id };
    if (!checked.has(agentKey(agent))) {
      gaps.push({
        reason: 'delegate-transcript-unreadable',
        agent,
        ...(facts.transcripts.get(id) ? { blobName: facts.transcripts.get(id)! } : {}),
      });
    }
    if (!metadataIds.has(id)) {
      gaps.push({
        reason: 'child-transcript-without-metadata',
        agent,
        ...(facts.transcripts.get(id) ? { blobName: facts.transcripts.get(id)! } : {}),
      });
    }
    const declared = facts.transcriptDeclaredIds.get(id);
    if (declared && declared !== id) {
      gaps.push({
        reason: 'child-transcript-metadata-mismatch',
        agent,
        ...(facts.transcripts.get(id) ? { blobName: facts.transcripts.get(id)! } : {}),
      });
    }
  }
  for (const id of metadataIds) {
    const meta = facts.metadata.get(id);
    const agent: AgentRef = { kind: 'subagent', subagentId: id };
    if (!transcriptIds.has(id)) {
      gaps.push({
        reason: 'metadata-without-child-transcript',
        agent,
        ...(meta?.blobName ? { blobName: meta.blobName } : {}),
      });
    } else if (meta?.toolUseId && fanoutToolUseIds.size > 0 && !fanoutToolUseIds.has(meta.toolUseId)) {
      gaps.push({
        reason: 'dispatch-link-mismatch',
        agent,
        blobName: meta.blobName,
        toolUseId: meta.toolUseId,
      });
    } else if (fanoutCalls.length > 0 && !meta?.toolUseId && !lifecycleHookDelegateIds.has(id)) {
      gaps.push({
        reason: 'dispatch-link-missing',
        agent,
        ...(meta?.blobName ? { blobName: meta.blobName } : {}),
      });
    }
  }
  for (const id of hookDelegateIds) {
    if (transcriptIds.has(id)) continue;
    const stop = hooks.find((hook) => hook.event === 'SubagentStop' && hook.agentId === id);
    gaps.push({
      reason: stop?.event === 'SubagentStop' && stop.agentTranscriptPath
        ? 'delegate-transcript-unreadable'
        : 'delegate-call-without-child-transcript',
      agent: { kind: 'subagent', subagentId: id },
      ...(stop ? { hookEvent: stop.event } : {}),
    });
  }
  return gaps;
}

function codexGaps(
  fanoutCalls: LineageFanoutCall[],
  hooks: HarnessLineageHook[],
  storage: ReturnType<typeof codexStorageFacts>,
  observedDelegates: AgentRef[],
  checkedLanes: AgentRef[],
): LineageGap[] {
  const gaps: LineageGap[] = [];
  if (fanoutCalls.length > 0 && observedDelegates.length === 0) {
    gaps.push({ reason: 'harness-lineage-unsupported' });
  }
  const checked = new Set(checkedLanes.map(agentKey));
  for (const delegate of observedDelegates) {
    if (delegate.kind !== 'subagent') continue;
    if (checked.has(agentKey(delegate))) continue;
    const stop = hooks.find(
      (hook) => hook.event === 'SubagentStop' && hook.agentId === delegate.subagentId,
    );
    const transcriptBlob = storage.childTranscripts.get(delegate.subagentId);
    const spawnBlob = storage.spawnedAgents.get(delegate.subagentId);
    const blobName = transcriptBlob ?? spawnBlob;
    gaps.push({
      reason: transcriptBlob || (stop?.event === 'SubagentStop' && stop.agentTranscriptPath)
        ? 'delegate-transcript-unreadable'
        : spawnBlob
          ? 'delegate-call-without-child-transcript'
        : 'codex-subagent-storage-unknown',
      agent: delegate,
      ...(blobName ? { blobName } : {}),
      ...(stop ? { hookEvent: stop.event } : {}),
    });
  }
  return gaps;
}

function gapKey(gap: LineageGap): string {
  return [
    gap.reason,
    gap.agent ? agentKey(gap.agent) : '',
    gap.blobName ?? '',
    gap.hookEvent ?? '',
    gap.toolUseId ?? '',
  ].join('\0');
}

function normalizeGaps(gaps: LineageGap[]): LineageGap[] {
  const seen = new Set<string>();
  const out: LineageGap[] = [];
  for (const gap of gaps.slice().sort((a, b) => gapKey(a).localeCompare(gapKey(b)))) {
    const key = gapKey(gap);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(gap);
  }
  return out;
}

function completenessOf(
  harness: Harness,
  fanoutCalls: LineageFanoutCall[],
  observedDelegates: AgentRef[],
  gaps: LineageGap[],
): LineageCompleteness {
  if (observedDelegates.length === 0 && fanoutCalls.length === 0 && gaps.length === 0) return 'root-only';
  if (gaps.length > 0) return 'observed-partial';
  if (harness === 'claude' && observedDelegates.length > 0) return 'observed-complete-by-harness';
  return 'observed-partial';
}

/**
 * Project deterministic delegation lineage from parsed session data, original blob names,
 * and caller-supplied hook records. Pure: no filesystem, no clock, no process, no network.
 *
 * @param session - Parsed normalized session.
 * @param blobs - Original named blobs used to parse the session.
 * @param hooks - Optional hook records captured by the CLI or embedding application.
 * @returns Machine-readable delegation lineage and closed coverage gaps.
 */
export function extractLineage(
  session: NormalizedSession,
  blobs: NamedBlob[] = [],
  hooks: HarnessLineageHook[] = [],
): LineageExtraction {
  const relevantHooks = normalizedHooks(session.harness, session.sessionId, hooks);
  const fanoutCalls = fanoutCallsOf(session);
  const checkedLanes = lanesOf(session);
  let observedDelegates: AgentRef[] = checkedLanes.filter((agent) => agent.kind === 'subagent');
  let gaps: LineageGap[] = [];

  if (session.harness === 'claude') {
    const facts = sidecarFacts(blobs);
    const sidecarAgents = [...facts.transcripts.keys(), ...facts.metadata.keys()]
      .map((id) => ({ kind: 'subagent', subagentId: id }) as AgentRef);
    observedDelegates = uniqueAgents([...observedDelegates, ...sidecarAgents, ...hookAgents(relevantHooks)]);
    gaps = claudeGaps(fanoutCalls, facts, relevantHooks, checkedLanes);
  } else {
    const storage = codexStorageFacts(blobs, session.sessionId);
    const storageAgents = [...storage.spawnedAgents.keys(), ...storage.childTranscripts.keys()]
      .map((id) => ({ kind: 'subagent', subagentId: id }) as AgentRef);
    observedDelegates = uniqueAgents([...observedDelegates, ...storageAgents, ...hookAgents(relevantHooks)]);
    gaps = codexGaps(fanoutCalls, relevantHooks, storage, observedDelegates, checkedLanes);
  }
  gaps = normalizeGaps(gaps);

  const lanes = uniqueAgents([{ kind: 'root' }, ...observedDelegates]);
  return {
    schemaVersion: 1,
    harness: session.harness,
    sessionId: session.sessionId,
    completeness: completenessOf(session.harness, fanoutCalls, observedDelegates, gaps),
    lanes,
    checkedLanes,
    observedDelegates,
    fanoutCalls,
    hooks: relevantHooks,
    gaps,
  };
}

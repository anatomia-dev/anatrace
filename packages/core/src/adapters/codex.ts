import type { Adapter, NamedBlob, AdapterCapabilities } from '../adapter.js';
import { readJsonlLines } from '../adapter.js';
import type { NormalizedSession, SessionEvent, EditEvent, AgentRef } from '../session.js';
import { assembleSession, rStr, rNum, rObj, rArr, parseTs } from './shared.js';

/** FI-16: safe-parse a Codex `function_call.arguments` JSON STRING into an input object, else null. */
function parseArgsObject(s: string): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
import { isCodexSynthetic } from './human.js';
import { matchAnnouncedSkills } from '../skills.js';

const ROOT: AgentRef = { kind: 'root' };

/** Map a `patch_apply_end.changes` entry `type` to an EditEvent op. */
function changeOp(type: string): EditEvent['op'] {
  if (type === 'add') return 'create';
  if (type === 'delete') return 'delete';
  return 'modify'; // 'update' (and any unknown) → modify
}

function detectCodex(bytes: Uint8Array): boolean {
  const lines = readJsonlLines(bytes).slice(0, 8);
  for (const l of lines) {
    if (rStr(l, 'type') === 'session_meta') return true;
    const payload = rObj(l, 'payload');
    if (payload && rStr(payload, 'originator').startsWith('codex')) return true;
  }
  return false;
}

/** Flatten a Codex message payload's content array into text. */
function messageText(content: unknown[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (typeof b !== 'object' || b === null) continue;
    const block = b as Record<string, unknown>;
    const t = rStr(block, 'type');
    if (t === 'text' || t === 'output_text' || t === 'input_text') parts.push(rStr(block, 'text'));
  }
  return parts.join('\n');
}

function sourceThreadSpawnParentId(payload: Record<string, unknown>): string {
  const source = rObj(payload, 'source');
  const subagent = source ? rObj(source, 'subagent') : undefined;
  const threadSpawn = subagent ? rObj(subagent, 'thread_spawn') : undefined;
  return rStr(threadSpawn, 'parent_thread_id');
}

function childAgentForBlob(lines: Record<string, unknown>[], parentSessionId: string): AgentRef | null {
  if (!parentSessionId) return null;
  for (const line of lines) {
    if (rStr(line, 'type') !== 'session_meta') continue;
    const payload = rObj(line, 'payload');
    if (!payload) continue;
    const childId = rStr(payload, 'id');
    if (!childId) continue;
    const directParentId = rStr(payload, 'parent_thread_id');
    const spawnParentId = sourceThreadSpawnParentId(payload);
    if (directParentId === parentSessionId || spawnParentId === parentSessionId) {
      return { kind: 'subagent', subagentId: childId };
    }
  }
  return null;
}

function isSpawnToolCall(payload: Record<string, unknown>): boolean {
  return (
    (rStr(payload, 'type') === 'function_call' || rStr(payload, 'type') === 'custom_tool_call')
    && rStr(payload, 'name') === 'spawn_agent'
  );
}

function isToolCallOutput(payload: Record<string, unknown>): boolean {
  return rStr(payload, 'type') === 'function_call_output' || rStr(payload, 'type') === 'custom_tool_call_output';
}

function codexThreadInfo(lines: Record<string, unknown>[]): {
  sessionId: string;
  parentIds: string[];
  spawnedIds: string[];
} {
  let sessionId = '';
  const parentIds = new Set<string>();
  const spawnCallIds = new Set<string>();
  const spawnedIds = new Set<string>();
  for (const line of lines) {
    const type = rStr(line, 'type');
    const payload = rObj(line, 'payload');
    if (!payload) continue;
    if (type === 'session_meta') {
      if (!sessionId) sessionId = rStr(payload, 'id');
      const directParentId = rStr(payload, 'parent_thread_id');
      const spawnParentId = sourceThreadSpawnParentId(payload);
      if (directParentId) parentIds.add(directParentId);
      if (spawnParentId) parentIds.add(spawnParentId);
    }
    if (type === 'response_item' && isSpawnToolCall(payload)) {
      const callId = rStr(payload, 'call_id');
      if (callId) spawnCallIds.add(callId);
    }
  }
  for (const line of lines) {
    if (rStr(line, 'type') !== 'response_item') continue;
    const payload = rObj(line, 'payload');
    if (!payload || !isToolCallOutput(payload) || !spawnCallIds.has(rStr(payload, 'call_id'))) continue;
    const parsed = parseArgsObject(rStr(payload, 'output'));
    const agentId = parsed ? rStr(parsed, 'agent_id') : '';
    if (agentId) spawnedIds.add(agentId);
  }
  return { sessionId, parentIds: [...parentIds].sort(), spawnedIds: [...spawnedIds].sort() };
}

function parseCodex(group: NamedBlob[]): NormalizedSession | null {
  capabilities.tokenTotalSuspect = false;
  const parent = group[0];
  if (!parent) return null;
  const parentLines = readJsonlLines(parent.bytes);

  // Pre-scan: model (first turn_context), sessionId + cli_version (session_meta).
  let model = '';
  let sessionId = '';
  const observed: string[] = [];
  for (const line of parentLines) {
    const type = rStr(line, 'type');
    const payload = rObj(line, 'payload');
    if (!payload) continue;
    if (type === 'session_meta') {
      if (!sessionId) sessionId = rStr(payload, 'id');
      const ver = rStr(payload, 'cli_version');
      if (ver && !observed.includes(ver)) observed.push(ver);
    }
    if (type === 'turn_context' && !model) model = rStr(payload, 'model');
  }

  const events: SessionEvent[] = [];
  const parseBlob = (blob: NamedBlob, lines: Record<string, unknown>[], agent: AgentRef, includeUsage: boolean): void => {
    const toolNameByCallId = new Map<string, string>(); // FI-2: function_call call_id → tool name (forTool join)
    let prevCumulative: number | undefined;
    lines.forEach((line, lineIndex) => {
      const type = rStr(line, 'type');
      const payload = rObj(line, 'payload');
      if (!payload) return;
      const ts = parseTs(rStr(line, 'timestamp'));
      const meta = { agent, blobName: blob.name, lineIndex, ...(ts !== undefined ? { ts } : {}) };
      const ptype = rStr(payload, 'type');

      if (type === 'event_msg' && ptype === 'token_count') {
        if (!includeUsage) {
          capabilities.tokenTotalSuspect = true;
          return;
        }
        const info = rObj(payload, 'info');
        const total = info ? rObj(info, 'total_token_usage') : undefined;
        if (total) {
          const grossInput = rNum(total, 'input_tokens');
          const cached = rNum(total, 'cached_input_tokens');
          const nonCached = grossInput - cached > 0 ? grossInput - cached : 0; // cache-subtract (cached ≤ input)
          const output = rNum(total, 'output_tokens');
          const cumTotal = rNum(total, 'total_tokens') || grossInput + output;
          if (prevCumulative !== undefined && cumTotal < prevCumulative) {
            capabilities.tokenTotalSuspect = true;
          }
          prevCumulative = cumTotal;
          events.push({
            type: 'usage',
            usage: { input: nonCached, output, cache_create: 0, cache_read: cached },
            cumulative: true,
            ...meta,
          });
        }
        return;
      }

      if (type === 'event_msg' && ptype === 'patch_apply_end') {
        // FI-13 scope note (Claude-only): the void-by-error handling in content.ts joins an
        // Edit/Write's tool_use id to its is_error tool_result. Codex has no such link — the edit
        // IS the patch_apply_end event and carries no tool_use_id, and the only isError signal lives
        // on separate exec_command (function_call_output) results, not on patch edits. No clean void
        // path exists here, so no symmetric toolUseId is threaded onto Codex EditEvents.
        const changes = rObj(payload, 'changes');
        if (changes) {
          for (const pathKey of Object.keys(changes)) {
            const change = rObj(changes, pathKey);
            if (!change) continue;
            const movePath = rStr(change, 'move_path');
            if (movePath && rStr(change, 'type') === 'update') {
              events.push({ type: 'edit', op: 'rename', paths: [pathKey, movePath], ...meta });
            } else {
              const op = changeOp(rStr(change, 'type'));
              // B4 — Codex `add` carries the full new-file content; `update` carries a
              // unified_diff (not folded → resolver nulls it, honest). Populate create content.
              const fullContent = op === 'create' ? rStr(change, 'content') : '';
              events.push({
                type: 'edit',
                op,
                paths: [pathKey],
                ...(op === 'create' && fullContent ? { fullContent } : {}),
                ...meta,
              });
            }
          }
        }
        return;
      }

      if (type === 'event_msg' && ptype === 'compacted') {
        // S1 (M1/P1) — Codex's STRUCTURED compaction marker (the committed `codex-compacted`
        // fixture). Detect on the structured `payload.type:"compacted"` event ONLY (the
        // companion `session_meta.source==="compact"` is a session-level signal, not a per-line
        // event). Codex carries no preTokens/trigger here → both omitted (honest `unknown`,
        // never guessed). Symmetric with the Claude `compact_boundary` carrier.
        events.push({ type: 'compact', ...meta });
        return;
      }

      if (type === 'event_msg' && ptype === 'turn_aborted') {
        if (rStr(payload, 'reason') === 'interrupted') {
          events.push({ type: 'interrupt', reason: 'interrupted', ...meta });
        }
        return;
      }

      if (type === 'response_item') {
        if (ptype === 'message' && rStr(payload, 'role') === 'assistant') {
          const text = messageText(rArr(payload, 'content'));
          events.push({ type: 'message', role: 'assistant', ...(model ? { model } : {}), text, ...meta });
          // B2/OQ5 — Codex has no Skill primitive; derive low-confidence skill signals from
          // announce strings in assistant prose. Tagged 'announce-text' (never 'tool').
          for (const skill of matchAnnouncedSkills(text)) {
            events.push({ type: 'skill', skill, source: 'announce-text', ...meta });
          }
          return;
        }
        // B1 (symmetric) — emit genuine human prose; exclude Codex synthetic injections
        // (# AGENTS.md / <environment_context> / <user_instructions> / <turn_aborted>) by
        // STRUCTURAL marker only. `messageText` already decodes `input_text` blocks.
        if (ptype === 'message' && rStr(payload, 'role') === 'user') {
          const text = messageText(rArr(payload, 'content'));
          if (text.trim() && !isCodexSynthetic(text)) {
            events.push({ type: 'message', role: 'user', text, ...meta });
          }
          return;
        }
        if (ptype === 'function_call' || ptype === 'custom_tool_call') {
          const name = rStr(payload, 'name');
          const callId = rStr(payload, 'call_id');
          if (callId && name) toolNameByCallId.set(callId, name);
          // FI-16: Codex dropped the call `arguments` (a JSON string) — parse it into an
          // `input` object mirroring Claude's `ToolEvent.input` shape so `tool-names`/command
          // prudence isn't `codex-blind` purely from a dropped payload. Degrade to absent on
          // a non-object/unparseable argument (never throw).
          const args = parseArgsObject(rStr(payload, 'arguments'));
          events.push({
            type: 'tool',
            name,
            ...(args ? { input: args } : {}),
            ...(callId ? { toolUseId: callId } : {}),
            ...meta,
          });
          return;
        }
        if (ptype === 'function_call_output' || ptype === 'custom_tool_call_output') {
          const output = rObj(payload, 'output');
          const text = output ? rStr(output, 'content') : rStr(payload, 'output');
          // Codex carries no structured is_error; the exit signal lives in the output text
          // as `Process exited with code N`. Map isError ONLY on a present non-zero code —
          // no marker ⇒ no signal ⇒ honestly not an error (don't guess). Mirrors the
          // ToolResultEvent.isError shape the Claude adapter sets from tool_result.is_error.
          const m = text.match(/Process exited with code (\d+)/);
          const isError = m ? Number(m[1]) !== 0 : false;
          // FI-2: resolve `forTool` by joining call_id → the originating function_call name.
          const forTool = toolNameByCallId.get(rStr(payload, 'call_id'));
          events.push({
            type: 'toolResult',
            text,
            ...(isError ? { isError } : {}),
            ...(forTool ? { forTool } : {}),
            ...meta,
          });
          return;
        }
      }
    });
  };

  const parentInfo = codexThreadInfo(parentLines);
  parseBlob(parent, parentLines, ROOT, true);
  const childBlobs = group
    .slice(1)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((blob) => {
      const lines = readJsonlLines(blob.bytes);
      return { blob, lines, info: codexThreadInfo(lines) };
    });
  const reachableSessionIds = new Set<string>(sessionId ? [sessionId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    if (sessionId && reachableSessionIds.has(sessionId)) {
      for (const spawnedId of parentInfo.spawnedIds) {
        if (!reachableSessionIds.has(spawnedId)) {
          reachableSessionIds.add(spawnedId);
          changed = true;
        }
      }
    }
    for (const child of childBlobs) {
      if (child.info.parentIds.some((parentId) => reachableSessionIds.has(parentId))) {
        if (child.info.sessionId && !reachableSessionIds.has(child.info.sessionId)) {
          reachableSessionIds.add(child.info.sessionId);
          changed = true;
        }
        for (const spawnedId of child.info.spawnedIds) {
          if (!reachableSessionIds.has(spawnedId)) {
            reachableSessionIds.add(spawnedId);
            changed = true;
          }
        }
      }
      if (child.info.sessionId && reachableSessionIds.has(child.info.sessionId)) {
        for (const spawnedId of child.info.spawnedIds) {
          if (!reachableSessionIds.has(spawnedId)) {
            reachableSessionIds.add(spawnedId);
            changed = true;
          }
        }
      }
    }
  }
  const parsedChildSessionIds = new Set<string>();
  for (const child of childBlobs) {
    if (!child.info.sessionId || !reachableSessionIds.has(child.info.sessionId)) continue;
    if (parsedChildSessionIds.has(child.info.sessionId)) continue;
    parsedChildSessionIds.add(child.info.sessionId);
    for (const line of child.lines) {
      const payload = rObj(line, 'payload');
      const ver = payload && rStr(line, 'type') === 'session_meta' ? rStr(payload, 'cli_version') : '';
      if (ver && !observed.includes(ver)) observed.push(ver);
    }
    const childAgent = childAgentForBlob(child.lines, sessionId)
      ?? { kind: 'subagent' as const, subagentId: child.info.sessionId };
    parseBlob(child.blob, child.lines, childAgent, false);
  }

  return assembleSession('codex', sessionId, observed, [], events);
}

/** Per-parse mutable capabilities (reset at the top of every parse — no cross-session leak). */
const capabilities: AdapterCapabilities = { supportsCacheCreate: false, tokenTotalSuspect: false };

/** The Codex adapter (REQ Item 3): cache-subtract, exec_command, patch_apply_end off event_msg, rename. */
export const codexAdapter: Adapter = {
  harness: 'codex',
  detect: detectCodex,
  parse: parseCodex,
  capabilities,
};

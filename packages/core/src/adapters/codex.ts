import type { Adapter, NamedBlob, AdapterCapabilities } from '../adapter.js';
import { readJsonlLines } from '../adapter.js';
import type { NormalizedSession, SessionEvent, EditEvent, AgentRef } from '../session.js';
import { assembleSession, rStr, rNum, rObj, rArr, parseTs } from './shared.js';

const ROOT: AgentRef = { kind: 'root' }; // Codex has no subagent sidecars

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

function parseCodex(group: NamedBlob[]): NormalizedSession | null {
  capabilities.tokenTotalSuspect = false;
  const blob = group[0];
  if (!blob) return null;
  const lines = readJsonlLines(blob.bytes);
  const blobName = blob.name;

  // Pre-scan: model (first turn_context), sessionId + cli_version (session_meta).
  let model = '';
  let sessionId = '';
  const observed: string[] = [];
  for (const line of lines) {
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
  let prevCumulative: number | undefined;

  lines.forEach((line, lineIndex) => {
    const type = rStr(line, 'type');
    const payload = rObj(line, 'payload');
    if (!payload) return;
    const ts = parseTs(rStr(line, 'timestamp'));
    const meta = { agent: ROOT, blobName, lineIndex, ...(ts !== undefined ? { ts } : {}) };
    const ptype = rStr(payload, 'type');

    if (type === 'event_msg' && ptype === 'token_count') {
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
      const changes = rObj(payload, 'changes');
      if (changes) {
        for (const pathKey of Object.keys(changes)) {
          const change = rObj(changes, pathKey);
          if (!change) continue;
          const movePath = rStr(change, 'move_path');
          if (movePath && rStr(change, 'type') === 'update') {
            events.push({ type: 'edit', op: 'rename', paths: [pathKey, movePath], ...meta });
          } else {
            events.push({ type: 'edit', op: changeOp(rStr(change, 'type')), paths: [pathKey], ...meta });
          }
        }
      }
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
        events.push({
          type: 'message',
          role: 'assistant',
          ...(model ? { model } : {}),
          text: messageText(rArr(payload, 'content')),
          ...meta,
        });
        return;
      }
      if (ptype === 'function_call' || ptype === 'custom_tool_call') {
        events.push({ type: 'tool', name: rStr(payload, 'name'), ...meta });
        return;
      }
      if (ptype === 'function_call_output' || ptype === 'custom_tool_call_output') {
        const output = rObj(payload, 'output');
        const text = output ? rStr(output, 'content') : rStr(payload, 'output');
        events.push({ type: 'toolResult', text, ...meta });
        return;
      }
    }
  });

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

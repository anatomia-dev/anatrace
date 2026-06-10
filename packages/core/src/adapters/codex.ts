import type { Adapter, NamedBlob, AdapterCapabilities } from '../adapter.js';
import { readJsonlLines } from '../adapter.js';
import type { NormalizedSession, SessionEvent, EditEvent, AgentRef } from '../session.js';
import { assembleSession, rStr, rNum, rObj, rArr, parseTs } from './shared.js';
import { isCodexSynthetic } from './human.js';
import { matchAnnouncedSkills } from '../skills.js';

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
        events.push({ type: 'tool', name: rStr(payload, 'name'), ...meta });
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
        events.push({ type: 'toolResult', text, ...(isError ? { isError } : {}), ...meta });
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

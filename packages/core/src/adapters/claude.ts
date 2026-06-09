import type { Adapter, NamedBlob, AdapterCapabilities } from '../adapter.js';
import { readJsonlLines, parseJsonObject } from '../adapter.js';
import type { NormalizedSession, SessionEvent, AgentRef, SubagentMeta } from '../session.js';
import type { TokenCounts } from '../provenance.js';
import { assembleSession, rStr, rNum, rObj, rArr, parseTs } from './shared.js';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const FANOUT_TOOLS = new Set(['Agent', 'Task']); // Agent is current; Task is back/forward-compat alias

/** Parse "subagents/agent-<id>.jsonl" / ".meta.json" → the agentId suffix. `''` if not a subagent blob. */
function subagentIdFromName(name: string): string {
  const m = name.match(/(?:^|\/)agent-([^/.]+)\.(?:jsonl|meta\.json)$/);
  return m ? (m[1] ?? '') : '';
}

function tokenTotal(t: TokenCounts): number {
  return t.input + t.output + t.cache_create + t.cache_read;
}

/** Per-parse mutable capabilities (reset at the top of every parse — no cross-session leak). */
const capabilities: AdapterCapabilities = { supportsCacheCreate: true, tokenTotalSuspect: false };

function detectClaude(bytes: Uint8Array): boolean {
  // Bounded: inspect only the first handful of lines.
  const lines = readJsonlLines(bytes).slice(0, 8);
  for (const l of lines) {
    if (rStr(l, 'type') === 'session_meta') return false; // that's Codex
    if (rObj(l, 'payload')) return false; // Codex lines are payload-wrapped
  }
  for (const l of lines) {
    const t = rStr(l, 'type');
    if ((t === 'assistant' || t === 'user') && rObj(l, 'message')) return true;
    if (rStr(l, 'sessionId') && rStr(l, 'uuid')) return true;
  }
  return false;
}

/** Flatten an assistant content array's text blocks. */
function assistantText(content: unknown[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (typeof b !== 'object' || b === null) continue;
    const block = b as Record<string, unknown>;
    if (rStr(block, 'type') === 'text') parts.push(rStr(block, 'text'));
  }
  return parts.join('\n');
}

/** Flatten a tool_result `content` (string or block array) into text. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'object' && c !== null ? rStr(c as Record<string, unknown>, 'text') : ''))
      .join('\n');
  }
  return '';
}

function parseClaude(group: NamedBlob[]): NormalizedSession | null {
  capabilities.tokenTotalSuspect = false;
  const events: SessionEvent[] = [];
  const subagents: SubagentMeta[] = [];
  const observed: string[] = [];
  const seenVersions = new Set<string>();
  const lastTotalById = new Map<string, number>(); // monotonicity canary state
  let sessionId = '';

  for (const blob of group) {
    if (blob.name.endsWith('.meta.json')) {
      const meta = parseJsonObject(blob.bytes);
      const agentId = subagentIdFromName(blob.name);
      if (meta && agentId) {
        const dispatch = rStr(meta, 'toolUseId');
        subagents.push({
          agentId,
          agentType: rStr(meta, 'agentType'),
          description: rStr(meta, 'description'),
          ...(dispatch ? { dispatchToolUseId: dispatch } : {}),
        });
      }
      continue;
    }

    const subId = subagentIdFromName(blob.name);
    const agent: AgentRef = subId ? { kind: 'subagent', subagentId: subId } : { kind: 'root' };
    const lines = readJsonlLines(blob.bytes);

    lines.forEach((line, lineIndex) => {
      const type = rStr(line, 'type');
      const ts = parseTs(rStr(line, 'timestamp'));
      const meta = { agent, blobName: blob.name, lineIndex, ...(ts !== undefined ? { ts } : {}) };

      if (!sessionId) sessionId = rStr(line, 'sessionId');
      const ver = rStr(line, 'version');
      if (ver && !seenVersions.has(ver)) {
        seenVersions.add(ver);
        observed.push(ver);
      }

      const message = rObj(line, 'message');
      if (type === 'assistant' && message) {
        const model = rStr(message, 'model');
        const content = rArr(message, 'content');
        events.push({ type: 'message', role: 'assistant', ...(model ? { model } : {}), text: assistantText(content), ...meta });

        const usage = rObj(message, 'usage');
        if (usage) {
          const tk: TokenCounts = {
            input: rNum(usage, 'input_tokens'),
            output: rNum(usage, 'output_tokens'),
            cache_create: rNum(usage, 'cache_creation_input_tokens'),
            cache_read: rNum(usage, 'cache_read_input_tokens'),
          };
          const messageId = rStr(message, 'id');
          const isSidechain = line['isSidechain'] === true;
          if (messageId) {
            const tot = tokenTotal(tk);
            const prev = lastTotalById.get(messageId);
            if (prev !== undefined && tot < prev) capabilities.tokenTotalSuspect = true;
            lastTotalById.set(messageId, tot);
          }
          events.push({
            type: 'usage',
            usage: tk,
            ...(messageId ? { messageId } : {}),
            isSidechain,
            cumulative: false,
            ...meta,
          });
        }

        for (const b of content) {
          if (typeof b !== 'object' || b === null) continue;
          const block = b as Record<string, unknown>;
          if (rStr(block, 'type') !== 'tool_use') continue;
          const name = rStr(block, 'name');
          const input = rObj(block, 'input');
          if (name === 'Skill') {
            const skill = rStr(input, 'command') || rStr(input, 'skill') || rStr(input, 'name');
            events.push({ type: 'skill', skill, ...meta });
          } else if (EDIT_TOOLS.has(name)) {
            const fp = rStr(input, 'file_path');
            events.push({
              type: 'edit',
              op: name === 'Write' ? 'create' : 'modify',
              paths: fp ? [fp] : [],
              ...meta,
            });
          } else {
            const toolName = FANOUT_TOOLS.has(name) ? 'Agent' : name;
            events.push({ type: 'tool', name: toolName, ...(input ? { input } : {}), ...meta });
          }
        }
      }

      if (type === 'user' && message) {
        for (const b of rArr(message, 'content')) {
          if (typeof b !== 'object' || b === null) continue;
          const block = b as Record<string, unknown>;
          if (rStr(block, 'type') !== 'tool_result') continue;
          events.push({
            type: 'toolResult',
            text: toolResultText(block['content']),
            isError: block['is_error'] === true,
            ...meta,
          });
        }
      }
    });
  }

  return assembleSession('claude', sessionId, observed, subagents, events);
}

/** The Claude adapter (REQ Item 3): sidechain-first MAX dedup, subagent inclusion, canary, isError. */
export const claudeAdapter: Adapter = {
  harness: 'claude',
  detect: detectClaude,
  parse: parseClaude,
  capabilities,
};

import type { Adapter, NamedBlob, AdapterCapabilities } from '../adapter.js';
import { readJsonlLines, parseJsonObject } from '../adapter.js';
import type { NormalizedSession, SessionEvent, AgentRef, SubagentMeta } from '../session.js';
import type { TokenCounts } from '../provenance.js';
import { assembleSession, rStr, rNum, rObj, rArr, parseTs } from './shared.js';
import { classifyClaudeUser, claudeUserText } from './human.js';
import type { SkillOrigin } from '../session.js';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const FANOUT_TOOLS = new Set(['Agent', 'Task']); // Agent is current; Task is back/forward-compat alias

/** C6b: the isMeta line that carries a skill's base directory. */
const BASE_DIR_RE = /^\s*Base directory for this skill:\s*(\S.*?)\s*$/m;

/**
 * C6b: derive a {@link SkillOrigin} from a base-dir PATH (never the skill name). Stock skills
 * live under a superpowers/plugin cache; plugin skills under a plugins dir; project skills
 * under the repo's `.claude/skills`; everything else is personal (`~/.claude/skills`).
 */
function originFromBaseDir(baseDir: string): SkillOrigin {
  if (/\/plugins?\//.test(baseDir)) return 'plugin';
  if (/(^|\/)\.claude\/skills\//.test(baseDir) && !baseDir.includes('/.claude/skills/superpowers/'))
    return 'project';
  if (/\/superpowers\//.test(baseDir)) return 'stock';
  return 'personal';
}

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
  // A0: scan the whole (already-parsed) line set, not a bounded first-8 window. Claude
  // sessions front-load arbitrarily many metadata lines (agent-setting / last-prompt /
  // permission-mode / mode / queue-operation) before the first real message — a real
  // session (ebdf7d39) carries its first `user` line at index 49, so a first-8 window
  // silently dropped it on the `--last` path. Codex-exclusion stays exact: a Claude
  // transcript never carries a `session_meta` line or a top-level `payload` object
  // (verified 0/197398 lines across the corpus), so a whole-file exclusion scan cannot
  // false-exclude a real Claude session.
  const lines = readJsonlLines(bytes);
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
  const baseDirByToolUseId = new Map<string, string>(); // C6b: sourceToolUseID → base-dir
  const toolNameByToolUseId = new Map<string, string>(); // FI-2: tool_use BLOCK id → tool name (forTool join)
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
          // FI-2: record the originating tool name by its tool_use BLOCK id so the post-pass
          // can stamp `forTool` on the matching tool_result (gates parseTestCounts to runners).
          const blockId = rStr(block, 'id');
          if (blockId && name) toolNameByToolUseId.set(blockId, name);
          if (name === 'Skill') {
            const skill = rStr(input, 'command') || rStr(input, 'skill') || rStr(input, 'name');
            // C6b: carry the tool_use BLOCK id (NOT message.id) as the base-dir join key.
            const toolUseId = rStr(block, 'id');
            events.push({
              type: 'skill',
              skill,
              source: 'tool',
              ...(toolUseId ? { toolUseId } : {}),
              ...meta,
            }); // B2: structured invocation, high-confidence
          } else if (EDIT_TOOLS.has(name)) {
            const fp = rStr(input, 'file_path');
            // B4 — populate the EditEvent content carrier from the transcript: Write → full
            // content; Edit/MultiEdit → string-replace hunks (the transcript-content resolver
            // folds these). NotebookEdit carries no foldable content → resolver nulls it.
            const carrier: { fullContent?: string; hunks?: { before: string; after: string; replaceAll?: boolean }[] } = {};
            if (name === 'Write') {
              carrier.fullContent = rStr(input, 'content');
            } else if (name === 'Edit') {
              const before = rStr(input, 'old_string');
              if (before) carrier.hunks = [{ before, after: rStr(input, 'new_string'), replaceAll: input?.['replace_all'] === true }];
            } else if (name === 'MultiEdit') {
              const hunks: { before: string; after: string; replaceAll?: boolean }[] = [];
              for (const ed of rArr(input, 'edits')) {
                if (typeof ed !== 'object' || ed === null) continue;
                const eo = ed as Record<string, unknown>;
                const before = rStr(eo, 'old_string');
                if (before) hunks.push({ before, after: rStr(eo, 'new_string'), replaceAll: eo['replace_all'] === true });
              }
              if (hunks.length) carrier.hunks = hunks;
            }
            // FI-13: carry the tool_use BLOCK id (NOT message.id) so the resolver can void this
            // edit if its adjacent tool_result is is_error:true. Mirrors the C6b Skill id-threading.
            const editToolUseId = rStr(block, 'id');
            events.push({
              type: 'edit',
              op: name === 'Write' ? 'create' : 'modify',
              paths: fp ? [fp] : [],
              ...carrier,
              ...(editToolUseId ? { toolUseId: editToolUseId } : {}),
              ...meta,
            });
          } else {
            const toolName = FANOUT_TOOLS.has(name) ? 'Agent' : name;
            events.push({
              type: 'tool',
              name: toolName,
              ...(input ? { input } : {}),
              ...(blockId ? { toolUseId: blockId } : {}),
              ...meta,
            });
          }
        }
      }

      // S1 (M1/P1) — a STRUCTURED context-compaction boundary. Detect ONLY on the
      // `type:"system" && subtype:"compact_boundary"` marker (never a prose/substring scan):
      // the real corpus carries the string in 44 files but a structured record in only 6.
      // `compactMetadata:{trigger, preTokens}` rides the line; both are optional/defensive.
      // The carrier is lane-tagged via `meta` (root by nature — subagents don't compact the
      // parent — but tagged so a reader can still assert it). Net-new union member; additive.
      if (type === 'system' && rStr(line, 'subtype') === 'compact_boundary') {
        const cm = rObj(line, 'compactMetadata');
        const trigger = cm ? rStr(cm, 'trigger') : '';
        const preTokens = cm ? rNum(cm, 'preTokens') : 0;
        events.push({
          type: 'compact',
          ...(trigger ? { trigger } : {}),
          ...(preTokens ? { preTokens } : {}),
          ...meta,
        });
      }

      if (type === 'user' && message) {
        // C6b — the skill base-dir isMeta line: collect {sourceToolUseID → baseDir} for the
        // post-pass join; do NOT emit it as prose (it must never become a human MessageEvent).
        if (line['isMeta'] === true) {
          const srcId = rStr(line, 'sourceToolUseID');
          if (srcId) {
            const m = BASE_DIR_RE.exec(claudeUserText(message['content']));
            if (m && m[1]) baseDirByToolUseId.set(srcId, m[1]);
          }
        }
        for (const b of rArr(message, 'content')) {
          if (typeof b !== 'object' || b === null) continue;
          const block = b as Record<string, unknown>;
          if (rStr(block, 'type') !== 'tool_result') continue;
          // FI-13: capture the result's tool_use_id so the resolver can join an is_error result
          // back to the Edit/Write it voided (the FS never received that edit's bytes).
          const resultToolUseId = rStr(block, 'tool_use_id');
          events.push({
            type: 'toolResult',
            text: toolResultText(block['content']),
            isError: block['is_error'] === true,
            ...(resultToolUseId ? { toolUseId: resultToolUseId } : {}),
            ...meta,
          });
        }
        // B1 — human prose / structured interrupt. The discriminator excludes ALL
        // machine-authored user-role lines (sidechain/sidecar, isCompactSummary,
        // isVisibleInTranscriptOnly, isMeta, the slash-command/command-output/task wrappers);
        // the interrupt marker becomes a structured InterruptEvent (symmetric with Codex),
        // never prose. Genuine prose (string OR array text blocks) emits a human MessageEvent.
        // C6a: a slash-command line surfaces as a structured CommandEvent.
        const cls = classifyClaudeUser(line, message['content'], agent.kind === 'subagent');
        if (cls.kind === 'interrupt') {
          events.push({ type: 'interrupt', reason: 'interrupted', ...meta });
        } else if (cls.kind === 'command') {
          events.push({
            type: 'command',
            command: cls.command,
            ...(cls.args ? { args: cls.args } : {}),
            ...meta,
          });
        } else if (cls.kind === 'message') {
          events.push({ type: 'message', role: 'user', text: cls.text, ...meta });
        }
      }
    });
  }

  // C6b: join the base-dir isMeta lines to their Skill events by tool_use block id, then drop
  // the internal join key (it is not part of the public SkillEvent shape, never rendered).
  // FI-2: stamp `forTool` on each tool_result by joining its tool_use_id → the originating
  // tool name (the toolResult KEEPS its toolUseId — FI-13 still needs it to void edits).
  for (const e of events) {
    if (e.type === 'skill') {
      const id = e.toolUseId;
      if (id) {
        const baseDir = baseDirByToolUseId.get(id);
        if (baseDir) {
          e.baseDir = baseDir;
          e.origin = originFromBaseDir(baseDir);
        }
      }
      delete e.toolUseId;
    } else if (e.type === 'toolResult' && e.toolUseId) {
      const forTool = toolNameByToolUseId.get(e.toolUseId);
      if (forTool) e.forTool = forTool;
    }
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

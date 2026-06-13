import * as fs from 'node:fs';
import type { HarnessLineageHook } from 'anatrace-core';

export type LineageHookResult =
  | { ok: true; hooks: HarnessLineageHook[] }
  | { ok: false; message: string };

type ParseRecordResult = LineageHookResult | { ok: true; hooks: [] };

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(record, key);
  return value ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function harnessOf(record: Record<string, unknown>): 'claude' | 'codex' | null {
  const explicit = stringField(record, 'harness');
  if (explicit === 'claude' || explicit === 'codex') return explicit;
  if (explicit) return null;
  const model = stringField(record, 'model').toLowerCase();
  if (model.startsWith('claude')) return 'claude';
  if (model.includes('codex') || model.startsWith('gpt-')) return 'codex';
  return null;
}

function eventOf(record: Record<string, unknown>): string {
  return stringField(record, 'event') || stringField(record, 'hook_event_name');
}

function parseRecord(record: Record<string, unknown>, index: number): ParseRecordResult {
  const event = eventOf(record);
  if (
    event !== 'SubagentStart' &&
    event !== 'SubagentStop' &&
    event !== 'AgentToolUse'
  ) {
    return { ok: true, hooks: [] };
  }
  const harness = harnessOf(record);
  if (!harness) {
    return { ok: false, message: `anatrace: lineage hook ${index} has unknown harness.` };
  }
  const parentSessionId = stringField(record, 'parentSessionId') || stringField(record, 'session_id');
  if (!parentSessionId) {
    return { ok: false, message: `anatrace: lineage hook ${index} is missing session_id.` };
  }
  const parentTranscriptPath =
    optionalString(record, 'parentTranscriptPath') ?? optionalString(record, 'transcript_path');
  const turnId = optionalString(record, 'turnId') ?? optionalString(record, 'turn_id');
  const capturedAt = optionalString(record, 'capturedAt');
  const base = {
    harness,
    parentSessionId,
    ...(parentTranscriptPath ? { parentTranscriptPath } : {}),
    ...(turnId ? { turnId } : {}),
    ...(capturedAt ? { capturedAt } : {}),
  };
  if (event === 'SubagentStart') {
    const agentId = stringField(record, 'agentId') || stringField(record, 'agent_id');
    const agentType = stringField(record, 'agentType') || stringField(record, 'agent_type');
    if (!agentId || !agentType) {
      return { ok: false, message: `anatrace: SubagentStart hook ${index} is missing agent id/type.` };
    }
    return { ok: true, hooks: [{ ...base, event, agentId, agentType }] };
  }
  if (event === 'SubagentStop') {
    const agentId = stringField(record, 'agentId') || stringField(record, 'agent_id');
    const agentType = stringField(record, 'agentType') || stringField(record, 'agent_type');
    if (!agentId || !agentType) {
      return { ok: false, message: `anatrace: SubagentStop hook ${index} is missing agent id/type.` };
    }
    const agentTranscriptPath =
      optionalString(record, 'agentTranscriptPath') ?? optionalString(record, 'agent_transcript_path');
    const explicitLastAssistantMessagePresent = booleanField(record, 'lastAssistantMessagePresent');
    const lastAssistantMessage = record['last_assistant_message'];
    const inferredLastAssistantMessagePresent =
      lastAssistantMessage !== undefined
        ? typeof lastAssistantMessage === 'string' && lastAssistantMessage.length > 0
        : undefined;
    const lastAssistantMessagePresent =
      explicitLastAssistantMessagePresent ?? inferredLastAssistantMessagePresent;
    return {
      ok: true,
      hooks: [
        {
          ...base,
          event,
          agentId,
          agentType,
          ...(agentTranscriptPath ? { agentTranscriptPath } : {}),
          ...(lastAssistantMessagePresent !== undefined ? { lastAssistantMessagePresent } : {}),
        },
      ],
    };
  }
  if (event === 'AgentToolUse') {
    const toolUseId = stringField(record, 'toolUseId') || stringField(record, 'tool_use_id');
    if (!toolUseId) {
      return { ok: false, message: `anatrace: AgentToolUse hook ${index} is missing tool_use_id.` };
    }
    const agentType = optionalString(record, 'agentType') ?? optionalString(record, 'agent_type');
    return {
      ok: true,
      hooks: [
        {
          ...base,
          event,
          toolUseId,
          ...(agentType ? { agentType } : {}),
        },
      ],
    };
  }
  return { ok: false, message: `anatrace: unsupported lineage hook event ${event || '(missing)'}.` };
}

/**
 * Read hook JSONL captured by Claude Code or Codex hook commands.
 *
 * @param file - Path to a JSONL file, or a JSON array of hook objects.
 * @returns Parsed hook records or a user-facing error.
 */
export function resolveLineageHooks(file: string): LineageHookResult {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return {
      ok: false,
      message: `anatrace: cannot read lineage hooks ${file}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const records: unknown[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, hooks: [] };
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return { ok: false, message: 'anatrace: lineage hook JSON must be an array.' };
      records.push(...parsed);
    } catch (error) {
      return {
        ok: false,
        message: `anatrace: invalid lineage hook JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } else {
    for (const [index, line] of text.split('\n').entries()) {
      const value = line.trim();
      if (!value) continue;
      try {
        records.push(JSON.parse(value));
      } catch (error) {
        return {
          ok: false,
          message: `anatrace: invalid lineage hook JSONL at line ${index + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
  }

  const hooks: HarnessLineageHook[] = [];
  for (const [index, record] of records.entries()) {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      return { ok: false, message: `anatrace: lineage hook ${index} must be a JSON object.` };
    }
    const parsed = parseRecord(record as Record<string, unknown>, index);
    if (!parsed.ok) return parsed;
    hooks.push(...parsed.hooks);
  }
  return { ok: true, hooks };
}

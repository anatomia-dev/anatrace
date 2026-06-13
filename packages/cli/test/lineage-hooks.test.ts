import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveLineageHooks } from '../src/lineage-hooks.js';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function write(text: string): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anatrace-lineage-hooks-'));
  const file = path.join(dir, 'hooks.jsonl');
  fs.writeFileSync(file, text);
  return file;
}

describe('lineage hook loader', () => {
  it('accepts documented Codex SubagentStart and SubagentStop hook payloads', () => {
    const result = resolveLineageHooks(write([
      JSON.stringify({
        hook_event_name: 'SubagentStart',
        session_id: 'parent-session',
        transcript_path: '/tmp/parent.jsonl',
        model: 'gpt-5.2-codex',
        turn_id: 'turn-1',
        agent_id: 'agent-c1',
        agent_type: 'Explore',
      }),
      JSON.stringify({
        hook_event_name: 'SubagentStop',
        session_id: 'parent-session',
        transcript_path: '/tmp/parent.jsonl',
        model: 'gpt-5.2-codex',
        turn_id: 'turn-1',
        agent_id: 'agent-c1',
        agent_type: 'Explore',
        agent_transcript_path: '/tmp/child.jsonl',
        last_assistant_message: 'done',
      }),
    ].join('\n')));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hooks).toEqual([
      {
        harness: 'codex',
        event: 'SubagentStart',
        parentSessionId: 'parent-session',
        parentTranscriptPath: '/tmp/parent.jsonl',
        agentId: 'agent-c1',
        agentType: 'Explore',
        turnId: 'turn-1',
      },
      {
        harness: 'codex',
        event: 'SubagentStop',
        parentSessionId: 'parent-session',
        parentTranscriptPath: '/tmp/parent.jsonl',
        agentId: 'agent-c1',
        agentType: 'Explore',
        agentTranscriptPath: '/tmp/child.jsonl',
        lastAssistantMessagePresent: true,
        turnId: 'turn-1',
      },
    ]);
  });

  it('ignores unrelated hook events in shared capture files', () => {
    const result = resolveLineageHooks(write(JSON.stringify({
      hook_event_name: 'MysteryEvent',
      session_id: 's',
      harness: 'claude',
    })));
    expect(result).toEqual({
      ok: true,
      hooks: [],
    });
  });

  it('rejects invalid explicit harness values on lineage events', () => {
    const result = resolveLineageHooks(write(JSON.stringify({
      hook_event_name: 'SubagentStop',
      session_id: 's',
      harness: 'bogus',
      model: 'claude-sonnet-4-6',
      agent_id: 'agent-a',
      agent_type: 'Explore',
    })));
    expect(result).toEqual({
      ok: false,
      message: 'anatrace: lineage hook 0 has unknown harness.',
    });
  });

  it('does not infer Codex from arbitrary model strings', () => {
    const result = resolveLineageHooks(write(JSON.stringify({
      hook_event_name: 'SubagentStop',
      session_id: 's',
      model: 'custom-local-model',
      agent_id: 'agent-a',
      agent_type: 'Explore',
    })));
    expect(result).toEqual({
      ok: false,
      message: 'anatrace: lineage hook 0 has unknown harness.',
    });
  });
});

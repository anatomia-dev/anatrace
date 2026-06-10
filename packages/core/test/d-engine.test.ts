import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { readPathsOf } from '../src/read-paths.js';
import { skillsInvoked, skillsInvokedInScope } from '../src/skills.js';
import type { NormalizedSession, ToolResultEvent } from '../src/session.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

function assistantWith(content: unknown[], uuid: string, ts: string): unknown {
  return {
    type: 'assistant',
    sessionId: 's',
    uuid,
    timestamp: ts,
    message: {
      id: `m-${uuid}`,
      role: 'assistant',
      model: 'claude-opus-4-8',
      content,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

describe('D-ENGINE — readPathsOf (verify-independence binding; Spike B)', () => {
  it('pulls Read.input.file_path ONLY; NEVER Grep.pattern/path, Glob, or Bash.command', () => {
    const lines = jsonl([
      assistantWith(
        [
          { type: 'tool_use', name: 'Read', input: { file_path: '/repo/.ana/build_report.md' } },
          { type: 'tool_use', name: 'Grep', input: { pattern: 'build_report', path: '/repo/src' } },
          { type: 'tool_use', name: 'Glob', input: { pattern: '**/build_report.md' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'git diff main -- build_report.md' } },
        ],
        'a1',
        '2026-06-08T00:00:01.000Z',
      ),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    const rp = readPathsOf(s);
    expect(rp).toHaveLength(1);
    expect(rp[0].path).toBe('/repo/.ana/build_report.md');
    expect(rp[0].agent).toEqual({ kind: 'root' });
    // it POINTS — carries blobName + lineIndex (scrub-safe evidence)
    expect(rp[0].blobName).toBe('parent');
    expect(typeof rp[0].lineIndex).toBe('number');
  });

  it('a session with only Grep/Bash references to a path yields ZERO read-paths (the killed near-miss)', () => {
    const lines = jsonl([
      assistantWith(
        [
          { type: 'tool_use', name: 'Grep', input: { pattern: 'build_report', path: '/repo' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'grep -v build_report' } },
        ],
        'a1',
        '2026-06-08T00:00:01.000Z',
      ),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(readPathsOf(s)).toEqual([]);
  });

  it('Read with a non-string / missing file_path is skipped (degrade, never throw)', () => {
    const lines = jsonl([
      assistantWith(
        [
          { type: 'tool_use', name: 'Read', input: { file_path: 123 } },
          { type: 'tool_use', name: 'Read', input: {} },
          { type: 'tool_use', name: 'Read', input: { file_path: '/repo/real.ts' } },
        ],
        'a1',
        '2026-06-08T00:00:01.000Z',
      ),
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(readPathsOf(s).map((r) => r.path)).toEqual(['/repo/real.ts']);
  });
});

describe('D-ENGINE — skillsInvokedInScope (FI-15 lane-aware; concurrency-correct)', () => {
  function fanoutSession(): NormalizedSession {
    return {
      events: [
        { type: 'skill', skill: 'root-skill', source: 'tool', agent: { kind: 'root' }, blobName: 'p', lineIndex: 0 },
        { type: 'skill', skill: 'sub-skill', source: 'tool', agent: { kind: 'subagent', subagentId: 'a1' }, blobName: 'subagents/agent-a1', lineIndex: 0 },
      ],
    } as unknown as NormalizedSession;
  }

  it('flat skillsInvoked over-counts (root sees the subagent skill)', () => {
    expect(skillsInvoked(fanoutSession()).map((s) => s.skill).sort()).toEqual(['root-skill', 'sub-skill']);
  });

  it('lane-scoped to root sees ONLY the root skill', () => {
    expect(skillsInvokedInScope(fanoutSession(), { kind: 'root' })).toEqual([{ skill: 'root-skill', source: 'tool' }]);
  });

  it('lane-scoped to the subagent sees ONLY the subagent skill', () => {
    expect(skillsInvokedInScope(fanoutSession(), { kind: 'subagent', subagentId: 'a1' })).toEqual([
      { skill: 'sub-skill', source: 'tool' },
    ]);
  });

  it('omitted scope falls back to the flat projection', () => {
    expect(skillsInvokedInScope(fanoutSession())).toEqual(skillsInvoked(fanoutSession()));
  });
});

describe('D-ENGINE — Codex command input (FI-16) + forTool (FI-2 plumbing)', () => {
  it('Codex function_call now carries input parsed from arguments (no longer dropped)', () => {
    const lines = jsonl([
      { type: 'session_meta', timestamp: '2026-06-08T00:00:00.000Z', payload: { id: 'sc', originator: 'codex_cli', cli_version: '0.9' } },
      { type: 'turn_context', timestamp: '2026-06-08T00:00:01.000Z', payload: { model: 'gpt-5.5' } },
      { type: 'response_item', timestamp: '2026-06-08T00:00:02.000Z', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"command":"pytest -q"}' } },
      { type: 'response_item', timestamp: '2026-06-08T00:00:03.000Z', payload: { type: 'function_call_output', call_id: 'c1', output: { content: '7 passed' } } },
    ]);
    const s = codexAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    const tool = s.events.find((e) => e.type === 'tool');
    expect(tool).toBeDefined();
    expect((tool as { input?: unknown }).input).toEqual({ command: 'pytest -q' });
  });

  it('Codex toolResult carries forTool resolved by call_id → function_call name', () => {
    const lines = jsonl([
      { type: 'session_meta', timestamp: '2026-06-08T00:00:00.000Z', payload: { id: 'sc', originator: 'codex_cli', cli_version: '0.9' } },
      { type: 'turn_context', timestamp: '2026-06-08T00:00:01.000Z', payload: { model: 'gpt-5.5' } },
      { type: 'response_item', timestamp: '2026-06-08T00:00:02.000Z', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"command":"pytest -q"}' } },
      { type: 'response_item', timestamp: '2026-06-08T00:00:03.000Z', payload: { type: 'function_call_output', call_id: 'c1', output: { content: '7 passed' } } },
    ]);
    const s = codexAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    const result = s.events.find((e) => e.type === 'toolResult') as ToolResultEvent | undefined;
    expect(result?.forTool).toBe('exec_command');
  });

  it('Claude toolResult carries forTool resolved from the originating tool_use name', () => {
    const lines = jsonl([
      assistantWith(
        [{ type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'pnpm test' } }],
        'a1',
        '2026-06-08T00:00:01.000Z',
      ),
      {
        type: 'user',
        sessionId: 's',
        uuid: 'u1',
        timestamp: '2026-06-08T00:00:02.000Z',
        message: { role: 'user', content: [{ tool_use_id: 'tu-bash', type: 'tool_result', content: [{ type: 'text', text: '42 passed' }], is_error: false }] },
      },
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    const result = s.events.find((e) => e.type === 'toolResult') as ToolResultEvent | undefined;
    expect(result?.forTool).toBe('Bash');
    // FI-13 toolUseId is KEPT (the content resolver still needs it to void edits)
    expect(result?.toolUseId).toBe('tu-bash');
  });

  it('a Read tool_result echoing "N passed" is stamped forTool:"Read" (the phantom-test vector)', () => {
    const lines = jsonl([
      assistantWith(
        [{ type: 'tool_use', id: 'tu-read', name: 'Read', input: { file_path: '/repo/RESULT.md' } }],
        'a1',
        '2026-06-08T00:00:01.000Z',
      ),
      {
        type: 'user',
        sessionId: 's',
        uuid: 'u1',
        timestamp: '2026-06-08T00:00:02.000Z',
        message: { role: 'user', content: [{ tool_use_id: 'tu-read', type: 'tool_result', content: [{ type: 'text', text: '99 passed' }], is_error: false }] },
      },
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    const result = s.events.find((e) => e.type === 'toolResult') as ToolResultEvent | undefined;
    expect(result?.forTool).toBe('Read');
  });
});

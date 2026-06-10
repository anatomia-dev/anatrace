import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { deriveCounts, DERIVE_VERSION } from '../src/derive.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

describe('D-DERIVE — FI-2 runner-gate (parseTestCounts gated to COMMAND_TOOLS via forTool)', () => {
  it('DERIVE_VERSION bumped to "3"', () => {
    expect(DERIVE_VERSION).toBe('3');
  });

  it('a Read result echoing "N passed" is NOT counted (phantom-test vector killed)', () => {
    const lines = jsonl([
      { type: 'assistant', sessionId: 's', uuid: 'a1', timestamp: '2026-06-08T00:00:01.000Z', message: { id: 'm1', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'tool_use', id: 'tu-read', name: 'Read', input: { file_path: '/r/RESULTS.md' } }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
      { type: 'user', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:02.000Z', message: { role: 'user', content: [{ tool_use_id: 'tu-read', type: 'tool_result', content: [{ type: 'text', text: '99 passed\n3 failed' }], is_error: false }] } },
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    const c = deriveCounts(s);
    expect(c.tests_executed).toBe(0);
    expect(c.failures_encountered).toBe(0);
  });

  it('a Bash runner result "N passed" IS counted', () => {
    const lines = jsonl([
      { type: 'assistant', sessionId: 's', uuid: 'a1', timestamp: '2026-06-08T00:00:01.000Z', message: { id: 'm1', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'pnpm test' } }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
      { type: 'user', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:02.000Z', message: { role: 'user', content: [{ tool_use_id: 'tu-bash', type: 'tool_result', content: [{ type: 'text', text: '42 passed' }], is_error: false }] } },
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(deriveCounts(s).tests_executed).toBe(42);
  });

  it('mixed: a Read echo + a Bash runner → only the runner counts', () => {
    const lines = jsonl([
      { type: 'assistant', sessionId: 's', uuid: 'a1', timestamp: '2026-06-08T00:00:01.000Z', message: { id: 'm1', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'tool_use', id: 'tu-read', name: 'Read', input: { file_path: '/r/RESULTS.md' } }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
      { type: 'user', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:02.000Z', message: { role: 'user', content: [{ tool_use_id: 'tu-read', type: 'tool_result', content: [{ type: 'text', text: '99 passed' }], is_error: false }] } },
      { type: 'assistant', sessionId: 's', uuid: 'a2', timestamp: '2026-06-08T00:00:03.000Z', message: { id: 'm2', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'pnpm test' } }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
      { type: 'user', sessionId: 's', uuid: 'u2', timestamp: '2026-06-08T00:00:04.000Z', message: { role: 'user', content: [{ tool_use_id: 'tu-bash', type: 'tool_result', content: [{ type: 'text', text: '5 passed' }], is_error: false }] } },
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(deriveCounts(s).tests_executed).toBe(5); // NOT 104
  });

  it('Codex exec_command runner counts via forTool (call_id join)', () => {
    const lines = jsonl([
      { type: 'session_meta', timestamp: '2026-06-08T00:00:00.000Z', payload: { id: 'sc', originator: 'codex_cli', cli_version: '0.9' } },
      { type: 'turn_context', timestamp: '2026-06-08T00:00:01.000Z', payload: { model: 'gpt-5.5' } },
      { type: 'response_item', timestamp: '2026-06-08T00:00:02.000Z', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"command":"pytest -q"}' } },
      { type: 'response_item', timestamp: '2026-06-08T00:00:03.000Z', payload: { type: 'function_call_output', call_id: 'c1', output: { content: '7 passed' } } },
    ]);
    const s = codexAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(deriveCounts(s).tests_executed).toBe(7);
  });

  it('a result with NO forTool (unjoinable) is NOT counted (gates on no-runner-evidence)', () => {
    // a toolResult constructed without an originating tool_use (orphan) → forTool absent → not counted
    const lines = jsonl([
      { type: 'user', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:02.000Z', message: { role: 'user', content: [{ tool_use_id: 'orphan', type: 'tool_result', content: [{ type: 'text', text: '50 passed' }], is_error: false }] } },
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(deriveCounts(s).tests_executed).toBe(0);
  });
});

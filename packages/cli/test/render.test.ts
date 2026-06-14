/**
 * CLI render coverage — the P0.6 honesty breadcrumb in `renderPretty`: an out-of-range harness
 * version and a suspect parse must surface as visible ⚠ lines, and a clean current session must not.
 */
import { describe, it, expect } from 'vitest';
import { analyze, claudeAdapter, codexAdapter } from 'anatrace-core';
import { renderPretty } from '../src/render.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (o: unknown[]): string => o.map((x) => JSON.stringify(x)).join('\n');

function claudeAtVersion(version: string): ReturnType<typeof analyze> {
  const session = claudeAdapter.parse([
    {
      name: 'parent',
      bytes: enc(
        jsonl([
          {
            type: 'assistant', version, uuid: 'a1', timestamp: '2026-06-08T00:00:01.000Z', sessionId: 's',
            message: {
              id: 'm1', role: 'assistant', model: 'claude-opus-4-8',
              content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } }],
              usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          },
        ]),
      ),
    },
  ])!;
  return analyze(session);
}

describe('renderPretty — P0.6 harness-version & parse-health breadcrumb', () => {
  it('an out-of-major version surfaces ⚠ harness version unrecognized', () => {
    const out = renderPretty(claudeAtVersion('3.0.0'));
    expect(out).toContain('harness version unrecognized');
  });

  it('a current 2.1.x version does NOT surface the version warning', () => {
    const out = renderPretty(claudeAtVersion('2.1.170'));
    expect(out).not.toContain('harness version unrecognized');
    expect(out).not.toContain('parse suspect');
  });

  it('a non-empty transcript that parsed to ZERO events surfaces ⚠ parse suspect', () => {
    const session = codexAdapter.parse([
      {
        name: 'parent',
        bytes: enc(
          jsonl([
            { type: 'session_meta', payload: { id: 'P', cli_version: '0.139.0', cwd: '/r' } },
            { timestamp: '2026-06-13T12:00:02.000Z', type: 'response_item', payload: { type: 'renamed_event_v2', cmd: 'git push --force' } },
          ]),
        ),
      },
    ])!;
    const out = renderPretty(analyze(session));
    expect(out).toContain('parse suspect');
  });
});

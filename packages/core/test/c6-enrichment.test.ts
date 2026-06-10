import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSession } from '../src/parse.js';
import { parseCommandLine } from '../src/adapters/human.js';
import type { NamedBlob } from '../src/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'corpus', 'claude-command', 'parent.jsonl');

function load(): NamedBlob[] {
  return [{ name: 'parent', bytes: new Uint8Array(fs.readFileSync(FIX)) }];
}

describe('C6a — CommandEvent from <command-name>/<command-args>', () => {
  it('emits a CommandEvent{command,args} for a command line with args, and no args otherwise', () => {
    const s = parseSession(load(), 'claude')!;
    const cmds = s.events.filter((e) => e.type === 'command');
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toMatchObject({ type: 'command', command: '/test', args: '--run packages/core' });
    expect(cmds[1]).toMatchObject({ type: 'command', command: '/done' });
    expect('args' in cmds[1]!).toBe(false); // empty <command-args> → no args field
  });

  it('a command line emits ZERO human MessageEvent', () => {
    const s = parseSession(load(), 'claude')!;
    const userMsgs = s.events.filter((e) => e.type === 'message' && e.role === 'user');
    expect(userMsgs).toHaveLength(0);
  });

  it('CommandEvent does NOT enter commands_run (bit-freeze trap)', () => {
    const s = parseSession(load(), 'claude')!;
    // Only the single Bash tool counts; the two CommandEvents must NOT.
    expect(s.counts.commands_run).toBe(1);
    expect(s.counts.tool_calls).toBe(1);
  });

  it('parseCommandLine: FI-10 — extracts command + optional args; null on non-command prose', () => {
    expect(parseCommandLine('<command-name>/foo</command-name>')).toEqual({ command: '/foo' });
    expect(
      parseCommandLine('<command-name>/foo</command-name>\n<command-args>bar baz</command-args>'),
    ).toEqual({ command: '/foo', args: 'bar baz' });
    expect(parseCommandLine('just regular prose')).toBeNull();
    expect(parseCommandLine('<command-args>orphan</command-args>')).toBeNull(); // no command-name
  });
});

describe('C6b — SkillEvent.baseDir/origin via the threaded-block-id join', () => {
  it('joins the base-dir isMeta line to the Skill event and derives origin', () => {
    const s = parseSession(load(), 'claude')!;
    const skill = s.events.find((e) => e.type === 'skill');
    expect(skill).toMatchObject({
      type: 'skill',
      skill: 'testing-standards',
      baseDir: '/work/proj/.claude/skills/testing-standards',
      origin: 'project',
    });
  });

  it('does NOT leak the internal toolUseId join key onto the public SkillEvent', () => {
    const s = parseSession(load(), 'claude')!;
    const skill = s.events.find((e) => e.type === 'skill') as Record<string, unknown>;
    expect('toolUseId' in skill).toBe(false);
  });

  it('the base-dir isMeta line emits ZERO MessageEvent (it must not become prose)', () => {
    const s = parseSession(load(), 'claude')!;
    const baseDirAsProse = s.events.some(
      (e) => e.type === 'message' && typeof e.text === 'string' && e.text.includes('Base directory'),
    );
    expect(baseDirAsProse).toBe(false);
  });
});

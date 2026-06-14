/**
 * P0.2 (Phase 0, Step 3) — the {arm}×{matcher}×{present/absent} table that proves the two shipped
 * false-PASSes are dead and the shared `negate()` mapping holds across arms.
 *
 * Two thesis-level bugs this pins:
 *  1. `evalFileContent`'s negative branch was byte-identical to the positive one, so
 *     `not_contains "x"` on a file that DOES contain x returned `satisfied`. The matcher matrix
 *     never exercised the file-content arm, so it hid.
 *  2. `commandStringOf` read only `input.command`, but a REAL Codex `exec_command` carries the
 *     command under `cmd` (verified on `cli_version` 0.135+ rollouts). The forbidden/force-push
 *     check was therefore DEAD on real Codex input, and the only "cross-harness" test used a
 *     fabricated `command` key under an `if (s)` soft-skip with a verdict-permissive assertion.
 */
import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { verdictForClaim } from '../src/verdict.js';
import { commandStringOf, isUnreadableCommandEvent } from '../src/derive.js';
import type { CheckableClaim, Matcher } from '../src/mandate.js';
import type { NormalizedSession, SessionEvent } from '../src/session.js';
import type { ContentResolver } from '../src/types.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

function assistant(content: unknown[]): unknown {
  return {
    type: 'assistant',
    sessionId: 's',
    uuid: 'a1',
    timestamp: '2026-06-08T00:00:01.000Z',
    message: {
      id: 'm-a1',
      role: 'assistant',
      model: 'claude-opus-4-8',
      content,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

/** A Claude session whose `Bash` tool_use carries the given raw input objects (one event each). */
function claudeBash(inputs: Record<string, unknown>[]): NormalizedSession {
  const content = inputs.map((input, i) => ({ type: 'tool_use', id: `b${i}`, name: 'Bash', input }));
  return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant(content)])) }])!;
}

/** A minimal real-shaped Codex session running ONE `exec_command` with the command under `key`. */
function codexExec(cmdValue: string, key: 'cmd' | 'command'): NormalizedSession | null {
  const lines = jsonl([
    { type: 'session_meta', payload: { id: 'c1', cwd: '/r', originator: 'codex', cli_version: '0.135.0' } },
    {
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: JSON.stringify({ [key]: cmdValue, workdir: '/r' }),
        call_id: 'x1',
      },
    },
  ]);
  return codexAdapter.parse([{ name: 'rollout.jsonl', bytes: enc(lines) }]);
}

function fileContentClaim(value: string, matcher: Matcher): CheckableClaim {
  return {
    id: 'fc',
    says: `file-content ${matcher} ${value}`,
    kind: 'contract-matcher',
    scope: { kind: 'whole-session' },
    source: { kind: 'cross-artifact', workItemSlug: 'p', path: 'contract.yaml', fidelity: 'verbatim' },
    predicate: { target: 'file-content', matcher, scope: 'transcript', value },
  };
}
const resolverFor =
  (text: string): ContentResolver =>
  (p: string) =>
    p === 'contract.yaml' ? enc(text) : null;

function forbiddenCommandClaim(value: string, matcher: Matcher = 'not_contains'): CheckableClaim {
  return {
    id: `cmd:${value}`,
    says: `must not run ${value}`,
    kind: 'command-run',
    scope: { kind: 'whole-session' },
    source: { kind: 'in-blob', blob: 'agents/ana-verify.md', fidelity: 'verbatim' },
    predicate: { target: 'command-content', matcher, scope: 'transcript', value },
  };
}

const empty = (): NormalizedSession => claudeAdapter.parse([{ name: 'p', bytes: enc(jsonl([assistant([])])) }])!;

// ──────────────────────────────────────────────────────────────────────────────────────────
describe('P0.2 — commandStringOf reads the real command key across harnesses', () => {
  const ev = (name: string, input: unknown): SessionEvent =>
    ({ type: 'tool', name, input, agent: { kind: 'root' } }) as unknown as SessionEvent;

  it('Claude Bash → input.command (string)', () => {
    expect(commandStringOf(ev('Bash', { command: 'git push --force' }))).toBe('git push --force');
  });
  it('Codex exec_command → input.cmd (string) — the previously-dead real key', () => {
    expect(commandStringOf(ev('exec_command', { cmd: 'git rebase origin/main' }))).toBe('git rebase origin/main');
  });
  it('argv ARRAY under either key is joined', () => {
    expect(commandStringOf(ev('exec_command', { cmd: ['bash', '-lc', 'git push --force'] }))).toBe(
      'bash -lc git push --force',
    );
  });
  it('canary: a command tool with an UNRECOGNIZED key → "" AND isUnreadableCommandEvent=true', () => {
    const e = ev('Bash', { shell: 'git push --force' });
    expect(commandStringOf(e)).toBe('');
    expect(isUnreadableCommandEvent(e)).toBe(true);
  });
  it('an EMPTY input object is honestly command-less — canary does NOT trip', () => {
    expect(isUnreadableCommandEvent(ev('Bash', {}))).toBe(false);
  });
  it('a non-command tool is never a canary', () => {
    expect(isUnreadableCommandEvent(ev('Read', { file_path: '/x' }))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────────────────
describe('P0.2 — file-content arm: {matcher}×{present/absent} (the byte-identical-branch bug)', () => {
  const text = 'export const SECRET = process.env.TOKEN;\n';

  it('not_contains + content PRESENT → violated (THE bug: previously a false satisfied)', () => {
    const v = verdictForClaim(fileContentClaim('process.env', 'not_contains'), empty(), resolverFor(text));
    expect(v).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
  });
  it('not_contains + content ABSENT → satisfied', () => {
    const v = verdictForClaim(fileContentClaim('eval(', 'not_contains'), empty(), resolverFor(text));
    expect(v).toMatchObject({ status: 'satisfied', reason: 'predicate-matched' });
  });
  it('contains + content PRESENT → satisfied', () => {
    const v = verdictForClaim(fileContentClaim('process.env', 'contains'), empty(), resolverFor(text));
    expect(v).toMatchObject({ status: 'satisfied', reason: 'predicate-matched' });
  });
  it('contains + content ABSENT → violated', () => {
    const v = verdictForClaim(fileContentClaim('eval(', 'contains'), empty(), resolverFor(text));
    expect(v).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
  });
});

// ──────────────────────────────────────────────────────────────────────────────────────────
describe('P0.2 — command-content forbidden direction is REAL on Codex (the cmd-key thesis bug)', () => {
  it('Codex exec_command under the REAL `cmd` key + force-push → violated (strict, not soft-skipped)', () => {
    const s = codexExec('git push --force origin main', 'cmd');
    expect(s).not.toBeNull();
    const v = verdictForClaim(forbiddenCommandClaim('git push --force'), s!);
    expect(v).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(v.evidence.length).toBeGreaterThan(0);
  });
  it('Codex legacy `command` key still works (back-compat preserved)', () => {
    const s = codexExec('git rebase origin/main', 'command');
    expect(s).not.toBeNull();
    expect(verdictForClaim(forbiddenCommandClaim('git rebase'), s!).status).toBe('violated');
  });
  it('Claude Bash force-push → violated (cross-harness parity)', () => {
    const v = verdictForClaim(forbiddenCommandClaim('git push --force'), claudeBash([{ command: 'git push --force origin x' }]));
    expect(v.status).toBe('violated');
  });
  it('canary: an UNREADABLE command event + no hit → unverifiable, NEVER a false satisfied', () => {
    const s = claudeBash([{ shell: 'git push --force origin x' }]); // unknown key → unreadable
    const v = verdictForClaim(forbiddenCommandClaim('git push --force'), s);
    expect(v.status).toBe('unverifiable');
    expect(v.status).not.toBe('satisfied');
  });
  it('a genuinely clean Codex session (only safe commands) → satisfied', () => {
    const s = codexExec('git status --porcelain', 'cmd');
    expect(s).not.toBeNull();
    expect(verdictForClaim(forbiddenCommandClaim('git push --force'), s!).status).toBe('satisfied');
  });
});

// ──────────────────────────────────────────────────────────────────────────────────────────
describe('P0.2 — read-paths negate() refactor preserved (regression)', () => {
  function sessReads(paths: string[]): NormalizedSession {
    const content = paths.map((file_path, i) => ({ type: 'tool_use', id: `r${i}`, name: 'Read', input: { file_path } }));
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant(content)])) }])!;
  }
  function readPathClaim(value: string, matcher: 'contains' | 'not_contains'): CheckableClaim {
    return {
      id: 'verify-independence',
      says: `never reads ${value}`,
      kind: 'human-constraint',
      scope: { kind: 'whole-session' },
      source: { kind: 'cross-artifact', workItemSlug: 'plan', path: 'contract.yaml', fidelity: 'verbatim' },
      predicate: { target: 'read-paths', matcher, scope: 'transcript', value },
    };
  }
  it('not_contains + a real Read of the path → violated', () => {
    expect(verdictForClaim(readPathClaim('build_report', 'not_contains'), sessReads(['/r/build_report.md'])).status).toBe(
      'violated',
    );
  });
  it('not_contains + the path never read → satisfied', () => {
    expect(verdictForClaim(readPathClaim('build_report', 'not_contains'), sessReads(['/r/spec.md'])).status).toBe(
      'satisfied',
    );
  });
});

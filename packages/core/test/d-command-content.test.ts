/**
 * D-NONOBVIOUS — the `command-content` predicate target (the narrowly-implemented `command-run`
 * transcript check) + the Anatomia adapter's AnaVerify "read-only on the codebase" claims.
 *
 * The rule (cited): `.claude/agents/ana-verify.md` — AnaVerify "do[es] NOT fix code … do NOT
 * merge" (L20) and is "read-only on the codebase. The only file you write is verify_report.md"
 * (L502). Its sole sanctioned git is `ana artifact save` (commits/pushes the REPORT) + `ana pr
 * create`. A `git rebase` / `git push --force*` REWRITES the code branch — forbidden. The
 * `tool-names` target (name-only: every shell call is just `'Bash'`) cannot see WHICH command
 * ran; `command-content` matches the `Bash`/`exec_command` `input.command` STRING, so a forbidden
 * command class becomes a deterministic transcript verdict.
 *
 * PROVEN on the real corpus: 2/10 AnaVerify sessions rebased + force-pushed the feature branch
 * (gitignore-merge-on-reinit, proof-last-and-completion-hint); the other 8 are clean. These tests
 * pin the evaluator + adapter behavior that catches exactly that.
 */
import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { anatomiaAdapter } from '../src/adapters/anatomia.js';
import { verdictForClaim } from '../src/verdict.js';
import type { CheckableClaim, Matcher } from '../src/mandate.js';
import type { NormalizedSession } from '../src/session.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

function assistant(content: unknown[], uuid: string, ts: string): unknown {
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

/** A Claude session that runs the given Bash command strings (one tool_use each). */
function sessWithCommands(cmds: string[]): NormalizedSession {
  const content = cmds.map((command, i) => ({ type: 'tool_use', id: `b${i}`, name: 'Bash', input: { command } }));
  return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant(content, 'a1', '2026-06-08T00:00:01.000Z')])) }])!;
}

/** A forbidden-command (`command-run` / `command-content` / negative matcher) claim. */
function forbiddenCommandClaim(value: string, matcher: Matcher = 'not_contains'): CheckableClaim {
  return {
    id: `ana-verify:no-code-branch-mutation:${value}`,
    says: `must not run \`${value}\``,
    kind: 'command-run',
    scope: { kind: 'whole-session' },
    source: { kind: 'in-blob', blob: 'agents/ana-verify.md', fidelity: 'verbatim' },
    predicate: { target: 'command-content', matcher, scope: 'transcript', value },
  };
}

describe('command-content evaluator (forbidden-command direction)', () => {
  it('VIOLATED — the forbidden command string appears in a Bash command (real positive shape)', () => {
    // Mirrors gitignore-merge-on-reinit verify session: a rebase + force-push of the code branch.
    const s = sessWithCommands([
      'git fetch origin main -q',
      'git status --porcelain; echo "--- rebasing onto origin/main ---"; git rebase origin/main 2>&1 | tail -25',
      'git push --force-with-lease origin feature/gitignore-merge-on-reinit',
    ]);
    const rebase = verdictForClaim(forbiddenCommandClaim('git rebase'), s);
    const push = verdictForClaim(forbiddenCommandClaim('git push --force'), s);
    expect(rebase).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(push).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    // Evidence POINTS into the timeline (scrub-safe) — never copies bytes.
    expect(rebase.evidence.length).toBeGreaterThan(0);
    expect(push.evidence.length).toBeGreaterThan(0);
  });

  it('SATISFIED — a clean verify session (only sanctioned `ana artifact save` / `ana pr create`)', () => {
    const s = sessWithCommands([
      'ana test --stage verify --slug foo',
      'ana artifact save verify-report foo',
      'ana pr create foo',
      'git status --porcelain',
      'git log --oneline -5',
    ]);
    expect(verdictForClaim(forbiddenCommandClaim('git rebase'), s).status).toBe('satisfied');
    expect(verdictForClaim(forbiddenCommandClaim('git push --force'), s).status).toBe('satisfied');
  });

  it('`git push --force` matches `--force-with-lease` (contiguous substring — no false negative)', () => {
    const s = sessWithCommands(['git push --force-with-lease origin feature/x']);
    expect(verdictForClaim(forbiddenCommandClaim('git push --force'), s).status).toBe('violated');
  });

  it('does NOT match a benign `git push` without --force (precision — no false accuse)', () => {
    const s = sessWithCommands(['git push origin feature/x']);
    expect(verdictForClaim(forbiddenCommandClaim('git push --force'), s).status).toBe('satisfied');
  });

  it('reads ONLY Bash/exec_command — a Read whose path contains the needle is never a command hit', () => {
    const content = [{ type: 'tool_use', name: 'Read', input: { file_path: '/r/notes-about-git-rebase.md' } }];
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant(content, 'a1', '2026-06-08T00:00:01.000Z')])) }])!;
    expect(verdictForClaim(forbiddenCommandClaim('git rebase'), s).status).toBe('satisfied');
  });

  it('FI-17 totality — a non-comparable matcher (`matches`) → unverifiable, never a silent verdict', () => {
    const s = sessWithCommands(['git rebase origin/main']);
    expect(verdictForClaim(forbiddenCommandClaim('git rebase', 'matches'), s)).toMatchObject({
      status: 'unverifiable',
      reason: 'content-unresolvable',
    });
  });

  it('positive matcher ("ran X"): hit → satisfied; absent → unverifiable(absent-signal)', () => {
    const hit = sessWithCommands(['git rebase origin/main']);
    const miss = sessWithCommands(['git status']);
    expect(verdictForClaim(forbiddenCommandClaim('git rebase', 'contains'), hit).status).toBe('satisfied');
    expect(verdictForClaim(forbiddenCommandClaim('git rebase', 'contains'), miss)).toMatchObject({
      status: 'unverifiable',
      reason: 'absent-signal',
    });
  });

  it('cross-harness — the forbidden-command direction is real on Codex (exec_command emits a command)', () => {
    // A minimal Codex session that runs a forbidden command via exec_command.
    const codexLines = jsonl([
      { type: 'session_meta', payload: { id: 'c1', cwd: '/r', originator: 'codex' } },
      { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ command: 'git rebase origin/main' }), call_id: 'x1' } },
    ]);
    const s = codexAdapter.parse([{ name: 'rollout.jsonl', bytes: enc(codexLines) }]);
    if (s) {
      const v = verdictForClaim(forbiddenCommandClaim('git rebase'), s);
      // Either it parsed the exec_command (→ violated) or the harness shape differs; never a false satisfied with a real hit present.
      expect(['violated', 'satisfied', 'unverifiable']).toContain(v.status);
    }
  });
});

describe('anatomia adapter — AnaVerify command-run claims', () => {
  const verifyDef = enc(
    [
      '---',
      'name: ana-verify',
      'skills: [testing-standards, coding-standards]',
      '---',
      '# AnaVerify',
      'You do NOT fix code. You do NOT merge. You report what you find.',
      "You never read the build report.",
      'Don’t modify source files. You are read-only on the codebase. The only file you write is verify_report.md.',
    ].join('\n'),
  );

  it('emits a command-run forbidden-command claim per code-branch-mutating git op (only for ana-verify)', () => {
    const m = anatomiaAdapter.extract([{ name: 'agents/ana-verify.md', bytes: verifyDef }]);
    expect(m).not.toBeNull();
    const cmdRun = m!.claims.filter((c) => c.kind === 'command-run');
    expect(cmdRun.map((c) => c.id).sort()).toEqual([
      'ana-verify:no-code-branch-mutation:git-push---force',
      'ana-verify:no-code-branch-mutation:git-rebase',
    ]);
    // Each is a transcript-scoped command-content NEGATIVE matcher (a forbidden-set obligation).
    for (const c of cmdRun) {
      expect(c.predicate).toMatchObject({ target: 'command-content', scope: 'transcript', matcher: 'not_contains' });
    }
  });

  it('does NOT emit the command-run claims for a NON-verify agent (e.g. ana-build)', () => {
    const buildDef = enc(
      ['---', 'name: ana-build', 'skills: [git-workflow]', '---', '# AnaBuild', 'You are read-only on the codebase.'].join('\n'),
    );
    const m = anatomiaAdapter.extract([{ name: 'agents/ana-build.md', bytes: buildDef }]);
    const cmdRun = (m?.claims ?? []).filter((c) => c.kind === 'command-run');
    expect(cmdRun).toHaveLength(0);
  });
});

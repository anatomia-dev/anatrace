/**
 * 0a — conformance spec for the quote-aware three-tier command matcher (`classifyCommandMatch`).
 *
 * THE BUG IT FIXES: the old path matched a forbidden-command needle with a literal `.includes` on
 * the whole command string, so a needle in a NON-EXECUTED position (`echo "git push --force"`,
 * `git commit -m "git push --force"`) false-VIOLATEd. The fix resolves the EXECUTED command surface.
 *
 * THE LOAD-BEARING INVARIANT (the acceptance test, `describe('invariant')`): a surface-extraction or
 * quoting AMBIGUITY may only ever resolve to `match` (violated) or `unresolvable` (abstain) — NEVER
 * `no-match` (satisfied). If the stripper mis-judged an executed command as data, a real forbidden
 * command would read clean: the cardinal sin, hidden inside the fix. So every "the needle IS executed
 * but obfuscated" case below must be `match` or `unresolvable`; `no-match` is reserved for the cases
 * where the needle provably never executed (data position, comment, unrelated token).
 *
 * THREE TIERS:
 *   match        -> violated         (the needle is the executed command; force variants live here)
 *   no-match     -> satisfied        (needle only in data / comment / unrelated token)
 *   unresolvable -> unverifiable(command-unresolvable)   (obfuscation defeats a static surface)
 */
import { describe, it, expect } from 'vitest';
import { classifyCommandMatch } from '../src/command-match.js';

const PUSH = 'git push --force';
const REBASE = 'git rebase';

/** Substring direction (`not_contains` / `contains`) unless `exact` is passed. */
const tier = (cmd: string, needle: string, exact = false): string =>
  classifyCommandMatch(cmd, needle, exact);

describe('0a — T1 (match -> violated): the needle is the executed command', () => {
  const cases: Array<[string, string]> = [
    ['git push --force-with-lease origin feature/x', PUSH], // force-with-lease REWRITES the branch
    ['git push --force origin x', PUSH],
    ['git push "--force"', PUSH], // a quoted FLAG is still executed (quotes concatenate away)
    ['git rebase origin/main', REBASE],
    ['git status --porcelain; echo "--- rebasing ---"; git rebase origin/main 2>&1 | tail -25', REBASE], // mid-chain
    ['cd /repo && git push --force', PUSH], // segment after &&
    ['git -c core.pager=cat push --force', PUSH], // global -c value is data; push --force is the command
    ['bash -c "git push --force"', PUSH], // interpreter with a LITERAL -c arg -> recurse -> the literal is the command
    ['git   push   --force', PUSH], // whitespace runs collapse
    ['parallel -m git push --force ::: origin', PUSH], // `-m`'s value is UNQUOTED command tokens, not a message
    ['somewrapper --file git rebase origin', REBASE], // an unquoted token after a message-flag is still a command
    // A MID-command redirection must not inject its fd/target into the surface and break needle contiguity:
    // each of these truly executes the needle (the redirect is not part of argv).
    ['git push 2>/dev/null --force', PUSH], // fd-qualified redirect between `push` and `--force`
    ['git >log push --force', PUSH], // leading stdout redirect; argv is `git push --force`
    ['git 2>&1 push --force', PUSH], // fd-dup redirect mid-command
    ['git push >log --force', PUSH], // target `log` must not merge into the command surface
    ['git push >"my log" --force', PUSH], // quoted redirect target must not swallow `--force`
    ['git>log push --force', PUSH], // no-space redirect operator
    ['git push --force >/dev/null 2>&1', PUSH], // a redirect AFTER the needle does not erase it
  ];
  for (const [cmd, needle] of cases) {
    it(`match: ${cmd}`, () => expect(tier(cmd, needle)).toBe('match'));
  }

  // Independent boundary check (NOT the agent's fixtures): when `--force` is the redirect TARGET it is a
  // filename, not the executed flag — `git push >--force` does NOT force-push, so it must be no-match.
  it('the safe boundary: a needle token that is actually a redirect target is no-match', () => {
    expect(tier('git push >--force origin', PUSH)).toBe('no-match'); // `--force` is the stdout target file
    expect(tier('git push 1>--force', PUSH)).toBe('no-match');
  });
});

describe('0a — T2 (no-match -> satisfied): the needle provably never executed', () => {
  const cases: Array<[string, string]> = [
    ['echo "git push --force"', PUSH], // echo is a data-program: its args are never executed
    ['git commit -m "git push --force"', PUSH], // the needle is a commit MESSAGE (flag value = data)
    ['git commit --message="git push --force"', PUSH], // --flag=value form, value is data
    ['printf "git rebase\\n"', REBASE],
    ['git push origin feature/x', PUSH], // benign push, no --force
    ['git push', PUSH],
    ['# git push --force', PUSH], // a comment is never executed
    ['cat notes-about-git-rebasing.md', REBASE], // unrelated token ("git-rebasing" != "git rebase")
    ['ana artifact save verify-report foo', PUSH],
  ];
  for (const [cmd, needle] of cases) {
    it(`no-match: ${cmd}`, () => expect(tier(cmd, needle)).toBe('no-match'));
  }
});

describe('0a — T3 (unresolvable -> abstain): obfuscation defeats a static surface', () => {
  const cases: Array<[string, string]> = [
    ['eval "git push --force"', PUSH], // eval of a string -> can't statically prove it didn't run
    ['eval "$CMD"', PUSH],
    ['git push $FORCEFLAG', PUSH], // unquoted expansion in command position could BE --force
    ['echo "git push --force" | sh', PUSH], // piped INTO a shell interpreter
    ['printf "%s" "$X" | bash', PUSH],
    ['$(echo git push --force)', PUSH], // command substitution in PROGRAM position
    ['`git push --force`', PUSH], // backtick substitution
    ['base64 -d <<< "Z2l0" | bash', PUSH], // encoded payload piped to bash
    ['bash -c "$X"', PUSH], // interpreter with a NON-literal -c arg
    ['sh <<EOF\ngit push --force\nEOF', PUSH], // heredoc fed to an interpreter
    ['xargs sh -c "git push --force"', PUSH], // a WRAPPER hands the quoted command to sh -> can't drop it
    ['grep "git push --force" notes.txt', PUSH], // unknown program with the needle as a quoted arg -> abstain
    ['parallel -m "git push --force" ::: a b', PUSH], // `-m` value on a NON-VCS runner is the executed template
    ['parallel --message="git push --force" ::: a', PUSH], // the `--message=` form on a non-VCS runner too
    ['git push --force', PUSH.replace('push', 'push')], // (sanity placeholder; replaced below)
  ];
  // drop the sanity placeholder (kept the array literal honest above)
  cases.pop();
  for (const [cmd, needle] of cases) {
    it(`unresolvable: ${cmd.replace(/\n/g, '\\n')}`, () =>
      expect(tier(cmd, needle)).toBe('unresolvable'));
  }

  it('unbalanced quoting is unresolvable, never satisfied (parse ambiguity biases safe)', () => {
    expect(tier('echo "git push --force', PUSH)).toBe('unresolvable'); // unterminated double quote
    expect(tier("git push --force'", PUSH)).toBe('unresolvable'); // stray single quote
  });
});

describe('0a — INVARIANT: an executed-but-obfuscated forbidden command is NEVER no-match', () => {
  // Every entry is a command where the forbidden needle either IS executed or COULD be (hidden in an
  // expansion/eval/pipe). None may resolve to `no-match` (satisfied) — that would be the cardinal sin.
  const executedOrAmbiguous = [
    'git push --force-with-lease origin x',
    'git push "--force"',
    'git push --"force"', // split-across-quote-boundary flag — still executes --force
    'git push --fo"rce"',
    'eval "git push --force"',
    'git push $F',
    'echo "git push --force" | sh',
    '$(git push --force)',
    '`git push --force`',
    'bash -c "$X"',
    'X=--force; git push $X',
    'git push \\\n--force', // backslash-newline line continuation -> executes git push --force
    'git push --force #danger', // a trailing comment does not undo the force push
    'git push 2>/dev/null --force', // mid-command redirect must not break needle contiguity
    'git 1>out 2>err push --force', // multiple mid-command redirects
    'echo "git push --force', // unbalanced
  ];
  for (const cmd of executedOrAmbiguous) {
    it(`never satisfied: ${cmd.replace(/\n/g, '\\n')}`, () => {
      expect(tier(cmd, PUSH)).not.toBe('no-match');
    });
  }
});

describe('0a — exact direction (not_equals / equals)', () => {
  it('exact match on the executed surface', () => {
    expect(tier('git rebase', REBASE, true)).toBe('match');
    expect(tier('git rebase origin/main', REBASE, true)).toBe('no-match'); // not EQUAL (extra args)
    expect(tier('echo "git rebase"', REBASE, true)).toBe('no-match'); // data
  });
});

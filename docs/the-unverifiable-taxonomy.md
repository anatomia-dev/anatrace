# The `unverifiable` taxonomy — and the command matcher (0a)

anatrace's verdicts are a closed, typed vocabulary. A claim resolves to `satisfied`, `violated`, or
`unverifiable(reason)` — and the `reason` is a frozen enum (`VerdictReason`), never free prose. This is
the honesty floor as a type system: when the evidence cannot mechanically decide the claim, the tool
abstains with a *named* reason instead of guessing. A verifier that over-claims is worse than none.

This doc covers the command-content matcher and its abstention reason, `command-unresolvable` (added in
0a). For the full reason set, see `packages/core/src/verdict.ts` (`VerdictReason`).

## The command matcher is three-tier (0a)

A forbidden-command policy (`never_run: git push --force`, an anatomia AnaVerify "read-only on the
codebase" rule, …) asks: *did the agent run a command matching this needle?* Older anatrace answered
with a literal substring test (`.includes`) over the whole command string. That **false-VIOLATEd** a
needle that appeared in a non-executed position — `echo "git push --force"` or `git commit -m "git push
--force"` *mention* the forbidden command, they don't run it. A false-VIOLATE on a verifier is
thesis-breaking, exactly like a false-PASS.

The matcher (`packages/core/src/command-match.ts`) now resolves the **executed command surface**,
quote-aware, and returns one of three tiers:

| Tier | Meaning | Verdict | Examples |
|------|---------|---------|----------|
| **match** | the needle **is** the executed command | `violated` | `git push --force-with-lease` (force variants rewrite the branch — they STAY violated); `git rebase origin/main`; `git -c core.pager=cat push --force` (a global flag doesn't hide the subcommand) |
| **no-match** | the needle provably never executed | `satisfied` | `echo "git push --force"` (data-program arg); `git commit -m "git push --force"` (a commit message); `# git push --force` (a comment); `git push origin` (benign) |
| **unresolvable** | obfuscation defeats a static surface | `unverifiable(command-unresolvable)` | `eval "git push --force"`; `git push $VAR`; `… | sh`; `$(…)` / backticks; `bash -c "$X"`; a heredoc fed to an interpreter; unbalanced quoting; a quoted command handed to a wrapper (`xargs sh -c "…"`) |

### The load-bearing invariant

> A surface-extraction or quoting **ambiguity may only ever resolve to `match` or `unresolvable` —
> never `no-match`.**

If the matcher mis-judged an executed command as data, a real forbidden command would read clean — the
cardinal sin, hidden inside the fix. Every bias is therefore toward `violated`/`unverifiable`:
unparseable quoting abstains; an unrecognized quoted token defaults to *command* position; any
command-position shell expansion / substitution / `eval` / pipe-into-an-interpreter abstains; a
message-flag value (`-m "…"`) is trusted as data **only** for VCS-like programs we know take a commit
message (`git`/`hg`/`gh`/…), never for an arbitrary command-runner (`parallel -m "git push --force"`
abstains). The conformance fixtures in `packages/core/test/command-match.test.ts` are the spec, and the
`INVARIANT` block is the acceptance test (a curated set of executed-but-obfuscated commands, none of
which may be `no-match`).

### `command-unresolvable` is reported, not silent

Each abstention surfaces as a per-claim `unverifiable:command-unresolvable` line in the coverage receipt
(and the `--json` `compliance` array), so the abstention is visible and countable — the floor cannot
become a silent sink. The aggregate command-abstention rate is surfaced in the front-door render (N1).

### v1 boundaries (documented, not hidden)

- **Alias / function indirection** is not resolved: a command run via an alias whose definition isn't in
  the transcript is out of static reach. v1 does not abstain on every unknown program (that would make
  the floor a sink); a defined-alias-aware tier is future work.
- The needle is a literal substring/exact pattern: `git push origin --force` (the flag after a positional
  arg) does not contain the contiguous substring `git push --force`. Broadening the needle set is an
  adapter concern, not a matcher concern.

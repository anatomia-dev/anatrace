---
"anatrace-core": minor
---

0a — quote-aware three-tier command matcher; fix the non-executed-position false-VIOLATE; add the frozen `command-unresolvable` reason.

The forbidden-command check (`command-content`) matched a needle with a literal `.includes` over the whole command string, so a needle in a NON-EXECUTED position false-VIOLATEd: `echo "git push --force"` and `git commit -m "git push --force"` *mention* the forbidden command without running it, yet resolved `violated`. On a verifier a false-VIOLATE is thesis-breaking, exactly like a false-PASS.

The new matcher (`command-match.ts`) resolves the EXECUTED command surface, quote-aware, into three tiers:

- **match → `violated`** — the needle IS the executed command. Force variants STAY violated (`git push --force-with-lease` rewrites the branch); a `git` global flag (`git -c core.pager=cat push --force`) no longer hides the subcommand (a latent false-negative the old `.includes` also missed).
- **no-match → `satisfied`** — the needle provably never executed (a data-program arg, a commit-message value, a comment, an unrelated token).
- **unresolvable → `unverifiable(command-unresolvable)`** — a NEW member of the frozen `VerdictReason` enum (carries the snapshot + reachability lock). Emitted when obfuscation defeats a static surface: `eval`, `$(…)`/backticks, a `$VAR` that could expand to the needle, a pipe into a shell interpreter, a heredoc/here-string fed to one, an unbalanced quote, or a quoted command handed to a wrapper (`xargs sh -c "…"`, `parallel -m "…"`).

**The load-bearing invariant** (acceptance test in `command-match.test.ts`'s `INVARIANT` block): a surface-extraction or quoting ambiguity may only ever resolve to `match` or `unresolvable`, **never** `no-match` — a mis-judged executed command must never read clean. Validated test-first against an adversarial conformance corpus (nested/escaped quotes, `--flag=value`, heredocs, line continuations, redirections, message-flag-vs-command-runner, wrapper indirection) and hardened by three independent adversarial review rounds that each surfaced and closed a false-`no-match` (message-flag value-drop, its quoted sibling, mid-command redirection injection). (A pre-publish review later found one more — an ANSI-C `$'...'` off-by-one — fixed in the same 0.4.0 release; see the `command-match-ansi-c-false-pass` changeset.)

`command-unresolvable` surfaces per-claim in the coverage receipt and the `--json` `compliance` array, so the abstention is reported, never a silent sink. Doc: `docs/the-unverifiable-taxonomy.md`.

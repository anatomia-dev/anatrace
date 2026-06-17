# Session facts (the consumer surface)

`anatrace-core` exposes a deterministic, **facts-only** projection layer on top of the parsed
timeline, for downstream tools that consume anatrace for *parsing + session facts* (e.g. a
session-analytics aggregator) rather than for the policy verdict.

These are **not** part of the anatrace brand surface — the README/essay lead with the deterministic
zero-LLM *verdict*, never these facts. Everything here is a pure projection of the already-parsed
`NormalizedSession.events`: **zero LLM, zero verdict, no author/identity field, no composite score.**
Same input bytes → same output. The deterministic verdict path and the `--json` envelope are
independent of this layer.

> Stability: these symbols are public and versioned. A removal is a major bump with a changelog
> entry. New facts are additive (minor).

## What's exported

| Symbol | Kind | What it gives you |
| --- | --- | --- |
| `buildSessionMeta(session)` | `SessionMetaFacts \| undefined` | The per-session aggregate facts block (compaction, context, git, environment, flow, scope-shape). The same block `analyze()` attaches to `Report.session`. |
| `gitOpsTimeline(events)` | `GitOpEvent[]` | The positioned mutating-git-op stream — *when*, in what order, on which lane. |
| `runnerOutcomes(events)` | `RunnerOutcome[]` | Structured test-runner outcomes (`pass`/`fail`/`unknown`), runner-gated. |
| `CONTEXT_LIMITS` / `CONTEXT_LIMITS_VERSION` / `contextLimitFor(model)` | data + fn | The model → context-window calibration table (the same data category as `PRICES`). |

Supporting types are exported too: `SessionMetaFacts`, `CompactionFacts`, `CompactionBoundary`,
`ContextFacts`, `EnvironmentFacts`, `FlowFacts`, `ScopeShapeFacts`, `GitOpsSummary`, `GitOpCounts`,
`GitOpEvent`, `RunnerOutcome`, `ContextLimitEntry`.

## `gitOpsTimeline(events) → GitOpEvent[]`

The aggregate `SessionMetaFacts.gitOps` answers *how many*; this answers *when, in what order, on
which lane* — the substrate for a "did a failure run turn into a later commit" / "is this commit
real or a no-op" analysis.

```ts
import { parseSession, gitOpsTimeline } from 'anatrace-core';

const session = parseSession([{ name: 'parent', bytes }])!;
for (const op of gitOpsTimeline(session.events)) {
  // { subcommand, argv, forcePush, lineIndex, ts?, agent, blobName }
  console.log(op.lineIndex, op.subcommand, op.argv, op.forcePush, op.agent);
}
```

- `subcommand` — the git verb as executed (`commit`/`push`/`rebase`/…), after skipping
  `git -C`/`-c` globals. **Only mutating subcommands are emitted**; read-only (`log`/`status`/
  `diff`/…) are excluded — byte-for-byte the same scope as the aggregate counter.
- `argv` — the args after the subcommand, **quote-aware** shell tokens (a quoted `-m "msg with
  spaces"` stays one token; an unresolved `$VAR`/`$(…)` renders as a sentinel). Read it to tell a
  real commit from a no-op/amend (`--allow-empty`, `--amend`), see a branch name, or read any flag.
  anatrace exposes the surface; the "real vs no-op" *judgment* is yours.
- `forcePush` — precomputed for `push` with `--force`/`-f`/`--force-with-lease[=…]`; always `false`
  for non-push ops.
- `agent` — the lane (`{ kind: 'root' }` or `{ kind: 'subagent', subagentId }`). Git volume is
  gameable by subagent churn, so the lane is kept; filter for a lane-scoped view.

Segmentation uses the **same quote-aware lexer as the verdict-path command matcher**, so a `git`
token inside quoted data (`echo "…; git push …"`) is never a phantom op, and a newline-separated
multi-command script counts every real op. One chained command (`git add x && git commit`) yields
two ops at the one event's position, in chain order.

## `runnerOutcomes(events) → RunnerOutcome[]`

Structured test outcomes, with the honesty floor built in.

```ts
import { runnerOutcomes } from 'anatrace-core';

for (const r of runnerOutcomes(session.events)) {
  // { runner, outcome: 'pass'|'fail'|'unknown', passed?, failed?, skipped?, toolUseId?, lineIndex, ts?, agent, blobName }
}
```

Three properties:

1. **Runner-gated.** Only `toolResult` events whose originating tool is a shell-command tool
   (`forTool ∈ { Bash, exec_command }`) are considered. A `Read`/`Grep` result that *echoes*
   "N passed" is never an outcome.
2. **Classifies only on a runner-specific banner.** Two shapes ship: vitest/jest (the
   `Test Files` / `Tests` summary block) and the ana-internal `(verdict: pass|fail)` line. A bare
   `N passed`, a `… in <n>s` timing line, and a `test result:` line are **deliberately not
   classified** — they are not runner-specific (deploy logs, health checks, `npm audit`, load tests,
   build summaries all emit them), so classifying on them would be a false PASS.
3. **Abstains rather than guesses.** ANSI/CSI color is stripped before matching (a colored failure
   token can't hide); a vitest banner present but with an unreadable count → `outcome: 'unknown'`,
   never a fabricated pass.

### Known blind spots (by design)

These are honest *under-detection* gaps — a missed signal, never a fabricated one:

- **pytest / cargo / `go test` produce no outcome.** Their summaries (`5 passed in 0.31s`,
  `test result: ok. N passed`, `ok/FAIL`) are not distinguishable from non-test command output
  without re-opening the false-PASS risk, and there is no real-transcript grounding for them yet.
  A real pytest run yields no `RunnerOutcome` rather than a wrong one. They will be added when a
  transcript supplies a tell that can be pinned without over-reaching.
- **git under-emits in a few shell shapes** — loop bodies (`do git …; done`), subshells
  (`( git … )`), a command glued after a heredoc terminator, and unbalanced-quote lines (where the
  lexer abstains and emits nothing). These are *misses*, consistent between `gitOpsTimeline` and the
  aggregate `gitOpsOf`, and never phantom ops.

## Calibration tables

`CONTEXT_LIMITS` (model → context-window tokens) and `PRICES` (model → token pricing) are
hand-curated reference data, each stamped with a version (`CONTEXT_LIMITS_VERSION`,
`PRICE_TABLE_VERSION`). They move as models/prices ship — pin the version and treat a bump as a
calibration change. `contextLimitFor(model)` returns the limit or `undefined` (unknown model →
omitted, never guessed), mirroring `computeCost`'s `priced: false` discipline.

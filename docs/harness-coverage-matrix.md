# Harness coverage matrix

anatrace parses two harnesses today. Harnesses drift — Claude Code ships 2–3×/week, Codex
irregularly — so the honest question is never "do we support version X" but "what happens when the
format we see isn't the one we validated." This page documents the supported floor and the
fail-loud signals that keep a drifted transcript from producing a false verdict.

## Supported floor (coarse, catastrophic)

| Harness | Recognized major range | Real versions seen |
|---------|------------------------|--------------------|
| Claude Code (`claude`) | `>= 2.0 < 3.0` | 2.1.90 … 2.1.170+ |
| Codex (`codex`) | `>= 0.0 < 1.0` | 0.135 … 0.139 |

The range lives in **one** table (`harness-support.ts` → `SUPPORTED_MAJOR`) and is edited **only on a
major harness bump**. It is **not** a per-version allowlist (that would be an adapter treadmill,
firing on nearly every real session) and it is **not a trust signal**: "within range" means
"plausibly the shape we know," never "validated."

## The honesty layers (none of them implies trust)

1. **Catastrophic floor → `harness-version-unrecognized`.** A *parseable* version whose **major** is
   outside the range is a format anatrace has never seen, so it cannot trust any parse-based verdict:
   every transcript-scoped claim resolves `unverifiable(harness-version-unrecognized)`. An **absent**
   version is surfaced as a breadcrumb but does **not** gate (a version-less session that still parsed
   to real events is not proof of misparse).

2. **Within-major drift → structural signals, never the version check.** The format can change
   *inside* a supported range — it already did: the CC delegate-sidecar `toolUseId` field did not
   exist at or below **2.1.90**, so its absence on an older session is **expected**, not a missing
   dispatch link (anatrace only treats a missing `toolUseId` as `dispatch-link-missing` on CC
   `> 2.1.90`). The version floor cannot catch this class; structural signals must:
   - the unknown-command-key **canary** (a shell tool whose input shape we can't read → `unverifiable`),
   - the **feeder** extraction-honesty diagnostics (a recognized-but-unextracted obligation), and
   - **`parseHealth`** (below).

3. **`parseHealth` → `session-parse-suspect`.** `parseHealth` is pinned on the session at parse time;
   the gating signal is `inputNonEmpty && structuredEventCount === 0` (a **non-empty** transcript that
   parsed to **zero** structured events — a likely within-range misparse). `tokenTotalSuspect` is a
   **non-gating** breadcrumb only: a cumulative-token-fold regression is not event loss (the timeline
   can be fully present while token totals don't fold monotonically), so it must not abstain an
   absence verdict — only zero structured events does. When the gating signal
   trips, the **shared absence gate** resolves absence-based (forbidden/negative) verdicts to
   `unverifiable(session-parse-suspect)` — **never `satisfied`** — so a renamed event type can't make a
   `not_contains "git push --force"` check read "no events" as "compliant." A legitimately short but
   healthy session (≥1 event) does **not** trip it (no over-abstain).

## Known limitation (honestly stated)

A within-range rename of a *structured event type* (e.g. `tool_use` → `tool_call`) that the parser
silently skips is caught by `parseHealth` **only via the zero-events / token-monotonicity heuristics**
— anatrace does not yet name the specific drifted field. A richer "recognized-but-empty session"
diagnostic (which field changed) is a tracked follow-on. What is guaranteed today: such a drift
**never yields a false PASS** on a forbidden check — it degrades to `unverifiable`.

## Reason-enum reference (the typed `unverifiable` vocabulary)

`harness-version-unrecognized` and `session-parse-suspect` join the closed `VerdictReason` set
alongside `runtime-scoped`, `codex-blind`, `absent-signal`, `delegate-coverage-incomplete`,
`channel-coverage-incomplete`, and the rest. All are **non-gating**: an `unverifiable` verdict never
fails a CI gate — only `violated` does.

## Codex storage layout (discovery)

A Codex delegate/subagent session is **not** a Claude-style `subagents/agent-*.jsonl` child. It is a
**separate `rollout-*.jsonl`** written into the same `~/.codex/sessions/YYYY/MM/DD/` date directory,
linked to its parent by `session_meta.parent_thread_id` (and `source.subagent.thread_spawn.parent_thread_id`):

```
~/.codex/sessions/2026/06/13/
  rollout-…-<parent-id>.jsonl     # session_meta.id = <parent-id>
  rollout-…-<child-id>.jsonl      # session_meta.parent_thread_id = <parent-id>
```

Discovery gathers the parent rollout **plus every sibling `rollout-*.jsonl` in that date directory**
as candidate children. The core reachability engine then filters them by `parent_thread_id` chaining,
so unrelated same-day sessions are ignored and only true descendants are parsed as delegate lanes.
(Previously discovery passed only the single parent blob, so the Codex reachability engine never ran
on real input — the lineage twin of the `cmd`-key bug.) A child written into the *next day's* dir
after a midnight spawn is a known, rare gap.

## Two corpora (honest provenance)

The committed `fixtures/real/<harness>@<version>/` corpus is **real-FORMAT / synthetic-CONTENT**: the
wire shape (keys, event types, version strings) is transcribed verbatim from real transcripts, but the
VALUES (commands, paths, conversation) are safe placeholders. It is the regression guard against the
KNOWN format — the class of the `cmd`-key bug — and is safe on a public repo. It is **not** full
ground truth.

The deeper check is the **gitignored** `fixtures/real-local/` corpus (`pin-fixture.ts`): real,
scrubbed transcripts that `p07-real-conformance.test.ts` reads when present and skips otherwise. It is
the periodic check against UNKNOWN drift and is **never pushed** — `scrub` only removes
paths/emails/keys, not conversation or code, so real transcripts cannot go to a public repo.

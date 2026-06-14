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

3. **`parseHealth` → `session-parse-suspect`.** Pinned on the session at parse time:
   `tokenTotalSuspect` (cumulative-token monotonicity broke) and `structuredEventCount` /
   `inputNonEmpty` (a **non-empty** transcript that parsed to **zero** structured events). When either
   trips, **absence-based (forbidden/negative) verdicts resolve `unverifiable(session-parse-suspect)`,
   never `satisfied`** — closing the cardinal-sin path where a renamed event type makes a
   `not_contains "git push --force"` check read "no events" as "compliant." *(The gating itself is
   wired in the absence gate; `parseHealth` is the signal it consumes.)*

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

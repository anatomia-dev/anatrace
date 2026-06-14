---
"anatrace-core": minor
---

Close the cardinal-sin absence path: the shared absence gate (Phase 0 P0.8).

A within-range misparse (a renamed event type the parser silently skips) yields a non-empty
transcript that parses to ZERO structured events. Before this, a forbidden-command
`not_contains "git push --force"` over such a session found no command events → `satisfied`: a FALSE
PASS on a forbidden check. Now:

- One shared `absenceGate()` runs at BOTH absence sites — the per-claim post-result gate
  (`resultProvesAbsence`) AND the file-scope batch — so neither can read "no events" as "compliant".
- It EMITS `session-parse-suspect` when `parseHealth` is suspect (`inputNonEmpty && structuredEventCount === 0`).
  Deliberately NOT gated on `tokenTotalSuspect` (it flips on the intentional multi-file Codex child-usage
  exclusion → would mass-abstain every multi-file Codex session). A healthy short session never trips it.
- `codex.ts` no longer raises `tokenTotalSuspect` on that child-usage exclusion (it is reserved for a
  real cumulative-token regression).
- `LineageGapReason`: trimmed 4 declared-but-never-emitted members (`unknown-delegation-channel`,
  `observed-unexpected-delegate`, `schema-unknown`, `negative-proof-not-available`); WIRED
  `launch-record-expected-but-unobserved` (a SubagentStart launch record with no observed delegate);
  ADDED + wired `duplicate-child-session-id` (a colliding Codex `session_meta.id` the reachability dedup
  would otherwise drop silently).

Property tests prove the closure (misparse → `unverifiable(session-parse-suspect)`) and the no-over-abstain
guard; both new lineage reasons have reachability tests. Also scrubs a real `/Users/<user>` path from
already-merged test sources (public repo). core tests green.

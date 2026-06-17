# anatrace-core

## 0.5.0

### Minor Changes

- 79bca5a: Additive public surface for downstream session-analytics consumers. The deterministic verdict layer and the `--json` envelope are untouched; every change below is a new or re-exported pure projection of the parsed timeline (deterministic, no clock/fs, no verdict, no author/identity or score field).

  - **Re-export the per-session meta-facts feeders.** `buildSessionMeta` (value) plus the fact types `SessionMetaFacts`, `CompactionBoundary`, `CompactionFacts`, `ContextFacts`, `EnvironmentFacts`, `FlowFacts`, `ScopeShapeFacts`, `GitOpsSummary`, `GitOpCounts`. The computation already shipped on `Report.session`; this makes the direct feeders pinnable instead of reachable only transitively.
  - **Re-export the context-window calibration table.** `CONTEXT_LIMITS`, `CONTEXT_LIMITS_VERSION`, `contextLimitFor`, `ContextLimitEntry` — the same data category as the already-public `PRICES`, versioned so a consumer's context receipt cannot silently drift when the table moves.
  - **New `gitOpsTimeline(events) → GitOpEvent[]`.** The positioned mutating-git-op stream — `subcommand`, quote-aware `argv` (exposes `--allow-empty`/`--amend`/`--force`/a branch name), a `forcePush` convenience, and `lineIndex`/`ts`/`agent`/`blobName`. It and the existing `GitOpsSummary` aggregate now share the verdict path's **quote-aware** segmentation, so a `git` token inside quoted data (`echo "…; git push …"`) is never a phantom op, and a newline-separated multi-command script counts every real op. (This makes the aggregate `GitOpsSummary` counts more accurate on multi-line scripts — a values change, not a shape change.)
  - **New `runnerOutcomes(events) → RunnerOutcome[]`.** Structured test outcomes (`pass`/`fail`/`unknown`) for the two runner shapes a real transcript unambiguously emits — vitest/jest (the `Test Files`/`Tests` block) and the ana-internal `(verdict: …)` line. Three honesty properties: it is restricted to shell-command-tool results (`forTool ∈ {Bash, exec_command}`) so a non-runner result echoing "N passed" is never counted; it classifies ONLY on a runner-specific banner (a bare "N passed", a `… in <n>s` timing line, or a `test result:` line is deliberately not classified — those are not runner-specific, so pytest/cargo/go are a documented blind spot rather than a false-PASS vector); and ANSI/CSI escapes are stripped before matching so a colored failure token can't hide. It abstains with `unknown` when a vitest banner is present but the outcome is unreadable (truncated output) rather than guessing a pass.

  No existing export changed; the public-API snapshot grows only by the names above. Full reference,
  including the honesty floor and the known blind spots:
  [`docs/reference/session-facts.md`](https://github.com/anatomia-dev/anatrace/blob/main/docs/reference/session-facts.md).

## 0.4.0

### Minor Changes

- e95c565: 0a — quote-aware three-tier command matcher; fix the non-executed-position false-VIOLATE; add the frozen `command-unresolvable` reason.

  The forbidden-command check (`command-content`) matched a needle with a literal `.includes` over the whole command string, so a needle in a NON-EXECUTED position false-VIOLATEd: `echo "git push --force"` and `git commit -m "git push --force"` _mention_ the forbidden command without running it, yet resolved `violated`. On a verifier a false-VIOLATE is thesis-breaking, exactly like a false-PASS.

  The new matcher (`command-match.ts`) resolves the EXECUTED command surface, quote-aware, into three tiers:

  - **match → `violated`** — the needle IS the executed command. Force variants STAY violated (`git push --force-with-lease` rewrites the branch); a `git` global flag (`git -c core.pager=cat push --force`) no longer hides the subcommand (a latent false-negative the old `.includes` also missed).
  - **no-match → `satisfied`** — the needle provably never executed (a data-program arg, a commit-message value, a comment, an unrelated token).
  - **unresolvable → `unverifiable(command-unresolvable)`** — a NEW member of the frozen `VerdictReason` enum (carries the snapshot + reachability lock). Emitted when obfuscation defeats a static surface: `eval`, `$(…)`/backticks, a `$VAR` that could expand to the needle, a pipe into a shell interpreter, a heredoc/here-string fed to one, an unbalanced quote, or a quoted command handed to a wrapper (`xargs sh -c "…"`, `parallel -m "…"`).

  **The load-bearing invariant** (acceptance test in `command-match.test.ts`'s `INVARIANT` block): a surface-extraction or quoting ambiguity may only ever resolve to `match` or `unresolvable`, **never** `no-match` — a mis-judged executed command must never read clean. Validated test-first against an adversarial conformance corpus (nested/escaped quotes, `--flag=value`, heredocs, line continuations, redirections, message-flag-vs-command-runner, wrapper indirection) and hardened by three independent adversarial review rounds that each surfaced and closed a false-`no-match` (message-flag value-drop, its quoted sibling, mid-command redirection injection). (A pre-publish review later found one more — an ANSI-C `$'...'` off-by-one — fixed in the same 0.4.0 release; see the `command-match-ansi-c-false-pass` changeset.)

  `command-unresolvable` surfaces per-claim in the coverage receipt and the `--json` `compliance` array, so the abstention is reported, never a silent sink. Doc: `docs/the-unverifiable-taxonomy.md`.

- 58a6a74: N1b — the `never_edit` policy verb + the test-edit hero.

  Adds `never_edit: <path-substring>` to the generic `.anatrace.yaml` policy — the blacklist sibling of `only_edit`. It compiles to a `file-scope` / `edit-paths` / `not_contains` claim and routes through the existing `evalForbiddenEdit` blacklist evaluator: any edit whose normalized path contains the forbidden substring → `violated` with a pointer to the edit event; none → `satisfied`. This makes the headline check expressible — _"the agent edited a file under `test/` it was obligated not to"_ — the conduct a diff-reviewer structurally cannot see (a test-edit-to-pass and a legitimate fix can produce identical diffs; only the transcript distinguishes them).

  `never_edit` is a path **substring** match (use `test/` with the trailing slash for "under test/"), consistent with the other path verbs; a glob form is future work.

  Ships the curated-gappy hero fixture (`packages/cli/test/fixtures/hero/`): one session that BOTH games a test (caught as `violated`) AND carries a genuine `unverifiable` — a delegate-inclusive secret-read obligation anatrace can't prove because the spawned sub-agent's transcript was never captured (the lineage gap `delegate-call-without-child-transcript`). The catch and the honest abstention, side by side, plus a replayable `anatrace.cast` (asciinema v2) that leads with the verdict.

- b2718fb: N3 — coverage gaps → remediation (the capture loop's step 1).

  Each typed abstention now names the precise CAPTURE ACTION that would let anatrace answer next time. New `captureActionsFor(report)` / `remediationFor(source, reason)` (+ `CaptureAction` / `Remediation` / `RemediationKind` types) key a reason→capture table off all three gap vocabularies — the per-claim `VerdictReason`, the `LineageGapReason`, and the `ChannelCoverageGapReason` — each partitioned:

  - **capture-closable** — a child transcript, a trusted-launcher manifest, a subject binding, a window, a classified channel would close it (the rungs of the loop; supply them and coverage climbs).
  - **intrinsic floor** — the honest irreducible: no capture closes it (`routed-to-llm`, `runtime-scoped`, `codex-blind`, `command-unresolvable`, degraded parse, unrecognized version). Naming the floor stops the loop reading as "tops out".

  The table is exhaustive by construction (a total `Record` over each enum, so a new reason cannot ship without its remediation — a compile error otherwise). The CLI surfaces it with `--gaps`, capture-closable rungs first, then the intrinsic floor. The cross-run coverage series is a later phase; this ships step 1. Doc: `docs/coverage-and-soundness.md`.

- 2370732: N4 — schema-locked portable record + the dossier demotion (Tier-3).

  **Dossier demotion (breaking — pre-1.0 → minor).** The LLM-judge input — the said-vs-did `dossier` and the `hookRequests` residue manifest — is removed from the **public surface AND the `--json` envelope**. It is an LLM-judge-shaped artifact with no place on a deterministic, zero-LLM-in-the-published-verdict-path API. Removed exports: `buildDossier`, `DOSSIER_SCHEMA_VERSION`, `EVIDENCE_CAP`, `Dossier`, `DossierClaim`, `DossierClaimSlice`, `buildHookRequests`, `HookRequest`; `Report.dossier`/`Report.hookRequests` dropped. **The capability is untouched:** `runCompliance` still builds both internally (the quarantined `Config.judge`/`adjudicate` seam, a config-flip away) — they are simply no longer attached to `Report`. Zero-LLM in the published verdict path is now a **surface** property, not just a runtime one.

  **Schema-locked record.** A committed `report.schema.json` (draft-07) freezes the `--json` envelope; anatrace **validates its own output against it in CI**. The top level and the `ComplianceVerdict` are strict (`additionalProperties: false`): the verdict structurally cannot carry `rationale`/`severity`/`model` (the bright line), and the demoted dossier/hookRequests can never reappear (the demotion lock). The schema's verdict-reason enum is held in lockstep with the frozen `VerdictReason` set.

  **Wording sweep.** Genuinely-bare no-LLM user-facing claims tightened to "zero-LLM in the published verdict path"; a precise **grep-guard CI test** (forbidding absolute no-LLM-everywhere assertions, requiring every zero-LLM mention to be scoped) makes the sweep mechanical and forward-covers the essay. Docs: `docs/reference/coverage-record.md`.

### Patch Changes

- 1e5cdda: Fix a false-PASS in the command matcher's ANSI-C `$'...'` quote handling (pre-publish blocker). The branch advanced the cursor by two past the closing quote instead of one, swallowing the character after it — so `git $'push' --force origin main` (which bash executes as a real force-push) mis-read as `git push--force` and the forbidden-command needle no longer matched, resolving `satisfied`. A genuinely-executed forbidden command read clean — the exact false-PASS the verifier exists to prevent. Fixed to advance by one (matching the plain single-quote branch), pinned by new conformance + INVARIANT fixtures (`git $'push' --force …` → `violated`; `git push $'--force'` → `violated`), and re-verified end-to-end on the built CLI (force variants still `violated`, a non-executed needle still `satisfied`).
- 87d2113: SARIF results now always carry a `location` (N7). GitHub code-scanning requires every result to have at least one location; a conduct verdict isn't always tied to a repo line, so `toSarif` falls back to the obligation's source (the policy/mandate path the CLI supplies) when no file location is known, and uses the real file location whenever it is. This makes the violated-only SARIF ingestible by code-scanning (the anatrace Action uploads it). Additive `fallbackUri` parameter on `toSarif`.
- fbe7fcc: Step 0 correctness gates (Phase 1: make the inch a foot) — pin two untested false-PASS guards, close the price-value CI hole, and document the CI exit-code contract. No verdict-behavior change.

  - **0d — `expandDelegates` false-PASS arms pinned.** The cycle (`verdict.ts:165-168`) and duplicate-lane (`:156-157,162`) completeness guards were the only untested false-PASS-preventing arms in the verdict layer. Added differential tests (against `completeCoverage()`, which proves the negative `satisfied`) so a cyclic or duplicate-lane trusted-launcher manifest flips a proves-absence claim to `unverifiable(delegate-coverage-incomplete)`. Mutation-verified: neutering either guard fails exactly its test; a positive delegate sighting still proves `violated` (a violation needs no manifest). Test-only — the arms already behaved correctly.

  - **0c — price / context-limit bump-gate.** Nothing pinned the `PRICES` / `CONTEXT_LIMITS` _values_, so a silent rate drift (the class the gpt-5.5 4× error was) would slip CI. Added a `version ⟺ rate-digest` gate over both tables: a value change without a version-stamp move now fails CI. Mutation-verified on both tables. Promoted the gpt-5.5 source-URL + verified-date from a comment to optional `PriceEntry.source` / `PriceEntry.asOf` data fields (additive, non-breaking — existing consumers compile unchanged). `CONTEXT_LIMITS_VERSION` (`2026-06-11`) is deliberately left independent of `PRICE_TABLE_VERSION` (`2026-06-14`): the limit data is genuinely unchanged since 06-11, so the older stamp is honest — force-aligning it would claim a re-verification that never happened.

  - **0b — CI exit-code contract documented.** The shipped contract — `--ci` fails the build only on `violated`; `unverifiable` maps to `info` and never gates — was code-only (`sarif.ts:100`) and already test-pinned (`d-config.test.ts:126-131`, `gate.test.ts:91`). Stated it for consumers in the README, including why it does not contradict the verdict surface refusing to report "all clear" under `unverifiable > 0` (honesty of the verdict vs blocking on a proven violation are different axes).

## 0.3.0

### Minor Changes

- 1705d76: Pre-publish fixes for 0.3.0: close the version-floor batch bypass + correct GPT-5.5 pricing.

  - 🔴 **Blocker — version floor bypassed on the file-scope batch path.** `harnessVersionStatus` ran
    only inside `verdictForClaim`; the file-scope batch branch (edit-paths/read-paths whitelist) applied
    the absence gate and `continue`d, skipping the floor. Over a whole-major-drifted (out-of-range)
    transcript a file-scope claim returned a CONFIDENT `satisfied`/`violated` (false-PASS / false-accuse,
    reachable via `anatrace --mandate … --ci`) while `--last` printed "unverifiable". Fixed: the batch
    path now applies the same out-of-range guard first. Proven by a binary-level gate test (verified by
    reproducing the confident verdict with the guard removed, then the flip to unverifiable).
  - 🟠 **GPT-5.5 price row was ~4× low.** Was 1.25/10/0.125; actual standard tier is $5.00 in / $0.50
    cached / $30.00 out per 1M (verified 2026-06-14 against developers.openai.com/api/docs/pricing).
    `PRICE_TABLE_VERSION` bumped to 2026-06-14.
  - Tests: the file-scope batch absence gate and the tokenTotalSuspect-non-gating decision now have
    coverage (both were untestable-green before). Hardened the API export-snapshot extractor to also
    catch `export const/function/class` and `export *` (was brace-only). Corrected a stale
    `tokenTotalSuspect` comment (it no longer flips on the multi-file Codex child-usage exclusion
    post-#23 — a token-fold break is not event loss). Rewrote the CONTRIBUTING intro (the engine ships).

- 3cecc90: Fix two shipped false-PASS-class defects in the verdict layer (Phase 0 P0.2).

  **`evalFileContent` negative branch was byte-identical to the positive branch.** `not_contains "x"`
  on a file that DOES contain `x` returned `satisfied` instead of `violated`. The matcher matrix never
  exercised the file-content arm, so the bug shipped. The negative branch now maps a match on the
  forbidden content to `violated` (mirroring `evalReadPaths`).

  **`commandStringOf` read only `input.command`, but real Codex `exec_command` carries the command
  under `cmd`** (verified: 4788/4789 real `cli_version` 0.135+ events). Forbidden/force-push checks
  were therefore DEAD on real Codex input — returning an affirmative `satisfied` on a real force-push.
  The extractor now reads `command` then `cmd`, joining an argv array, with an unknown-key **canary**
  (`isUnreadableCommandEvent`): a command tool whose input shape we can't read degrades the
  forbidden-command direction to `unverifiable`, never a false-clean.

  Both defects are pinned by a new `{arm}×{matcher}×{present/absent}` table test over real-shaped
  bytes, and a previously-toothless Codex test (fabricated key, `if (s)` soft-skip, verdict-permissive
  assertion) is tightened to the real `cmd` key with a strict `violated` assertion. A shared `negate()`
  helper centralizes the pinned negative-matcher mapping across all forbidden-direction arms so an arm
  can never re-derive it backwards again. No public-API change; verdict behavior is strictly more
  correct (no new `satisfied`, several previously-false `satisfied` now `violated`/`unverifiable`).

- 444964e: Feeders fail loud (Phase 0 P0.3) — silent under-extraction becomes a visible, typed gap.

  Mandate extraction is structural regex over one framework's shapes; on drift it yielded fewer
  claims with no signal, so the coverage stat over-claimed by omission. This adds a deterministic,
  bounded extraction-honesty layer:

  - New `ExtractionDiagnostic` (on `Mandate.diagnostics`, additive — OMITTED when empty, so clean
    output and the golden corpus are byte-identical). Two kinds: `unextracted-marker` (a recognized
    obligation marker that produced no claim) and `recognized-but-empty` (framework detected, zero
    claims extractable).
  - The anatomia adapter now flags: a drifted `ana-verify` whose build-report independence rule no
    longer matches (`verify-independence`), a `skills:` frontmatter key present but not parsed as an
    inline list (`skills-frontmatter`), and a detected-but-empty agent-def (closing the
    "dangerous middle" F4 gap). The superpowers adapter flags an `Iron Law` it triggers on but cannot
    mechanically extract (`iron-law`).
  - The CLI surfaces gaps: `mandate show` prints an "⚠ extraction gaps" section; a recognized-but-empty
    source now reports the gap loudly instead of a bare "extracted no claims."
  - The honest coverage line is relabeled: "X of Y **declared** obligations" → "X of the Y obligations
    it **could structurally recognize**" — the prior wording implied Y was the complete obligation
    surface. The coverage DENOMINATOR is unchanged (= extracted claims); we deliberately do NOT inject
    an unrecognized-prose count (circular, non-deterministic, and over-claiming — the exact failure the
    brand exists to prevent). Recall is an out-of-band benchmark, not a per-run number.

  `mandate.schema.json` gains the additive optional `diagnostics` property + `ExtractionDiagnostic`
  definition.

- b06a985: Cleanup sweep + the package-boundary lock (Phase 0 P0.4/P0.9, final Phase-0 step).

  De-export sweep (pre-1.0 surface reduction; no known consumer imported these):

  - Removed `matchAnnouncedSkills`, `buildZeroMandateWedge`, `parseSemver` from the public API
    (internal-only; callers use direct imports). Dropped the dead `_sourceKey` param from
    `fileScopeVerdict`'s exported signature.

  Dedup + single-source:

  - Collapsed the 6× AgentRef-identity duplication into canonical `agentKey` / `sameAgentRef` /
    `uniqueAgents` (order-preserving) + `uniqueAgentsSorted` (lineage/coverage) on `session.ts`. (The
    two `uniqueAgents` variants genuinely differ — order-preserving vs sorted — so they stay as two.)
  - FI-17 matcher totality now flows from one `COMPARABLE_MATCHERS` source (`isComparableMatcher` +
    `evalMessageText`), pinned by a value-lock test.

  The lock (`p04-public-api-lock.test.ts`):

  - Export snapshot freezes the public `index.ts` surface (180 identifiers) — add/remove now requires a
    deliberate change + changeset.
  - `VerdictReason` (14) and `LineageGapReason` (11) string sets are value-locked, and every member is
    asserted REACHABLE (a live emitter, not declaration-only) so none can freeze dead.

  Deferred (noted, non-blocking): migrating the layout-obsolete `codex-subagent-storage` corpus fixture
  (CC-style `subagents/` storage) to the real Codex `rollout-*` layout — needs a corpus-loader change +
  test updates; discovery (the layout-sensitive path) is already covered by the Step-6 real-layout test.

  Additional de-exports before the freeze (zero consumers verified across core/CLI/action/anatomia):

  - QUARANTINED the LLM-judge cluster off the public zero-LLM surface: `adjudicate` + `JudgeFn` /
    `JudgeInput` / `JudgeOutput` / `JudgeVerdict` / `JudgeBudget`. The deterministic
    `buildHookRequests` / `HookRequest` residue stays public; `Config.judge` remains an internal
    (bundled, non-exported) injection seam — there is no public entrypoint that can call an LLM.
  - Removed dead public symbols `getRule`, `allRules`, `unknownComplianceKeys`.

  The frozen export snapshot is now 171 identifiers (`test/fixtures/public-api.snapshot`).

- 062e8c8: Wire the observed harness version into a fail-loud signal + stop the CC `toolUseId`-drift false gap
  (Phase 0 P0.6).

  `observedVersions` was captured but read by zero decision paths, and the delegate-lineage code
  emitted a spurious `dispatch-link-missing` on real CC ≤2.1.90 sessions (the `toolUseId` sidecar field
  did not exist yet — 157/200 real files lack it). This adds two honest, non-trust layers:

  - **Catastrophic version floor** (`harness-support.ts`, one editable table): a parseable version whose
    MAJOR is outside the supported range (CC `2.x`, Codex `0.x`) gates every transcript-scoped claim to
    `unverifiable(harness-version-unrecognized)`. Never false-fires on current 2.1.x / 0.13x sessions;
    an absent version is a breadcrumb, not a gate.
  - **`parseHealth` on `NormalizedSession`** (`{ tokenTotalSuspect, structuredEventCount, inputNonEmpty }`),
    captured SYNCHRONOUSLY at parse time (never read from the adapter's mutable `capabilities` singleton
    later — a latent race). This is the signal the Step-8 absence gate consumes to stop a within-range
    misparse (zero events) from reading "absence" as "compliance" on a forbidden check.
  - The CC `toolUseId` guard: a missing `toolUseId` is only a `dispatch-link-missing` on CC `> 2.1.90`.

  New `VerdictReason` members: `harness-version-unrecognized` (emitted now, by the verdict pre-check)
  and `session-parse-suspect` (emitted by the Step-8 absence gate — landing here so both are in the set
  before the Step-9 enum lock). The `--last` breadcrumb surfaces unrecognized/suspect signals.

- 5817114: Close the cardinal-sin absence path: the shared absence gate (Phase 0 P0.8).

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

- 82cab71: Un-export the person-read meta-fact feeders from core's public API (Phase 0 P0.0).

  `buildSessionMeta`, `gitOpsOf`, `contextLimitFor`, `CONTEXT_LIMITS` / `CONTEXT_LIMITS_VERSION`
  and their named fact types (`SessionMetaFacts`, `GitOpsSummary`, `ContextLimitEntry`, …) are no
  longer part of `anatrace-core`'s public surface. They feed a separate person-analytics aggregator
  ("Cracked"), which is at odds with the zero-LLM verdict positioning and only enlarges the surface
  to freeze at the API-lock. No known consumer (the CLI, anatomia) imported them.

  The computation is unchanged — `analyze()` still attaches the additive optional meta blocks to
  `Report.session`, so the fact types remain reachable transitively through the public `Report`.
  `meta/lane.ts` (verdict spine — `verdict.ts` imports `laneCapture`/`isGradeableCapture`) is
  untouched and stays public. Technically a public-API removal, but pre-1.0 and consumer-free.

### Patch Changes

- 0e28c1e: Honesty-floor pass + release discipline (Phase 0 P0.5 — the final prep before 0.2.1).

  Docs (no claim the code doesn't honor):

  - README: make the **zero-LLM public surface** claim explicit (the judge cluster is now quarantined);
    "exemplar-validated" → a dated "recall benchmark in progress (as of 2026-06), not a published number";
    the `anatrace-action` entry is now honest ("reserved slot; not yet functional and not published — do
    not depend on it"; the CLI gates CI today). Dropped a user-facing "Phase 2" milestone label.
  - `anatrace-action` placeholder string no longer leaks an internal milestone code.

  Release discipline:

  - CI now enforces **no package/public-API change without a changeset** (`changeset status` on every PR);
    combined with the export-snapshot + reason value-locks, an unintended surface change fails loudly.
  - Documented **independent versioning** (`fixed: []`) in CONTRIBUTING.

  Test hygiene (folded-in follow-ups):

  - Migrated the layout-obsolete `codex-subagent-storage` corpus fixture to the real Codex `children/rollout-*`
    layout (the corpus loader now reads codex children as separate rollout files, mirroring reality).
  - Added CLI render coverage for the P0.6 honesty breadcrumb (version-unrecognized / parse-suspect).

  No public-API or verdict-behavior change in this PR — docs, tests, CI, and a fixture move only.

- 30a7811: Version-stamped conformance over real-FORMAT fixtures + the pin-fixture helper (Phase 0 P0.7).

  Adds `fixtures/real/<harness>@<version>/` — committed real-FORMAT / synthetic-CONTENT skeletons (wire
  shape transcribed verbatim from real transcripts; values are safe placeholders), including the real
  Codex `cmd`-key force-push fixture that proves Step 3's headline exit criterion (`violated` on a real
  `cmd` key). `p07-real-conformance.test.ts` asserts every fixture parses to a non-trivial,
  version-RECOGNIZED, parse-HEALTHY session.

  Adds a gitignored `fixtures/real-local/` corpus (true ground truth, scrubbed) that the conformance
  test reads when present and skips otherwise — never committed, because the repo is public and `scrub`
  only removes paths/emails/keys, not conversation/code. `scripts/pin-fixture.ts` (reusing
  discover + scrub + observedVersions) captures a real transcript into that local corpus, so adding a
  new harness version is a one-command change. Ships `docs/maintenance.md` (how to pin) and the
  harness-coverage-matrix two-corpora note. This corpus gates the Step-8 soundness property tests.

## 0.2.0

### Minor Changes

- Add Phase 2 delegation lineage and coverage-scoped absence.

  - Project deterministic lineage from captured Claude/Codex transcripts, sidecars, hooks, and Codex subagent storage evidence.
  - Add closed lineage gap reasons and checked-lane coverage so delegate-inclusive negatives only pass over complete evidence.
  - Parse captured delegate transcript lanes and attribute delegate evidence to stable `AgentRef` identities.
  - Add `CaptureCoverage.completeness`, `ExpectedLaunchBoundary`, and `coverageFromExpectedLaunchBoundary`.
  - Preserve the dominance rule: observed delegate violations remain `violated` even when coverage is incomplete.
  - Keep clean delegate-inclusive absence `unverifiable: delegate-coverage-incomplete` when lineage or capture coverage is incomplete.

## 0.1.0

### Minor Changes

- Publish the first functional anatrace engine and CLI.

  - Parse Claude Code and Codex transcripts into one normalized session model.
  - Load generic `.anatrace.yaml` policies with explicit agent, role, session, and delegate subjects.
  - Emit deterministic `satisfied`, `violated`, or `unverifiable` verdicts with closed reasons and pointer evidence.
  - Detect structured and shell-based filesystem reads, coarse network egress, forbidden commands, and edit-scope violations.
  - Fail loud when a relevant tool or shell channel cannot be classified.
  - Include claim-level verification coverage in JSON, human-readable, dossier, and SARIF output.
  - Preserve the pure-core boundary: no filesystem, network, clock, randomness, or LLM in `anatrace-core`.

# anatrace-core

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

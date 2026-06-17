# anatrace

## 0.4.1

### Patch Changes

- Updated dependencies [79bca5a]
  - anatrace-core@0.5.0

## 0.4.0

### Minor Changes

- ee37718: N1a — invert the front door: `anatrace --last` now LEADS with the verdict.

  `report.compliance` was computed but never rendered — the brand was invisible in the brand's own output. The pretty renderer now leads with a verdict headline and demotes cost/tokens/friction to a ride-along footer.

  - **Verdict headline, worst-wins** (`VIOLATED > UNVERIFIABLE > SATISFIED`). It structurally refuses to go green whenever `violated > 0`, `unverifiable > 0`, or a degradation signal fires. `violated` (blocks CI) and `unverifiable` (never gates) stay visibly distinct — never collapsed into one scary state.
  - **"No mandate" ≠ "all clear"** — a bare run with nothing to verify says so explicitly, and a **degraded bare run refuses green on its own**: a parse-suspect / unrecognized-harness-version / lineage-gapped transcript leads with `⚠ DEGRADED EVIDENCE` even with no mandate, so a degraded session can never read as a clean "analyzed."
  - **Aggregation** — friction collapses to `ruleId×N` counts (was ~14 near-identical lines); the per-claim coverage gap-wall (an ~11k-char comma-joined line) collapses to the by-reason ledger `N unverifiable: <reason>`.
  - **Footer** — humanized tokens (`36.0M total`) and 2dp cost (4dp under $0.01 so two cheap-but-distinct sessions still differ). No numeric score, no color-only signal.
  - The CLI `--help` tagline drops the commodity "(provenance + cost + friction)" framing for the verdict/honesty lead + the zero-instrumentation substrate line.

  README hero inverted to match (problem → refusal thesis → the 10-second `--last` verdict → cost/friction as footer). The `never_edit` test-edit hero detector and the recorded asciinema ride in the follow-up (N1b).

### Patch Changes

- Updated dependencies [e95c565]
- Updated dependencies [1e5cdda]
- Updated dependencies [58a6a74]
- Updated dependencies [b2718fb]
- Updated dependencies [2370732]
- Updated dependencies [87d2113]
- Updated dependencies [fbe7fcc]
  - anatrace-core@0.4.0

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

- ee2db6b: Codex multi-file tree discovery (Phase 0 P0.9).

  Real Codex stores a delegate session as a SEPARATE `rollout-*.jsonl` in the same date directory,
  linked by `session_meta.parent_thread_id` — not as a Claude-style `subagents/agent-*.jsonl` child.
  `buildCodexGroup` passed core only the single parent rollout, so the Codex reachability/lineage
  engine NEVER ran on real input (the lineage twin of the `cmd`-key bug). Discovery now gathers the
  parent + every sibling `rollout-*.jsonl` in the date dir as candidate children; the core reachability
  engine filters them by `parent_thread_id` chaining, so unrelated same-day sessions are dropped and
  only true descendants are parsed as delegate lanes. Proven with a real date-dir/`rollout-*` layout
  fixture (`discover-codex.test.ts`): the child surfaces as an observed delegate, a stranger does not.

- Updated dependencies [1705d76]
- Updated dependencies [3cecc90]
- Updated dependencies [444964e]
- Updated dependencies [b06a985]
- Updated dependencies [0e28c1e]
- Updated dependencies [062e8c8]
- Updated dependencies [30a7811]
- Updated dependencies [5817114]
- Updated dependencies [82cab71]
  - anatrace-core@0.3.0

## 0.2.0

### Minor Changes

- Add Phase 2 delegation lineage and coverage-scoped absence.

  - Add `--lineage-hooks` for Claude/Codex subagent lifecycle hook capture.
  - Report checked root/delegate lanes and closed lineage gaps in CLI output.
  - Accept raw trusted launcher `expected-launch-boundary` manifests through `--capture-manifest`.
  - Reconcile expected launcher intent with observed checked lineage before verdict evaluation.
  - Fail loud on malformed or ambiguous capture manifest identities and unknown manifest kinds.

### Patch Changes

- Updated dependencies
  - anatrace-core@0.2.0

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

### Patch Changes

- Updated dependencies
  - anatrace-core@0.1.0

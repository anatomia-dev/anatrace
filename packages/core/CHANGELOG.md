# anatrace-core

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

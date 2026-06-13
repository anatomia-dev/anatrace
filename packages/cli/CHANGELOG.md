# anatrace

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

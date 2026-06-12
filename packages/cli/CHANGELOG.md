# anatrace

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

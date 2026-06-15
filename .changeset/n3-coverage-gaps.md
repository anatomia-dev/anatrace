---
"anatrace-core": minor
---

N3 — coverage gaps → remediation (the capture loop's step 1).

Each typed abstention now names the precise CAPTURE ACTION that would let anatrace answer next time. New `captureActionsFor(report)` / `remediationFor(source, reason)` (+ `CaptureAction` / `Remediation` / `RemediationKind` types) key a reason→capture table off all three gap vocabularies — the per-claim `VerdictReason`, the `LineageGapReason`, and the `ChannelCoverageGapReason` — each partitioned:

- **capture-closable** — a child transcript, a trusted-launcher manifest, a subject binding, a window, a classified channel would close it (the rungs of the loop; supply them and coverage climbs).
- **intrinsic floor** — the honest irreducible: no capture closes it (`routed-to-llm`, `runtime-scoped`, `codex-blind`, `command-unresolvable`, degraded parse, unrecognized version). Naming the floor stops the loop reading as "tops out".

The table is exhaustive by construction (a total `Record` over each enum, so a new reason cannot ship without its remediation — a compile error otherwise). The CLI surfaces it with `--gaps`, capture-closable rungs first, then the intrinsic floor. The cross-run coverage series is a later phase; this ships step 1. Doc: `docs/coverage-and-soundness.md`.

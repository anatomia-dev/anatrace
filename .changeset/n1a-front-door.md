---
"anatrace": minor
---

N1a — invert the front door: `anatrace --last` now LEADS with the verdict.

`report.compliance` was computed but never rendered — the brand was invisible in the brand's own output. The pretty renderer now leads with a verdict headline and demotes cost/tokens/friction to a ride-along footer.

- **Verdict headline, worst-wins** (`VIOLATED > UNVERIFIABLE > SATISFIED`). It structurally refuses to go green whenever `violated > 0`, `unverifiable > 0`, or a degradation signal fires. `violated` (blocks CI) and `unverifiable` (never gates) stay visibly distinct — never collapsed into one scary state.
- **"No mandate" ≠ "all clear"** — a bare run with nothing to verify says so explicitly, and a **degraded bare run refuses green on its own**: a parse-suspect / unrecognized-harness-version / lineage-gapped transcript leads with `⚠ DEGRADED EVIDENCE` even with no mandate, so a degraded session can never read as a clean "analyzed."
- **Aggregation** — friction collapses to `ruleId×N` counts (was ~14 near-identical lines); the per-claim coverage gap-wall (an ~11k-char comma-joined line) collapses to the by-reason ledger `N unverifiable: <reason>`.
- **Footer** — humanized tokens (`36.0M total`) and 2dp cost (4dp under $0.01 so two cheap-but-distinct sessions still differ). No numeric score, no color-only signal.
- The CLI `--help` tagline drops the commodity "(provenance + cost + friction)" framing for the verdict/honesty lead + the zero-instrumentation substrate line.

README hero inverted to match (problem → refusal thesis → the 10-second `--last` verdict → cost/friction as footer). The `never_edit` test-edit hero detector and the recorded asciinema ride in the follow-up (N1b).

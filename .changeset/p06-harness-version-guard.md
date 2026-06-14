---
"anatrace-core": patch
"anatrace": patch
---

Wire the observed harness version into a fail-loud signal + stop the CC `toolUseId`-drift false gap
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

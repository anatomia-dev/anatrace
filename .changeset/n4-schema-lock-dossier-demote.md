---
"anatrace-core": minor
---

N4 — schema-locked portable record + the dossier demotion (Tier-3).

**Dossier demotion (breaking — pre-1.0 → minor).** The LLM-judge input — the said-vs-did `dossier` and the `hookRequests` residue manifest — is removed from the **public surface AND the `--json` envelope**. It is an LLM-judge-shaped artifact with no place on a deterministic, zero-LLM-in-the-published-verdict-path API. Removed exports: `buildDossier`, `DOSSIER_SCHEMA_VERSION`, `EVIDENCE_CAP`, `Dossier`, `DossierClaim`, `DossierClaimSlice`, `buildHookRequests`, `HookRequest`; `Report.dossier`/`Report.hookRequests` dropped. **The capability is untouched:** `runCompliance` still builds both internally (the quarantined `Config.judge`/`adjudicate` seam, a config-flip away) — they are simply no longer attached to `Report`. Zero-LLM in the published verdict path is now a **surface** property, not just a runtime one.

**Schema-locked record.** A committed `report.schema.json` (draft-07) freezes the `--json` envelope; anatrace **validates its own output against it in CI**. The top level and the `ComplianceVerdict` are strict (`additionalProperties: false`): the verdict structurally cannot carry `rationale`/`severity`/`model` (the bright line), and the demoted dossier/hookRequests can never reappear (the demotion lock). The schema's verdict-reason enum is held in lockstep with the frozen `VerdictReason` set.

**Wording sweep.** Genuinely-bare no-LLM user-facing claims tightened to "zero-LLM in the published verdict path"; a precise **grep-guard CI test** (forbidding absolute no-LLM-everywhere assertions, requiring every zero-LLM mention to be scoped) makes the sweep mechanical and forward-covers the essay. Docs: `docs/reference/coverage-record.md`.

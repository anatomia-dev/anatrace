# The coverage record (the `--json` envelope) — schema-locked

`anatrace … --json` emits a portable **coverage record**. Its shape is frozen by a committed JSON
Schema (`packages/core/src/report.schema.json`, draft-07) that anatrace **validates its own output
against in CI** (N4). If the envelope drifts, a verdict grows a forbidden axis, or a demoted field
reappears, the self-validation gate fails.

## Top-level keys

| key | when | notes |
|-----|------|-------|
| `schemaVersion` | always | integer |
| `session` | always | harness · model · sessionId · counts · observedVersions (+ optional meta-facts) |
| `findings` | always | deterministic friction findings |
| `compliance` | with a mandate | the per-claim deterministic verdicts (see below) |
| `verificationCoverage` | with a mandate | the channel-coverage receipt |
| `lineage` | CLI runs | delegation lineage + gaps |
| `cost_estimate` | always | `{ usd, priced, priced_as_of }` — a render projection, never a baked `cost_usd` |
| `skills` | always | render projection |

The top level is **strict** (`additionalProperties: false`): nothing else may appear.

## The verdict — the bright line

Each `compliance[]` entry is a `ComplianceVerdict` whose key set is **frozen** to
`{claimId, status, reason, evidence, source}` (`additionalProperties: false`). This is the
deterministic ⟂ LLM wall as a schema: a verdict structurally **cannot** carry a `rationale`,
`severity`, or `model`. `status ∈ {satisfied, violated, unverifiable}`; `reason` is the closed
`VerdictReason` enum (held in lockstep with the frozen set); `source` is the constant
`"deterministic"`; `evidence` is an array of pointers into the timeline (never copied bytes).

## What is deliberately NOT here

The LLM-judge input — the said-vs-did **dossier** and the **hookRequests** residue manifest — was
**demoted off this envelope** (N4/Tier-3). It is built internally (the quarantined `Config.judge`
seam, a config-flip away) but never attached to the record: zero-LLM in the published verdict path is
a **surface** property, enforced by the schema's `additionalProperties: false`, not just a runtime one.

## Reproducibility (the staple)

Because the verdict path is deterministic and zero-LLM, the record is **re-runnable**: a distruster
re-runs anatrace on the same transcript bytes and gets a byte-identical record. That reproducibility —
not a signature — is what makes the record trustworthy (a signed, timestamped attestation is a later
phase).

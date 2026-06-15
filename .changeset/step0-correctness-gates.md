---
"anatrace-core": patch
---

Step 0 correctness gates (Phase 1: make the inch a foot) — pin two untested false-PASS guards, close the price-value CI hole, and document the CI exit-code contract. No verdict-behavior change.

- **0d — `expandDelegates` false-PASS arms pinned.** The cycle (`verdict.ts:165-168`) and duplicate-lane (`:156-157,162`) completeness guards were the only untested false-PASS-preventing arms in the verdict layer. Added differential tests (against `completeCoverage()`, which proves the negative `satisfied`) so a cyclic or duplicate-lane trusted-launcher manifest flips a proves-absence claim to `unverifiable(delegate-coverage-incomplete)`. Mutation-verified: neutering either guard fails exactly its test; a positive delegate sighting still proves `violated` (a violation needs no manifest). Test-only — the arms already behaved correctly.

- **0c — price / context-limit bump-gate.** Nothing pinned the `PRICES` / `CONTEXT_LIMITS` *values*, so a silent rate drift (the class the gpt-5.5 4× error was) would slip CI. Added a `version ⟺ rate-digest` gate over both tables: a value change without a version-stamp move now fails CI. Mutation-verified on both tables. Promoted the gpt-5.5 source-URL + verified-date from a comment to optional `PriceEntry.source` / `PriceEntry.asOf` data fields (additive, non-breaking — existing consumers compile unchanged). `CONTEXT_LIMITS_VERSION` (`2026-06-11`) is deliberately left independent of `PRICE_TABLE_VERSION` (`2026-06-14`): the limit data is genuinely unchanged since 06-11, so the older stamp is honest — force-aligning it would claim a re-verification that never happened.

- **0b — CI exit-code contract documented.** The shipped contract — `--ci` fails the build only on `violated`; `unverifiable` maps to `info` and never gates — was code-only (`sarif.ts:100`) and already test-pinned (`d-config.test.ts:126-131`, `gate.test.ts:91`). Stated it for consumers in the README, including why it does not contradict the verdict surface refusing to report "all clear" under `unverifiable > 0` (honesty of the verdict vs blocking on a proven violation are different axes).

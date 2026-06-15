---
"anatrace-core": patch
"anatrace": patch
---

Pre-publish fixes for 0.3.0: close the version-floor batch bypass + correct GPT-5.5 pricing.

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

---
"anatrace-core": patch
---

Fix a false-PASS in the command matcher's ANSI-C `$'...'` quote handling (pre-publish blocker). The branch advanced the cursor by two past the closing quote instead of one, swallowing the character after it — so `git $'push' --force origin main` (which bash executes as a real force-push) mis-read as `git push--force` and the forbidden-command needle no longer matched, resolving `satisfied`. A genuinely-executed forbidden command read clean — the exact false-PASS the verifier exists to prevent. Fixed to advance by one (matching the plain single-quote branch), pinned by new conformance + INVARIANT fixtures (`git $'push' --force …` → `violated`; `git push $'--force'` → `violated`), and re-verified end-to-end on the built CLI (force variants still `violated`, a non-executed needle still `satisfied`).

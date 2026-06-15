---
"anatrace-core": minor
---

N1b — the `never_edit` policy verb + the test-edit hero.

Adds `never_edit: <path-substring>` to the generic `.anatrace.yaml` policy — the blacklist sibling of `only_edit`. It compiles to a `file-scope` / `edit-paths` / `not_contains` claim and routes through the existing `evalForbiddenEdit` blacklist evaluator: any edit whose normalized path contains the forbidden substring → `violated` with a pointer to the edit event; none → `satisfied`. This makes the headline check expressible — *"the agent edited a file under `test/` it was obligated not to"* — the conduct a diff-reviewer structurally cannot see (a test-edit-to-pass and a legitimate fix can produce identical diffs; only the transcript distinguishes them).

`never_edit` is a path **substring** match (use `test/` with the trailing slash for "under test/"), consistent with the other path verbs; a glob form is future work.

Ships the curated-gappy hero fixture (`packages/cli/test/fixtures/hero/`): one session that BOTH games a test (caught as `violated`) AND carries a genuine `unverifiable` — a delegate-inclusive secret-read obligation anatrace can't prove because the spawned sub-agent's transcript was never captured (the lineage gap `delegate-call-without-child-transcript`). The catch and the honest abstention, side by side, plus a replayable `anatrace.cast` (asciinema v2) that leads with the verdict.

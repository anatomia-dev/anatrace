---
"anatrace-core": patch
"anatrace": patch
---

Version-stamped conformance over real-FORMAT fixtures + the pin-fixture helper (Phase 0 P0.7).

Adds `fixtures/real/<harness>@<version>/` — committed real-FORMAT / synthetic-CONTENT skeletons (wire
shape transcribed verbatim from real transcripts; values are safe placeholders), including the real
Codex `cmd`-key force-push fixture that proves Step 3's headline exit criterion (`violated` on a real
`cmd` key). `p07-real-conformance.test.ts` asserts every fixture parses to a non-trivial,
version-RECOGNIZED, parse-HEALTHY session.

Adds a gitignored `fixtures/real-local/` corpus (true ground truth, scrubbed) that the conformance
test reads when present and skips otherwise — never committed, because the repo is public and `scrub`
only removes paths/emails/keys, not conversation/code. `scripts/pin-fixture.ts` (reusing
discover + scrub + observedVersions) captures a real transcript into that local corpus, so adding a
new harness version is a one-command change. Ships `docs/maintenance.md` (how to pin) and the
harness-coverage-matrix two-corpora note. This corpus gates the Step-8 soundness property tests.

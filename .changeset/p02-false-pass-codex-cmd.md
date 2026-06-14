---
"anatrace-core": minor
---

Fix two shipped false-PASS-class defects in the verdict layer (Phase 0 P0.2).

**`evalFileContent` negative branch was byte-identical to the positive branch.** `not_contains "x"`
on a file that DOES contain `x` returned `satisfied` instead of `violated`. The matcher matrix never
exercised the file-content arm, so the bug shipped. The negative branch now maps a match on the
forbidden content to `violated` (mirroring `evalReadPaths`).

**`commandStringOf` read only `input.command`, but real Codex `exec_command` carries the command
under `cmd`** (verified: 4788/4789 real `cli_version` 0.135+ events). Forbidden/force-push checks
were therefore DEAD on real Codex input — returning an affirmative `satisfied` on a real force-push.
The extractor now reads `command` then `cmd`, joining an argv array, with an unknown-key **canary**
(`isUnreadableCommandEvent`): a command tool whose input shape we can't read degrades the
forbidden-command direction to `unverifiable`, never a false-clean.

Both defects are pinned by a new `{arm}×{matcher}×{present/absent}` table test over real-shaped
bytes, and a previously-toothless Codex test (fabricated key, `if (s)` soft-skip, verdict-permissive
assertion) is tightened to the real `cmd` key with a strict `violated` assertion. A shared `negate()`
helper centralizes the pinned negative-matcher mapping across all forbidden-direction arms so an arm
can never re-derive it backwards again. No public-API change; verdict behavior is strictly more
correct (no new `satisfied`, several previously-false `satisfied` now `violated`/`unverifiable`).

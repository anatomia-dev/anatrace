# Maintenance

## How to pin a fixture when a harness changes

Harnesses drift (Claude Code ships 2–3×/week; Codex irregularly). anatrace defends against drift with
two corpora — see `docs/harness-coverage-matrix.md`. When a harness ships a new version, pin it:

### 1. Capture a real transcript into the local-only corpus

```bash
npx tsx packages/cli/scripts/pin-fixture.ts                 # most-recent local session
npx tsx packages/cli/scripts/pin-fixture.ts <transcript>    # a specific ~/.claude or ~/.codex file
```

This discovers the session, scrubs it (`scrubText`: paths/emails/keys — **not** conversation or
code), version-stamps it from `observedVersions`, and writes it to
`packages/core/test/fixtures/real-local/<harness>@<version>/`. That directory is **gitignored** and
**never committed** — the repo is public and scrub does not redact content. `p07-real-conformance.test.ts`
reads it automatically (and is skipped when absent), so `pnpm test` now exercises the new version
against your real bytes.

### 2. If conformance fails, the format drifted — update the adapter + commit a skeleton

A failing conformance run is the drift alarm. Fix the adapter for the new shape, then commit a
**real-FORMAT / synthetic-CONTENT** skeleton so the regression is guarded publicly:

```
packages/core/test/fixtures/real/<harness>@<version>/parent.jsonl
```

Transcribe the new keys / event types / version string **verbatim** from the real capture; author
only the **values** (commands, paths, content) as safe placeholders. Never copy real conversation or
code into the committed corpus. Bump the supported-major floor in `harness-support.ts` **only** on a
whole-major harness bump.

### 3. Verify nothing real is staged

```bash
git status   # must show NO files under test/fixtures/real-local/
```

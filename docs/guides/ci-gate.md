# CI gate — the anatrace GitHub Action

`packages/action` runs anatrace in CI and turns a session transcript into a merge decision, a
code-scanning upload, and a sticky PR comment. It is built on the CLI's shipped gate (`--ci`,
`--format sarif`, `--json`).

## What it does

1. **Uploads SARIF (violated-only)** for GitHub code-scanning. Only `violated` reaches the rail —
   `unverifiable` and `satisfied` never flood it.
2. **Writes the JSON coverage record** as a build artifact — the re-runnable staple (re-run anatrace
   on the same transcript for a byte-identical record; reproducibility substitutes for a signature).
3. **Posts a sticky PR comment that LEADS with the unverifiables** (by reason, with capture actions).
   A gate that publishes its own blind spots is the opposite of a green check that hides them.
4. **Exits non-zero ONLY on an artifact-integrity GATE violation.**

## Gate vs detector — the distinction that anchors the pitch

- **Gate** — an artifact-integrity property (*stayed-in-scope*, *didn't-edit-the-tests*). The harm is
  in the diff, so **blocking the merge is the right and sufficient response.** A `never_edit` /
  `only_edit` violation **fails the build.**
- **Detector** — a side-effect that **already happened** (*read the secret*, *egressed*). By the time
  you see it, blocking the merge can't un-read the secret — the response is **revoke / incident**, not
  block. A `never_read` / `never_egress` violation is **surfaced** in the comment (and can justify a
  human merge-hold), but the Action does **not** fail the build on it.

This is why the gate story is anchored on artifact-integrity, and reads/egress are framed as forensic
evidence — pitching them as the merge gate invites the obvious rebuttal.

## Example workflow

```yaml
name: anatrace
on: [pull_request]
permissions:
  contents: read
  pull-requests: write      # the sticky comment
  security-events: write    # the SARIF upload
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anatomia-dev/anatrace-action@v1
        with:
          session-path: path/to/agent-session.jsonl
          policy: .anatrace.yaml
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: anatrace.sarif
```

## Unverifiables ride the comment + the JSON artifact, NEVER SARIF

SARIF is violated-only by contract; an honest "I couldn't verify this" is not a finding to put on the
code-scanning rail. The unverifiables — the gate's published blind spots — travel in the PR comment and
the JSON record artifact. (A schema-locked record means a consumer can validate the artifact;
see `docs/reference/coverage-record.md`.)

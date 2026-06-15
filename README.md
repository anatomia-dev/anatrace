# anatrace

**Did your AI agent do what it was supposed to — and what can you actually *prove* it didn't do?**

You gave an agent broad access to your repo. It edited files, ran commands, maybe
spawned sub-agents. anatrace reads the session transcript the harness already wrote
(Claude Code, Codex) and returns a **deterministic verdict** on whether the agent
stayed within its obligations — and, when the evidence is incomplete, it answers
**`unverifiable(reason)`** instead of ever guessing "clean."

That last part is the whole point. A verifier that over-claims is worse than none.
anatrace **leads with the verdict and refuses to go green under degradation**: a
deleted, compacted, cross-store, or version-drifted transcript downgrades to
`unverifiable`, never `satisfied`.

```text
anatrace — VERDICT: ⚠ UNVERIFIABLE — 2 of 7 claims could not be proven
  ✓ satisfied: 5   ✗ violated: 0   ⚠ unverifiable: 2
    ⚠ 1 unverifiable: codex-blind (verify-independence)
    ⚠ 1 unverifiable: delegate-coverage-incomplete (no-secret)
  session: claude · claude-opus-4-8 · 482 turns · 14 files
  cost: ~$27.36 · tokens 36.0M total
```

- **Deterministic, zero-LLM in the published verdict path** — same input bytes →
  byte-identical result, reproducible by someone who doesn't trust you. No LLM
  grades the LLM.
- **Local** — no network, no upload. Your transcripts never leave your machine.
- **Zero-instrumentation** — runs on your existing Claude Code / Codex sessions;
  no SDK, no hooks required.

### The hero example

> An agent makes the failing test pass by **editing the test.** Every artifact signal
> agrees — the code review goes green, CI goes green, the diff is internally consistent —
> *because the test passes.* Only the transcript shows the passing test **was** the edit.

That's the one thing a diff-reviewer structurally cannot see, and it's a two-line policy:

```yaml
rules:
  - id: no-test-edits
    subject: this-agent
    never_edit: test/
```

Run it against the recorded hero session (`packages/cli/test/fixtures/hero/`, with the
replayable `anatrace.cast`) and anatrace leads with `✗ VIOLATED — no-test-edits` **and**,
in the same session, an honest `⚠ unverifiable` for a secret-read it couldn't prove because
a spawned sub-agent's transcript was never captured. The catch and the abstention, together.

> **Status: v0.4.** The cross-harness engine, generic policy loader,
> deterministic verdict layer, fail-loud channel coverage, coarse egress
> detection, and delegation lineage have landed. The verdict now **leads** the
> `--last` output and refuses green under degradation; the `never_edit`
> test-integrity check, the coverage-gap → capture-action remediation, the
> schema-locked `--json` record, and the CI-gate GitHub Action have landed too.
> **Breaking in 0.4:** the LLM-judge input (`dossier` / `hookRequests`) was demoted
> off the public surface and the `--json` envelope — zero-LLM in the published
> verdict path is now a surface property, not just a runtime one. Degraded sessions
> downgrade to `unverifiable` rather than ever false-passing, on every verdict path.
> The public API surface and the `unverifiable` reason vocabulary are frozen by a
> snapshot test; both `anatrace` and `anatrace-core` are pre-1.0 and versioned
> independently.

## Install

```sh
npm install anatrace-core
npm install --global anatrace
```

## What it does today

The verdict leads; cost/tokens/friction ride along as a footer (table-stakes, never
the headline).

- **Compliance verdicts** — given a mandate, anatrace emits per-claim
  deterministic verdicts (`satisfied` / `violated` / `unverifiable`) with a
  closed, machine-readable reason. **Zero LLM in the published verdict path**:
  there is no judge in the published API or the `--json` envelope, so a verdict is
  byte-reproducible by someone who doesn't trust you. (A consumer *may* inject their
  own model to opine on the residue anatrace abstained on — opt-in, runs only on
  already-`unverifiable` claims, labeled `source: 'llm'`, and it never gates. The
  deterministic verdict path never calls it.)
  Absent or non-comparable signal is always `unverifiable`, never a guess — a
  verifier that over-claims is worse than none. Gate CI with `--ci` / `--fail-on`,
  or emit `--format sarif` for code scanning. **The CI gate fails the build only on
  `violated`:** under the default `--ci` (fail-on `error`), `unverifiable` maps to
  `info` and never gates — an honest "I couldn't verify this" is a surfaced blind
  spot, not a policy failure, so it does not block a merge. (A consumer who wants
  to hard-stop on blind spots can opt in with `--fail-on info`.) This is *not* a
  contradiction of the verdict surface refusing to report "all clear" when
  `unverifiable > 0`: the verdict layer is honest about what it could not prove,
  while the gate blocks only a proven violation — two different axes, by design.
  *(File-scope adherence is the headline check; it is validated on
  curated exemplars today — a measured precision/recall benchmark is in progress
  as of 2026-06, not yet a published number.)*
- **Channel and lineage coverage** — every policy run states how many claims
  were checked and lists typed blind spots. Unknown tools, unsupported shell
  commands, and incomplete delegate capture downgrade a clean negative to
  `unverifiable`; observed violations remain violations.
- **Mandate inspection** — `anatrace mandate show <dir>` extracts the declared
  mandate (claims + predicate coverage) from a framework's source files.
- **Generic policy loading** — a repository-owned `.anatrace.yaml` compiles
  directly to the Mandate IR without a framework adapter.
- *Ride-along footer (table-stakes, not the headline):* per-session token / turn /
  tool counts and an estimated **cost** (bit-frozen `ProvenanceCounts`), plus
  deterministic **friction** findings about where a session struggled — aggregated,
  below the verdict.

This release is the honest engine, not the final audit artifact. It
provides deterministic transcript verification with explicit coverage limits.
Timestamped and hashed portable attestations remain a later phase.

## Generic policy

Place `.anatrace.yaml` in the working directory, or pass
`--policy path/to/policy.yaml`:

```yaml
version: 1
rules:
  - id: build-files
    subject: role:build
    delegates: include
    only_edit:
      - src/output.ts

  - id: no-secrets
    subject: this-agent-and-all-delegates
    never_read:
      - secrets/customer.csv

  - id: no-destructive-command
    subject: this-agent
    never_run:
      - rm -rf

  - id: no-test-edits          # the hero check: don't let the agent edit the tests to pass
    subject: this-agent
    never_edit: test/

  - id: no-external-egress
    subject: any-agent-in-session
    never_egress: external
```

```sh
anatrace session.jsonl --role build --json
```

Policy subjects are explicit: `this-agent`,
`this-agent-and-all-delegates`, `any-agent-in-session`, or `role:<name>`.
`role:<name>` uses `delegates: include|exclude` and must be bound by the
launcher or `--role`.

Delegate-inclusive negatives require a complete evidence boundary. anatrace
models that boundary in three parts:

1. observed lineage from transcripts, sidecars, and captured harness hooks;
2. expected launch records from a launcher such as Anatomia;
3. reconciled capture coverage proving every expected delegate lane was captured.

Hook records can be supplied as JSONL:

```sh
anatrace session.jsonl \
  --policy .anatrace.yaml \
  --lineage-hooks hooks.jsonl
```

A trusted launcher can also supply expected launch records. The CLI reconciles
them with observed checked lineage before verdict evaluation:

```sh
anatrace session.jsonl \
  --policy .anatrace.yaml \
  --lineage-hooks hooks.jsonl \
  --capture-manifest capture.json \
  --json
```

```json
{
  "kind": "expected-launch-boundary",
  "source": "trusted-launcher",
  "lanes": [
    {
      "agent": { "kind": "root" },
      "expectedDelegates": [{ "kind": "subagent", "subagentId": "reviewer" }]
    },
    {
      "agent": { "kind": "subagent", "subagentId": "reviewer" },
      "expectedDelegates": []
    }
  ]
}
```

Expected launch records are intent, not proof of capture. A lane is marked
captured only when observed lineage shows its transcript bytes were checked.

Without complete recursive capture coverage, absence produces an
`unverifiable` verdict with reason `delegate-coverage-incomplete`; observed root
or delegate violations still carry evidence. Finding some sidecars or hook
records is not itself completeness. See [Subject Axis](./docs/SUBJECT-AXIS.md).

`never_read` covers structured reads plus shell reads through `cat`, `sed`,
`head`, `tail`, `grep`, input redirection, and file-backed `curl`/`wget`
payloads. `never_egress` detects coarse external activity through shell network
commands, network tools, and MCP calls. Domain/resource allowlists are not yet
modeled; that belongs to the resource taxonomy phase.

An unknown tool or unsupported shell command is never treated as harmless. If
it could affect a channel needed to prove a clean negative, that claim returns
`unverifiable: channel-coverage-incomplete` and the coverage receipt names the
gap.

## Packages

- **`anatrace`** — the CLI (the only I/O layer): analyze a session, inspect a
  mandate, gate CI.
- **`anatrace-core`** — the pure engine and shared type contract. No fs, no
  network, no clock, no randomness.
- **`anatrace-action`** — the CI-gate GitHub Action: it runs anatrace on a PR,
  uploads violated-only SARIF to code-scanning, posts a sticky verdict comment that
  leads with the unverifiables, and gates on artifact-integrity. Built and verified
  by a live CI run; **not yet published as a tagged action** (that's a release step —
  see `docs/guides/ci-gate.md`). The CLI also gates CI directly (`anatrace --ci` /
  `--fail-on`, `--format sarif`).

## Determinism & privacy contract

`anatrace-core` is pure by construction — its TypeScript config compiles with
`"types": []`, so a `node:fs` / `process` / network reference is a **compile
error**, not a lint opinion. CI locks the published `ProvenanceCounts` /
`TokenCounts` *shape* (exact fields, key order, no `cost_usd`) against a
committed golden, and the same-bytes-in → byte-identical-out determinism test
runs on every change. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)

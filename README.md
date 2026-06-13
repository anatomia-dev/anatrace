# anatrace

**Deterministic, local, cross-harness analysis for AI coding sessions.**

anatrace reads your agent's own session transcripts (Claude Code, Codex) and
answers questions a log viewer can't: what did the session cost, where did it
hit friction, and — given the mandate the harness recorded — did the agent stay
within it. Across both harnesses, entirely on your machine.

- **Deterministic** — the same input bytes produce a byte-identical result. No
  LLM grades the LLM.
- **Local** — no network, no upload. Your transcripts never leave your machine.
- **Cross-harness** — one model over Claude *and* Codex.

> **Status: v0.1 release candidate.** The cross-harness engine, generic policy
> loader, deterministic verdict layer, fail-loud channel coverage, and coarse
> egress detection have landed. Public APIs remain pre-1.0 and may evolve.

## Install

```sh
npm install anatrace-core
npm install --global anatrace
```

## What it does today

- **Provenance + cost** — per-session token / turn / tool counts and cost,
  derived from the transcript bytes (bit-frozen `ProvenanceCounts`).
- **Friction** — deterministic findings about where a session struggled.
- **Mandate inspection** — `anatrace mandate show <dir>` extracts the declared
  mandate (claims + predicate coverage) from a framework's source files.
- **Generic policy loading** — a repository-owned `.anatrace.yaml` compiles
  directly to the Mandate IR without a framework adapter.
- **Compliance verdicts** — given a mandate, anatrace emits per-claim
  deterministic verdicts (`satisfied` / `violated` / `unverifiable`) with a
  closed, machine-readable reason. Absent or non-comparable signal is always
  `unverifiable`, never a guess — a verifier that over-claims is worse than
  none. Gate CI with `--ci` / `--fail-on`, or emit `--format sarif` for code
  scanning. *(File-scope adherence is the headline check; its accuracy is
  exemplar-validated today — a measured precision/recall is in progress.)*
- **Channel and lineage coverage** — every policy run states how many claims
  were checked and lists typed blind spots. Unknown tools, unsupported shell
  commands, and incomplete delegate capture downgrade a clean negative to
  `unverifiable`; observed violations remain violations.

This first release is the honest engine, not the final audit artifact. It
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
- **`anatrace-action`** — a GitHub Action shell (placeholder). Consumed straight
  from this repo (`uses: anatomia-dev/anatrace`); **not published to npm**.

## Determinism & privacy contract

`anatrace-core` is pure by construction — its TypeScript config compiles with
`"types": []`, so a `node:fs` / `process` / network reference is a **compile
error**, not a lint opinion. CI locks the published `ProvenanceCounts` /
`TokenCounts` *shape* (exact fields, key order, no `cost_usd`) against a
committed golden, and the same-bytes-in → byte-identical-out determinism test
runs on every change. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)

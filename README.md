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

> **Status: pre-v0.1, actively developed.** The cross-harness engine, the
> Mandate schema + adapters, and the deterministic verdict layer have landed.
> The LLM-judge seam (designed, not wired), the SARIF GitHub Action, and
> additional framework adapters are next. Public APIs may still shift before
> v0.1.

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
- **Channel coverage** — every policy run states how many claims were checked
  and lists typed blind spots. Unknown tools or unsupported shell commands
  downgrade a clean negative to `unverifiable`; observed violations remain
  violations.

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

Delegate-inclusive negatives require a trusted launcher capture manifest:

```sh
anatrace session.jsonl \
  --policy .anatrace.yaml \
  --capture-manifest capture.json \
  --json
```

Without a complete recursive manifest, absence is
`unverifiable: delegate-coverage-incomplete`; observed violations still carry
evidence. See [Subject Axis](./docs/SUBJECT-AXIS.md).

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

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
- **Compliance verdicts** — given a mandate, anatrace emits per-claim
  deterministic verdicts (`satisfied` / `violated` / `unverifiable`) with a
  closed, machine-readable reason. Absent or non-comparable signal is always
  `unverifiable`, never a guess — a verifier that over-claims is worse than
  none. Gate CI with `--ci` / `--fail-on`, or emit `--format sarif` for code
  scanning. *(File-scope adherence is the headline check; its accuracy is
  exemplar-validated today — a measured precision/recall is in progress.)*

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

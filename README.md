# anatrace

> ⚠️ **Early WIP — foundation only.** This repository currently contains the
> package skeleton and the public type contract. The engine (adapters, rules,
> the headline detector) ships in a later milestone. There is no working
> analysis yet. Watch the repo if the thesis below interests you.

**Deterministic, local, cross-harness integrity for AI coding sessions.**

anatrace reads your agent's own session transcripts (Claude Code, Codex) and
answers a question no log viewer does: **not "what did it do" but "what did it
get away with"** — across both harnesses, entirely on your machine.

- **Deterministic** — same input bytes produce a byte-identical result. No LLM
  grades the LLM.
- **Local** — no network, no upload. Your transcripts never leave your machine.
- **Cross-harness** — one verdict over Claude *and* Codex.

## Status

| Piece | State |
|-------|-------|
| Package topology (`@anatrace/core` · `anatrace` · `@anatrace/action`) | ✅ laid |
| Public type contract (`ProvenanceCounts`, `TokenCounts`, + experimental stubs) | ✅ seeded |
| Determinism + core-purity guards | ✅ wired |
| Adapters / rules / CLI features | ⛔ not yet (next milestone) |

## Packages

- **`@anatrace/core`** — the pure engine and the shared type contract. No fs, no
  network, no clock, no randomness. The package Anatomia will one day depend on.
- **`anatrace`** — the CLI (the only I/O layer). Currently `--version` / `--help`.
- **`@anatrace/action`** — a GitHub Action shell (placeholder).

## Determinism & privacy contract

`@anatrace/core` is pure by construction — its TypeScript config compiles with
`"types": []`, so a `node:fs`/`process`/network reference is a **compile error**,
not a lint opinion. Determinism is verified in CI against a committed golden
fixture. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)

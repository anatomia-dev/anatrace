# Contributing to anatrace

Thanks for your interest. anatrace is in an early foundation phase — the engine
isn't built yet, so the most useful contributions right now are issues and
discussion. Code contributions are welcome once the engine milestone opens.

## Canonical repository

There is exactly **one** canonical source of truth:
[`anatomia-dev/anatrace`](https://github.com/anatomia-dev/anatrace), checked out
on `main`. Develop from a **single standalone clone** of it.

Do **not** keep multiple long-lived local checkouts of this repo, and do not
share one `.git` across several working directories via `git worktree` for
day-to-day work. Divergent checkouts have caused real confusion here — an
older tree can read like canon while sitting commits behind `main`. If you need
isolation for a risky change, branch within your single clone; remove any
scratch worktrees as soon as the branch merges (`git worktree prune`).

To verify you are on canon:

```bash
git remote -v          # one remote: anatomia-dev/anatrace
git worktree list      # one entry, your clone, on main
```

## Developer Certificate of Origin (DCO)

This project uses a **DCO**, not a CLA. You certify that you wrote the patch (or
have the right to submit it) under the project's open-source license by signing
off your commits:

```bash
git commit -s -m "your message"
```

This appends a `Signed-off-by: Your Name <you@example.com>` line. PRs whose
commits are not signed off will be asked to amend. See
[developercertificate.org](https://developercertificate.org/) for the text you
are certifying.

## Local development

Requires **Node ≥ 22** and **pnpm ≥ 9**.

```bash
pnpm install
pnpm check       # typecheck + build + test + lint, all packages
```

- **bun** is supported at *runtime* only (`bunx anatrace`); the build toolchain
  is pnpm + tsdown.

## The determinism & purity contract (please don't break these)

These two invariants are the brand. CI enforces both:

1. **`anatrace-core` is pure.** Its `tsconfig.json` sets `"types": []`, so any
   `node:*` / `process` / `Buffer` / network reference fails to **typecheck**.
   Core also keeps `"dependencies": {}`. Keep I/O in `anatrace` (the CLI).
2. **Deterministic output.** Same input bytes → byte-identical result. The
   `ProvenanceCounts` / `TokenCounts` shapes are **frozen** (exact fields, exact
   key order, no `cost_usd`) and locked by a golden-fixture test. Do not reorder
   or add fields to those without a deliberate, reviewed contract change.

## Versioning & releases

- **Independent versioning** (`.changeset/config.json` → `"fixed": []`, `"linked": []`). `anatrace`
  (CLI) and `anatrace-core` (engine) version **separately** — an embedder pins `anatrace-core`, not
  the CLI, so they must not move in lockstep.
- **No public-API change without a changeset — and pick the right bump level.** Two distinct
  guardrails, plus one human judgement:
  - CI's `changeset status` enforces that a changed package carries a changeset (**presence**).
  - The export-snapshot + `VerdictReason`/`LineageGapReason` value-locks
    (`test/p04-public-api-lock.test.ts`) fail on a **surface change** until the snapshot is
    deliberately regenerated — that's your signal the change is real.
  - **Neither tool verifies the bump LEVEL.** Removing/renaming a public export or changing verdict
    output is **breaking** → `minor` pre-1.0 (`major` post-1.0), not `patch`. That call is yours at
    review time. A patch bump on a breaking change is a semver lie — and on a verifier whose brand is
    "don't overclaim," that's a release blocker.

## Code style

- TypeScript strict (see `tsconfig.base.json`), ESM-only.
- ESLint flat config (no Prettier). `pnpm lint` must be clean.

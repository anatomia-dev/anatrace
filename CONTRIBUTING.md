# Contributing to anatrace

Thanks for your interest. anatrace is in an early foundation phase — the engine
isn't built yet, so the most useful contributions right now are issues and
discussion. Code contributions are welcome once the engine milestone opens.

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

1. **`@anatrace/core` is pure.** Its `tsconfig.json` sets `"types": []`, so any
   `node:*` / `process` / `Buffer` / network reference fails to **typecheck**.
   Core also keeps `"dependencies": {}`. Keep I/O in `anatrace` (the CLI).
2. **Deterministic output.** Same input bytes → byte-identical result. The
   `ProvenanceCounts` / `TokenCounts` shapes are **frozen** (exact fields, exact
   key order, no `cost_usd`) and locked by a golden-fixture test. Do not reorder
   or add fields to those without a deliberate, reviewed contract change.

## Code style

- TypeScript strict (see `tsconfig.base.json`), ESM-only.
- ESLint flat config (no Prettier). `pnpm lint` must be clean.

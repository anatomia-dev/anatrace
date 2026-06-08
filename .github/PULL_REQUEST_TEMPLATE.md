## What

Briefly, what this PR changes and why.

## Checklist

- [ ] Commits are signed off (`git commit -s`) per the [DCO](../CONTRIBUTING.md#developer-certificate-of-origin-dco)
- [ ] `pnpm check` passes locally (typecheck + build + test + lint)
- [ ] No new I/O, network, clock, or randomness in `anatrace-core` (purity contract)
- [ ] No change to the frozen `ProvenanceCounts` / `TokenCounts` shape (or it's a deliberate, reviewed contract change)
- [ ] Added a changeset if this is a user-facing change to a published package (`pnpm exec changeset`)

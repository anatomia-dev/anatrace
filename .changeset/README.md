# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
Add a changeset with `pnpm exec changeset` when you make a user-facing change to a
published package (`@anatrace/core`, `anatrace`). `@anatrace/action` is ignored
(not npm-published). Releases publish token-less via npm Trusted Publishing (OIDC).

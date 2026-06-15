# anatrace-action

A GitHub Action that runs [anatrace](https://github.com/anatomia-dev/anatrace) in CI: it gates a PR on
**artifact-integrity** violations, **surfaces what it could not verify** (the unverifiables, leading the
PR comment), uploads **violated-only SARIF** to code-scanning, and writes the **re-runnable JSON
record** as an artifact. Deterministic, zero-LLM in the published verdict path.

See [`docs/guides/ci-gate.md`](../../docs/guides/ci-gate.md) for the gate-vs-detector model and a full
workflow. Inputs are documented in [`action.yml`](./action.yml).

**Status:** built out; the `dist/` is produced by the workspace build. Publishing it as a tagged,
consumable action (with a committed `dist/`) is a release step.

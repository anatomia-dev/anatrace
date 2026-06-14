---
"anatrace-core": patch
"anatrace": patch
---

Honesty-floor pass + release discipline (Phase 0 P0.5 — the final prep before 0.2.1).

Docs (no claim the code doesn't honor):
- README: make the **zero-LLM public surface** claim explicit (the judge cluster is now quarantined);
  "exemplar-validated" → a dated "recall benchmark in progress (as of 2026-06), not a published number";
  the `anatrace-action` entry is now honest ("reserved slot; not yet functional and not published — do
  not depend on it"; the CLI gates CI today). Dropped a user-facing "Phase 2" milestone label.
- `anatrace-action` placeholder string no longer leaks an internal milestone code.

Release discipline:
- CI now enforces **no package/public-API change without a changeset** (`changeset status` on every PR);
  combined with the export-snapshot + reason value-locks, an unintended surface change fails loudly.
- Documented **independent versioning** (`fixed: []`) in CONTRIBUTING.

Test hygiene (folded-in follow-ups):
- Migrated the layout-obsolete `codex-subagent-storage` corpus fixture to the real Codex `children/rollout-*`
  layout (the corpus loader now reads codex children as separate rollout files, mirroring reality).
- Added CLI render coverage for the P0.6 honesty breadcrumb (version-unrecognized / parse-suspect).

No public-API or verdict-behavior change in this PR — docs, tests, CI, and a fixture move only.

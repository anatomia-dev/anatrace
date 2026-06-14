---
"anatrace-core": patch
"anatrace": patch
---

Feeders fail loud (Phase 0 P0.3) — silent under-extraction becomes a visible, typed gap.

Mandate extraction is structural regex over one framework's shapes; on drift it yielded fewer
claims with no signal, so the coverage stat over-claimed by omission. This adds a deterministic,
bounded extraction-honesty layer:

- New `ExtractionDiagnostic` (on `Mandate.diagnostics`, additive — OMITTED when empty, so clean
  output and the golden corpus are byte-identical). Two kinds: `unextracted-marker` (a recognized
  obligation marker that produced no claim) and `recognized-but-empty` (framework detected, zero
  claims extractable).
- The anatomia adapter now flags: a drifted `ana-verify` whose build-report independence rule no
  longer matches (`verify-independence`), a `skills:` frontmatter key present but not parsed as an
  inline list (`skills-frontmatter`), and a detected-but-empty agent-def (closing the
  "dangerous middle" F4 gap). The superpowers adapter flags an `Iron Law` it triggers on but cannot
  mechanically extract (`iron-law`).
- The CLI surfaces gaps: `mandate show` prints an "⚠ extraction gaps" section; a recognized-but-empty
  source now reports the gap loudly instead of a bare "extracted no claims."
- The honest coverage line is relabeled: "X of Y **declared** obligations" → "X of the Y obligations
  it **could structurally recognize**" — the prior wording implied Y was the complete obligation
  surface. The coverage DENOMINATOR is unchanged (= extracted claims); we deliberately do NOT inject
  an unrecognized-prose count (circular, non-deterministic, and over-claiming — the exact failure the
  brand exists to prevent). Recall is an out-of-band benchmark, not a per-run number.

`mandate.schema.json` gains the additive optional `diagnostics` property + `ExtractionDiagnostic`
definition.

# Coverage & soundness

anatrace's worth is honesty about what it can and cannot mechanically prove. Two mechanisms keep
the coverage story honest: the **coverage stat** (what fraction of recognized obligations we check)
and **extraction-honesty diagnostics** (where extraction itself fell short). Neither ever inflates.

## The coverage stat — `X of Y`

```
anatrace mechanically checks X of the Y obligations it could structurally recognize on this
transcript; obligations it could not recognize (and the rest) route to your model.
```

- **X (numerator)** = claims with a `transcript`-scoped predicate and no `confidence` field — the
  obligations anatrace verifies deterministically.
- **Y (denominator)** = **all extracted claims**. Runtime-scoped and low-confidence claims are
  *excluded from X but kept in Y* — collapsing them out would inflate the ratio (the exact
  overstatement `predicate.scope` exists to prevent).

### Why Y is *recognized* obligations, not *all* obligations

Y is deliberately **not** a count of every obligation in the source. The adapters are structural:
they extract from known shapes (frontmatter `skills:`, `**Announce at start:**`, contract
`file_changes:`/`assertions:`). They refuse to read free prose as obligations, because the whole
system's credibility rests on never asserting anything it cannot anchor to a structural shape.

Counting unrecognized prose obligations into Y would be **circular** (to count an obligation you
must detect it; if you can detect it you would extract it) and **non-deterministic** (an imperative
sentence regex drifts with wording and floods Y with false obligations). A fabricated denominator is
itself an over-claim — "a verifier that over-claims is worse than none." So the word is precise:
*structurally recognize*, not *declared*. True recall is reported **out of band** as a dated
benchmark, never injected into the per-run stat.

## Extraction-honesty diagnostics

Structural extraction can silently under-deliver: a reworded imperative, a YAML block-list where an
inline list was expected, or an obligation expressed only in prose. Left silent, the coverage stat
would over-claim by omission. anatrace surfaces these as typed, deterministic
`Mandate.diagnostics` — bounded to markers the adapter **already recognizes** as obligation-bearing,
so they never become an open-domain prose scan:

| kind | meaning | examples |
|------|---------|----------|
| `unextracted-marker` | a recognized obligation marker produced no claim | a superpowers `Iron Law` (prose, not a structural shape); a drifted `ana-verify` whose build-report independence rule no longer matches (`verify-independence`); a `skills:` key present but not an inline list (`skills-frontmatter`) |
| `recognized-but-empty` | a framework was detected but **zero** claims were extractable | a `name: ana-*` agent-def with no parseable obligations — the "dangerous middle" between *no obligations* and *we couldn't read your obligations* |

Diagnostics are **omitted entirely when empty**, so clean extraction output (and the golden corpus)
is byte-identical. The CLI surfaces them: `anatrace mandate show` prints an `⚠ extraction gaps`
section, and a recognized-but-empty source reports the gap loudly instead of a bare
"extracted no claims."

The contract: anatrace tells you exactly what it checked, **and** what it recognized-but-could-not,
and routes the remainder to your model. It never reports a clean coverage number while quietly
dropping an obligation it saw.

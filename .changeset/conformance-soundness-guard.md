---
---

Internal only (no release): add the conformance soundness guard — a committed labeled corpus of known seeded violation/clean classes + a deterministic scorer that gates against engine regressions into false-PASS (`satisfied` on a real breach) or false-VIOLATE. Not a published benchmark and no user-facing number: ground truth is constructive over synthetic sessions, so it proves soundness on known classes, not real-transcript generalization. A real measured number waits for real sessions at volume (gated on a real user / the external audit); the README "benchmark in progress" line stays.

---
"anatrace-core": patch
---

SARIF results now always carry a `location` (N7). GitHub code-scanning requires every result to have at least one location; a conduct verdict isn't always tied to a repo line, so `toSarif` falls back to the obligation's source (the policy/mandate path the CLI supplies) when no file location is known, and uses the real file location whenever it is. This makes the violated-only SARIF ingestible by code-scanning (the anatrace Action uploads it). Additive `fallbackUri` parameter on `toSarif`.

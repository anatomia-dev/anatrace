---
"anatrace-core": minor
---

Un-export the person-read meta-fact feeders from core's public API (Phase 0 P0.0).

`buildSessionMeta`, `gitOpsOf`, `contextLimitFor`, `CONTEXT_LIMITS` / `CONTEXT_LIMITS_VERSION`
and their named fact types (`SessionMetaFacts`, `GitOpsSummary`, `ContextLimitEntry`, …) are no
longer part of `anatrace-core`'s public surface. They feed a separate person-analytics aggregator
("Cracked"), which is at odds with the zero-LLM verdict positioning and only enlarges the surface
to freeze at the API-lock. No known consumer (the CLI, anatomia) imported them.

The computation is unchanged — `analyze()` still attaches the additive optional meta blocks to
`Report.session`, so the fact types remain reachable transitively through the public `Report`.
`meta/lane.ts` (verdict spine — `verdict.ts` imports `laneCapture`/`isGradeableCapture`) is
untouched and stays public. Technically a public-API removal, but pre-1.0 and consumer-free.

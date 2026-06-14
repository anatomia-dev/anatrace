---
"anatrace": patch
---

Codex multi-file tree discovery (Phase 0 P0.9).

Real Codex stores a delegate session as a SEPARATE `rollout-*.jsonl` in the same date directory,
linked by `session_meta.parent_thread_id` — not as a Claude-style `subagents/agent-*.jsonl` child.
`buildCodexGroup` passed core only the single parent rollout, so the Codex reachability/lineage
engine NEVER ran on real input (the lineage twin of the `cmd`-key bug). Discovery now gathers the
parent + every sibling `rollout-*.jsonl` in the date dir as candidate children; the core reachability
engine filters them by `parent_thread_id` chaining, so unrelated same-day sessions are dropped and
only true descendants are parsed as delegate lanes. Proven with a real date-dir/`rollout-*` layout
fixture (`discover-codex.test.ts`): the child surfaces as an observed delegate, a stranger does not.

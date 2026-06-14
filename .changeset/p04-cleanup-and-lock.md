---
"anatrace-core": patch
---

Cleanup sweep + the package-boundary lock (Phase 0 P0.4/P0.9, final Phase-0 step).

De-export sweep (pre-1.0 surface reduction; no known consumer imported these):
- Removed `matchAnnouncedSkills`, `buildZeroMandateWedge`, `parseSemver` from the public API
  (internal-only; callers use direct imports). Dropped the dead `_sourceKey` param from
  `fileScopeVerdict`'s exported signature.

Dedup + single-source:
- Collapsed the 6× AgentRef-identity duplication into canonical `agentKey` / `sameAgentRef` /
  `uniqueAgents` (order-preserving) + `uniqueAgentsSorted` (lineage/coverage) on `session.ts`. (The
  two `uniqueAgents` variants genuinely differ — order-preserving vs sorted — so they stay as two.)
- FI-17 matcher totality now flows from one `COMPARABLE_MATCHERS` source (`isComparableMatcher` +
  `evalMessageText`), pinned by a value-lock test.

The lock (`p04-public-api-lock.test.ts`):
- Export snapshot freezes the public `index.ts` surface (180 identifiers) — add/remove now requires a
  deliberate change + changeset.
- `VerdictReason` (14) and `LineageGapReason` (11) string sets are value-locked, and every member is
  asserted REACHABLE (a live emitter, not declaration-only) so none can freeze dead.

Deferred (noted, non-blocking): migrating the layout-obsolete `codex-subagent-storage` corpus fixture
(CC-style `subagents/` storage) to the real Codex `rollout-*` layout — needs a corpus-loader change +
test updates; discovery (the layout-sensitive path) is already covered by the Step-6 real-layout test.

Additional de-exports before the freeze (zero consumers verified across core/CLI/action/anatomia):
- QUARANTINED the LLM-judge cluster off the public zero-LLM surface: `adjudicate` + `JudgeFn` /
  `JudgeInput` / `JudgeOutput` / `JudgeVerdict` / `JudgeBudget`. The deterministic
  `buildHookRequests` / `HookRequest` residue stays public; `Config.judge` remains an internal
  (bundled, non-exported) injection seam — there is no public entrypoint that can call an LLM.
- Removed dead public symbols `getRule`, `allRules`, `unknownComplianceKeys`.

The frozen export snapshot is now 171 identifiers (`test/fixtures/public-api.snapshot`).

import type { Rule, Finding, EvalContext, Severity } from '../types.js';

/** The default friction pack id. */
export const FRICTION_PACK = 'friction';

/**
 * Single-sourced friction default severity. Both rules' `defaultSeverity` AND the severity
 * they stamp on emitted findings read this — `analyze` then applies the CONFIG-RESOLVED
 * active severity (A1), so this is the default, not a hardcoded gate level.
 */
export const FRICTION_DEFAULT_SEVERITY: Severity = 'warn';

/**
 * `interrupt` — emits a Finding per structured user interrupt, CROSS-HARNESS. Claude's
 * `[Request interrupted by user]` marker (B1.c) and Codex's
 * `turn_aborted.reason === 'interrupted'` both normalize to `InterruptEvent{reason:'interrupted'}`,
 * so this rule is harness-neutral. Renamed from the R2 `codex-interrupt` once B1.c made the
 * Claude interrupt structured (the rule is event-driven, not harness-guarded).
 */
export const interruptRule: Rule = {
  id: 'interrupt',
  pack: FRICTION_PACK,
  meta: {
    rationale:
      'A turn was aborted by a user interrupt (Claude "[Request interrupted by user]" / Codex turn_aborted.reason="interrupted").',
  },
  defaultSeverity: FRICTION_DEFAULT_SEVERITY,
  evaluate(ctx: EvalContext): Finding[] {
    const out: Finding[] = [];
    for (const e of ctx.session.events) {
      if (e.type === 'interrupt' && e.reason === 'interrupted') {
        out.push({
          ruleId: 'interrupt',
          severity: FRICTION_DEFAULT_SEVERITY,
          message: 'A turn was aborted by a user interrupt.',
        });
      }
    }
    return out;
  },
};

/**
 * `claude-tool-failure` — emits a Finding per Claude `tool_result.is_error === true`
 * (ALL tools). Renamed from `claude-edit-failure` (founder decision 2026-06-08): byte-
 * verified that `is_error` fires 87% on non-edit tools; the broad name keeps full recall
 * and `is_error` is structured/safe across all tools (REQ Item 7).
 */
export const claudeToolFailureRule: Rule = {
  id: 'claude-tool-failure',
  pack: FRICTION_PACK,
  meta: { rationale: 'A Claude tool_result reported is_error=true (any tool).' },
  defaultSeverity: FRICTION_DEFAULT_SEVERITY,
  evaluate(ctx: EvalContext): Finding[] {
    const out: Finding[] = [];
    for (const e of ctx.session.events) {
      if (e.type === 'toolResult' && e.isError === true) {
        out.push({
          ruleId: 'claude-tool-failure',
          severity: FRICTION_DEFAULT_SEVERITY,
          message: 'A tool call returned an error.',
        });
      }
    }
    return out;
  },
};

/** Exactly the two exercised R2 friction rules (REQ Item 7 defer table governs the rest). */
export const FRICTION_RULES: Rule[] = [interruptRule, claudeToolFailureRule];

import type { Rule, Finding, EvalContext } from '../types.js';

/** The default friction pack id. */
export const FRICTION_PACK = 'friction';

/**
 * `codex-interrupt` — emits a Finding per structured Codex interrupt
 * (`turn_aborted.reason === 'interrupted'`). The only structured interrupt R2 ships
 * (the Claude interrupt is text-only → deferred, REQ Item 7).
 */
export const codexInterruptRule: Rule = {
  id: 'codex-interrupt',
  pack: FRICTION_PACK,
  meta: {
    rationale: 'A Codex turn was aborted by a user interrupt (turn_aborted.reason="interrupted").',
  },
  defaultSeverity: 'warn',
  evaluate(ctx: EvalContext): Finding[] {
    const out: Finding[] = [];
    for (const e of ctx.session.events) {
      if (e.type === 'interrupt' && e.reason === 'interrupted') {
        out.push({
          ruleId: 'codex-interrupt',
          severity: 'warn',
          message: 'Turn aborted by user interrupt.',
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
  defaultSeverity: 'warn',
  evaluate(ctx: EvalContext): Finding[] {
    const out: Finding[] = [];
    for (const e of ctx.session.events) {
      if (e.type === 'toolResult' && e.isError === true) {
        out.push({
          ruleId: 'claude-tool-failure',
          severity: 'warn',
          message: 'A tool call returned an error.',
        });
      }
    }
    return out;
  },
};

/** Exactly the two exercised R2 friction rules (REQ Item 7 defer table governs the rest). */
export const FRICTION_RULES: Rule[] = [codexInterruptRule, claudeToolFailureRule];

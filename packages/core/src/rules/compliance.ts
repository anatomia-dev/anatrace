/**
 * The OPT-IN `compliance` pack (D-CONFIG). One `Rule` per `ComplianceCheckId`, with `id` ===
 * `compliance/<check-id>` so the shipped `resolveSeverity` (which keys by `rule.id`) resolves
 * `"compliance/verify-independence":"error"` etc. with NO grammar change.
 *
 * These rules are GATE-KEY HOLDERS — the deterministic verdicts (computed by `runCompliance`,
 * not a per-event `evaluate`) map to a rule's active severity at gate time. Their `evaluate`
 * is a no-op (they emit nothing in the friction loop); the `compliance/contract-under-specified`
 * Finding is pushed by the verdict layer (DECISION B), severity-stamped from this rule's setting.
 *
 * `compliance` is a SEPARATE pack, NEVER unioned into `recommended` — the no-config path stays
 * byte-identical to R2 (OQ-D10).
 */
import type { Rule, Finding, Severity } from '../types.js';
import { COMPLIANCE_CHECK_IDS, complianceKey, type ComplianceCheckId } from '../compliance-config.js';

export const COMPLIANCE_PACK = 'compliance';

/** Per-check default severity. Gating checks default `error`; the MASS observation defaults `info`. */
function defaultSeverityFor(id: ComplianceCheckId): Severity {
  return id === 'contract-under-specified' ? 'info' : 'error';
}

function makeComplianceRule(id: ComplianceCheckId): Rule {
  return {
    id: complianceKey(id),
    pack: COMPLIANCE_PACK,
    meta: {
      rationale: `Compliance check "${id}" — a deterministic mandate verdict mapped to this gate severity.`,
    },
    defaultSeverity: defaultSeverityFor(id),
    // Verdict-driven, not event-driven: the friction loop emits nothing for these (the verdicts
    // + the MASS Finding are produced by runCompliance). A gate-key holder only.
    evaluate(): Finding[] {
      return [];
    },
  };
}

/** Exactly one rule per `ComplianceCheckId`. */
export const COMPLIANCE_RULES: Rule[] = COMPLIANCE_CHECK_IDS.map(makeComplianceRule);

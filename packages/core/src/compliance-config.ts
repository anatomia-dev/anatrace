/**
 * The verdict CONFIGURATION layer (D-CONFIG, ESLint-shaped, additive on the shipped `Config`).
 *
 * Severities are keyed by a DEDICATED closed `ComplianceCheckId` enum, NOT `ClaimKind` —
 * because `verify-independence` is a CHECK (emitted as `kind:'human-constraint'` + a `read-paths`
 * predicate), so keying on `ClaimKind` would make `compliance/verify-independence` name nothing
 * and silently no-op the gate (silent-misconfig). The check id is the GATE key.
 *
 * Verdict→gate mapping (the gate-layer bright line):
 *  - `violated`     → its check's active severity;
 *  - `unverifiable` → ALWAYS `info`, NEVER gates (the deterministic layer can't turn "couldn't
 *    check" into a CI failure);
 *  - `satisfied`    → silent.
 * The verdict itself carries NO severity — severity is a config-layer mapping.
 */
import type { Mandate, MandateClaim } from './mandate.js';
import type { Config, RuleSetting, Severity, Finding } from './types.js';
import type { ComplianceVerdict } from './verdict.js';

/**
 * The closed compliance-check vocabulary (NOT `ClaimKind`). `contract-under-specified` is the
 * MASS file-scope Finding's id (DECISION B); the rest map a claim to its gate key.
 */
export type ComplianceCheckId =
  | 'verify-independence'
  | 'file-scope'
  | 'command-run'
  | 'skill-invoked'
  | 'skill-announced'
  | 'dispatch'
  | 'artifact-saved'
  | 'human-constraint'
  | 'contract-matcher'
  | 'contract-under-specified';

export const COMPLIANCE_CHECK_IDS: readonly ComplianceCheckId[] = [
  'verify-independence',
  'file-scope',
  'command-run',
  'skill-invoked',
  'skill-announced',
  'dispatch',
  'artifact-saved',
  'human-constraint',
  'contract-matcher',
  'contract-under-specified',
];

/** The config-key form: `compliance/<check-id>`. */
export function complianceKey(id: ComplianceCheckId): string {
  return `compliance/${id}`;
}

/**
 * Map a claim to its `ComplianceCheckId` (the gate key). `verify-independence` is the named
 * SPECIAL CASE: a `human-constraint` claim with a `read-paths` predicate IS the verify-
 * independence check (its claim id is conventionally `verify-independence`). Everything else
 * maps the claim's `kind` → the matching check id; `intent`/`tdd-ordering`/`task-completed`
 * have no deterministic check → `null`.
 */
export function checkIdForClaim(claim: MandateClaim): ComplianceCheckId | null {
  // verify-independence: a read-paths human-constraint.
  if (
    claim.kind === 'human-constraint' &&
    claim.predicate?.target === 'read-paths'
  ) {
    return 'verify-independence';
  }
  switch (claim.kind) {
    case 'file-scope':
      return 'file-scope';
    case 'command-run':
      return 'command-run';
    case 'skill-invoked':
      return 'skill-invoked';
    case 'skill-announced':
      return 'skill-announced';
    case 'dispatch':
      return 'dispatch';
    case 'artifact-saved':
      return 'artifact-saved';
    case 'human-constraint':
      return 'human-constraint';
    case 'contract-matcher':
      return 'contract-matcher';
    default:
      return null; // intent / tdd-ordering / task-completed → no deterministic check
  }
}

function settingSeverity(setting: RuleSetting | undefined, fallback: Severity): Severity {
  if (setting === undefined) return fallback;
  return Array.isArray(setting) ? setting[0] : setting;
}

/**
 * The verdict→gate severity, per the bright line. `unverifiable` is ALWAYS `info` (never gates),
 * regardless of config; `satisfied` is silent (`off`); `violated` → the check's active severity
 * (config override or the default). Default active severity for a `violated` is `error` (the
 * gating headline) unless the config says otherwise.
 */
export function severityForVerdict(
  verdict: ComplianceVerdict,
  claim: MandateClaim,
  config?: Config,
): Severity {
  if (verdict.status === 'satisfied') return 'off';
  if (verdict.status === 'unverifiable') return 'info'; // NEVER gates
  // violated → the check's active severity.
  const id = checkIdForClaim(claim);
  if (!id) return 'error';
  const setting = config?.rules?.[complianceKey(id)];
  return settingSeverity(setting, 'error');
}

/**
 * Project the verdict set → GATING findings (the SARIF/CI rail). Per the bright line: a
 * `violated` verdict → a `Finding` at its check's active severity; `unverifiable` → `info`
 * (never gates) — but for the SARIF rail we emit `violated`-ONLY (the gating ones), so the
 * code-scanning surface is never flooded by the ~90%+ `unverifiable` mass. `satisfied` is silent.
 */
export function complianceFindings(
  mandate: Mandate,
  verdicts: ComplianceVerdict[],
  config?: Config,
  options?: { violatedOnly?: boolean },
): Finding[] {
  const violatedOnly = options?.violatedOnly ?? false;
  const claimById = new Map(mandate.claims.map((c) => [c.id, c]));
  const out: Finding[] = [];
  for (const v of verdicts) {
    if (v.status === 'satisfied') continue; // silent
    if (violatedOnly && v.status !== 'violated') continue;
    const claim = claimById.get(v.claimId);
    if (!claim) continue;
    const severity = severityForVerdict(v, claim, config);
    if (severity === 'off') continue;
    const id = checkIdForClaim(claim);
    out.push({
      ruleId: id ? complianceKey(id) : `compliance/${claim.kind}`,
      severity,
      message: `${claim.id}: ${v.status} (${v.reason})`,
    });
  }
  return out;
}

/**
 * Validate the `compliance/*` config keys against the `ComplianceCheckId` enum. An unknown id
 * (e.g. a typo `compliance/file-scop`) WARNs (returns it) rather than silently no-opping — a
 * net-new surface `resolveSeverity` can't host (an id naming no rule never reaches it).
 */
export function unknownComplianceKeys(config?: Config): string[] {
  const rules = config?.rules;
  if (!rules) return [];
  const known = new Set(COMPLIANCE_CHECK_IDS.map((id) => complianceKey(id)));
  const out: string[] = [];
  for (const key of Object.keys(rules)) {
    if (key.startsWith('compliance/') && !known.has(key)) out.push(key);
  }
  return out;
}

/**
 * The compliance orchestration layer (D3 + D-CONFIG glue) — turns a mandate + session into
 * the verdict set, the MASS `contract-under-specified` Findings (DECISION B), the dossier, and
 * the `hookRequests` residue manifest, all in ONE pure pass. Zero LLM; byte-identical with or
 * without a judge (the E2 guard). The deterministic ⟂ LLM wall: this NEVER reads `capabilities.judge`.
 */
import type { Mandate, MandateClaim } from './mandate.js';
import type { NormalizedSession } from './session.js';
import type { ContentResolver, Finding, Severity, Config } from './types.js';
import { verdictsForMandate, type ComplianceVerdict } from './verdict.js';
import {
  checkIdForClaim,
  severityForVerdict,
  type ComplianceCheckId,
} from './compliance-config.js';
import { resolveSeverity } from './config.js';
import { buildDossier, type Dossier } from './dossier.js';
import { buildHookRequests, type HookRequest } from './hook.js';

/** The compliance result bundle attached to a `Report` (the 3 reserved D names + the verdict set). */
export interface ComplianceResult {
  verdicts: ComplianceVerdict[];
  findings: Finding[];
  dossier: Dossier;
  hookRequests: HookRequest[];
}

/** The raw MASS-Finding records emitted by the verdict layer (DECISION B). */
interface RawFinding {
  ruleId: string;
  message: string;
  source: string;
  count: number;
}

/**
 * Run the full deterministic compliance pass. Pure: reads only the mandate + session (+ the
 * pure resolver). NEVER touches `capabilities.judge`. The `config` only maps verdict→severity
 * for the MASS Finding; verdicts themselves carry NO severity.
 */
export function runCompliance(
  mandate: Mandate,
  session: NormalizedSession,
  resolver?: ContentResolver,
  config?: Config,
  repoRoot?: string,
): ComplianceResult {
  const raw: RawFinding[] = [];
  const verdicts = verdictsForMandate(mandate, session, resolver, raw, repoRoot ?? '');

  // MASS `contract-under-specified` → a non-gating `info` Finding (DECISION B). Its severity is
  // the config-resolved `compliance/contract-under-specified` setting (default `info`).
  const cusSeverity = resolveContractUnderSpecifiedSeverity(config);
  const findings: Finding[] = raw.map((f) => ({
    ruleId: f.ruleId,
    severity: cusSeverity,
    message: f.message,
    ...(f.source ? { location: { file: f.source } } : {}),
  }));

  const dossier = buildDossier(session, mandate, verdicts, resolver);
  const hookRequests = buildHookRequests(mandate, verdicts, dossier);
  return { verdicts, findings, dossier, hookRequests };
}

/** The `compliance/contract-under-specified` rule's active severity (default `info`, never gating by default). */
function resolveContractUnderSpecifiedSeverity(config?: Config): Severity {
  const setting = config?.rules?.['compliance/contract-under-specified'];
  if (setting === undefined) return 'info';
  return Array.isArray(setting) ? setting[0] : setting;
}

/** Re-exports for consumers that map verdicts to gate severities (D-CONFIG). */
export { checkIdForClaim, severityForVerdict, resolveSeverity };
export type { ComplianceCheckId, MandateClaim };

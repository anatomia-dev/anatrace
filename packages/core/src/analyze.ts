import type { NormalizedSession } from './session.js';
import type { Capabilities, Config, Finding, EvalContext } from './types.js';
import type { Mandate } from './mandate.js';
import type { Report } from './report.js';
import { resolvePack } from './registry.js';
import { resolveSeverity, resolveOptions, applyIgnores } from './config.js';
import { runCompliance } from './compliance.js';
import { buildSessionMeta } from './meta/facts.js';

const SCHEMA_VERSION = 2; // A5 — the one coherent v2 bump (sessionId + timeBounds?)

/**
 * Absolute epoch-ms window of the session's timestamped events (A5). Same min/max scan as
 * the derive duration window — so `timeBounds.end - timeBounds.start === counts.duration_ms`.
 * `undefined` when no event carries a `ts` (matches the derive `duration_ms === 0` case).
 */
function timeBoundsOf(session: NormalizedSession): { start: number; end: number } | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const e of session.events) {
    if (e.ts !== undefined) {
      if (e.ts < min) min = e.ts;
      if (e.ts > max) max = e.ts;
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) && max >= min ? { start: min, end: max } : undefined;
}

/**
 * The pure orchestration entry (REQ Item 10 / A1): resolve the active pack from `config`
 * (`extends`, default `recommended`), run each rule with its resolved options, STAMP each
 * finding with the rule's config-resolved active severity (the gate axis lives in config,
 * never in the rule body), skip `off` rules, then apply the `ignores` suppression. No fs /
 * network / clock — values in, `Report` out. Cost is NOT computed here (render-time, Item 8).
 *
 * The no-config path is byte-identical to R2: `recommended` → friction, every rule resolves
 * to its `defaultSeverity`, no suppression.
 *
 * D — when a `mandate` is supplied, `analyze` ALSO fills the three reserved v2 names
 * (`compliance`/`dossier`/`hookRequests`) via the pure {@link runCompliance} pass. It NEVER
 * reads `capabilities.judge` — that is `adjudicate`-time only (the bright line / E2 guard:
 * `analyze` with vs without `capabilities.judge` is byte-identical). No mandate ⇒ the three
 * fields are omitted ⇒ R2 byte-identity holds.
 *
 * @param session - The normalized session to analyze
 * @param config - Resolved config (the CLI does discovery, A3); severity/enable/ignores/options
 * @param capabilities - Injected capability channel (A4: parser + contentResolver); judge UNUSED here
 * @param mandate - D: the extracted mandate to verify; when present, fills compliance/dossier/hookRequests
 * @param repoRoot - D (file-scope correctness): the project root the CLI runs from, used to
 *   relativize ABSOLUTE non-worktree source edits so file-scope normalization can compare them
 *   against the repo-relative contract whitelist. Additive/optional; absent ⇒ prior behavior
 *   (worktree-strip only) + the still-absolute safety net (never false-accuse).
 * @returns The `Report` envelope
 */
export function analyze(
  session: NormalizedSession,
  config?: Config,
  capabilities?: Capabilities,
  mandate?: Mandate,
  repoRoot?: string,
): Report {
  const ctx: EvalContext = { session, ...(capabilities ? { capabilities } : {}) };
  const findings: Finding[] = [];
  for (const rule of resolvePack(config)) {
    const severity = resolveSeverity(rule, config);
    if (severity === 'off') continue;
    const opts = resolveOptions(rule, config);
    for (const f of rule.evaluate(ctx, opts)) {
      findings.push(f.severity === severity ? f : { ...f, severity });
    }
  }

  // D — the deterministic compliance pass (only when a mandate is supplied). NEVER reads
  // capabilities.judge (the bright line). The MASS contract-under-specified Findings join
  // the friction findings on the same `Report.findings` channel (DECISION B).
  let compliance: Report['compliance'];
  let dossier: Report['dossier'];
  let hookRequests: Report['hookRequests'];
  if (mandate) {
    const result = runCompliance(mandate, session, capabilities?.contentResolver, config, repoRoot);
    compliance = result.verdicts;
    dossier = result.dossier;
    hookRequests = result.hookRequests;
    findings.push(...result.findings);
  }

  const timeBounds = timeBoundsOf(session);
  // Meta-facts (M1–M4) — additive optional per-session FACTS blocks (pure projection, no LLM,
  // no verdict, no person-score). Omitted domains keep the R2 byte-identity intact;
  // `ProvenanceCounts` (session.counts) is UNTOUCHED and `schemaVersion` STAYS 2.
  const meta = buildSessionMeta(session);
  return {
    schemaVersion: SCHEMA_VERSION,
    session: {
      harness: session.harness,
      model: session.counts.model,
      sessionId: session.sessionId,
      counts: session.counts,
      observedVersions: session.observedVersions,
      ...(timeBounds ? { timeBounds } : {}),
      ...(meta ?? {}),
    },
    findings: applyIgnores(findings, config),
    ...(compliance ? { compliance } : {}),
    ...(dossier ? { dossier } : {}),
    ...(hookRequests ? { hookRequests } : {}),
  };
}

import type { NormalizedSession } from './session.js';
import type { Capabilities, Config, Finding, EvalContext } from './types.js';
import type { Report } from './report.js';
import { resolvePack } from './registry.js';
import { resolveSeverity, resolveOptions, applyIgnores } from './config.js';

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
 * @param session - The normalized session to analyze
 * @param config - Resolved config (the CLI does discovery, A3); severity/enable/ignores/options
 * @param capabilities - Injected capability channel (A4: parser + judge); CLI-supplied, unused in A+B
 * @returns The `Report` envelope
 */
export function analyze(
  session: NormalizedSession,
  config?: Config,
  capabilities?: Capabilities,
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
  const timeBounds = timeBoundsOf(session);
  return {
    schemaVersion: SCHEMA_VERSION,
    session: {
      harness: session.harness,
      model: session.counts.model,
      sessionId: session.sessionId,
      counts: session.counts,
      observedVersions: session.observedVersions,
      ...(timeBounds ? { timeBounds } : {}),
    },
    findings: applyIgnores(findings, config),
  };
}

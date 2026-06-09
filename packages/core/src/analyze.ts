import type { NormalizedSession } from './session.js';
import type { Config, Finding, EvalContext } from './types.js';
import type { Report } from './report.js';
import { defaultPack } from './registry.js';

const SCHEMA_VERSION = 1;

/**
 * The pure orchestration entry (REQ Item 10): select the default-pack rules from the
 * in-core registry, run each `rule.evaluate(ctx)`, collect findings, attach the session
 * summary. No fs / network / clock — values in, `Report` out. Cost is NOT computed here
 * (render-time only — Item 8).
 *
 * @param session - The normalized session to analyze
 * @param _config - Reserved (severity/enablement overrides land later); unused in R2
 * @returns The `Report` envelope
 */
export function analyze(session: NormalizedSession, _config?: Config): Report {
  const ctx: EvalContext = { session };
  const findings: Finding[] = [];
  for (const rule of defaultPack()) {
    findings.push(...rule.evaluate(ctx));
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    session: {
      harness: session.harness,
      model: session.counts.model,
      counts: session.counts,
      observedVersions: session.observedVersions,
    },
    findings,
  };
}

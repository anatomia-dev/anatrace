/**
 * SARIF projection + CI gate semantics (D-CONFIG) — the retention rail. PURE: `Finding` →
 * SARIF, and the exit-code decision, are projections core owns; the CLI only wires stdout +
 * `process.exit`. The deployed GitHub Action is a focused follow-on (OQ-D11) — D ships the
 * gate semantics + exit codes, not the Action.
 *
 * SARIF emits `violated`-ONLY results (the gating ones). `unverifiable`/`satisfied` stay in
 * the dossier, NEVER on the code-scanning rail — on a ~90%+-runtime corpus, emitting every
 * `unverifiable` as a SARIF `note` floods GitHub code-scanning.
 */
import type { Finding, Severity } from './types.js';

/** `Severity` → SARIF level. `off` is omitted (the result is dropped). */
export function sarifLevel(severity: Severity): 'error' | 'warning' | 'note' | null {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warn':
      return 'warning';
    case 'info':
      return 'note';
    case 'off':
      return null;
  }
}

/** Minimal SARIF 2.1.0 result shape (the subset GitHub code-scanning consumes). */
export interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations?: Array<{ physicalLocation: { artifactLocation: { uri: string }; region?: { startLine: number } } }>;
}

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: Array<{ tool: { driver: { name: string; rules: Array<{ id: string }> } }; results: SarifResult[] }>;
}

/**
 * Build a SARIF log from findings. Only findings that map to a SARIF level (NOT `off`) are
 * emitted. The caller passes the GATING findings (the `violated`-mapped ones); satisfied/
 * unverifiable never reach here.
 */
export function toSarif(findings: Finding[], toolName = 'anatrace'): SarifLog {
  const results: SarifResult[] = [];
  const ruleIds = new Set<string>();
  for (const f of findings) {
    const level = sarifLevel(f.severity);
    if (!level) continue; // off → omitted
    ruleIds.add(f.ruleId);
    results.push({
      ruleId: f.ruleId,
      level,
      message: { text: f.message },
      ...(f.location
        ? {
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: f.location.file },
                  ...(f.location.line ? { region: { startLine: f.location.line } } : {}),
                },
              },
            ],
          }
        : {}),
    });
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver: { name: toolName, rules: [...ruleIds].map((id) => ({ id })) } }, results }],
  };
}

/** Severity rank for the `--fail-on <severity>` threshold. */
const RANK: Record<Severity, number> = { off: 0, info: 1, warn: 2, error: 3 };

/**
 * The CI gate decision. Returns the exit code:
 *  - `0` — clean (no finding at/above the fail-on threshold);
 *  - `1` — a genuine POLICY failure (a finding at/above the threshold);
 *  - `2` — usage/parse error (decided by the CLI, not here).
 * `--ci` defaults the threshold to `error` (exit 1 iff a `violated`@active-`error`).
 * `unverifiable` maps to `info` and NEVER gates (so it can never push past `warn`/`error`).
 */
export function ciExitCode(findings: Finding[], failOn: Severity = 'error'): 0 | 1 {
  const threshold = RANK[failOn];
  if (threshold === 0) return 0; // off → never gate
  for (const f of findings) {
    if (RANK[f.severity] >= threshold) return 1;
  }
  return 0;
}

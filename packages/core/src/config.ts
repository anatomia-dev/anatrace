import type { Config, Finding, Rule, RuleOptions, Severity } from './types.js';

/**
 * Config resolution helpers (A1). Pure functions over a resolved {@link Config} — no fs,
 * no disk, no clock. The gate axis (severity) lives in config, never baked into a rule;
 * these resolve a rule's ACTIVE severity/options and apply the `ignores` suppression. The
 * no-config path resolves every rule to its `defaultSeverity` with no suppression, so
 * `analyze(session)` stays byte-identical to R2.
 */

/** Active severity for a rule: the config override (bare or `[severity, opts]`) or the rule default. */
export function resolveSeverity(rule: Rule, config?: Config): Severity {
  const setting = config?.rules?.[rule.id];
  if (setting === undefined) return rule.defaultSeverity;
  return Array.isArray(setting) ? setting[0] : setting;
}

/** Per-rule options from the `[severity, options]` form; `undefined` for a bare severity / no entry. */
export function resolveOptions(rule: Rule, config?: Config): RuleOptions | undefined {
  const setting = config?.rules?.[rule.id];
  return Array.isArray(setting) ? setting[1] : undefined;
}

/**
 * Suppression subset (`config.ignores`): drop a finding whose `location.file` IS an ignore
 * path or sits UNDER one (path-prefix). Pure string compare — no glob engine, no fs.
 * No-op when `ignores` is empty/absent, and a finding without a `location.file` is never
 * suppressed (there is nothing to match).
 */
export function applyIgnores(findings: Finding[], config?: Config): Finding[] {
  const ignores = config?.ignores;
  if (!ignores || ignores.length === 0) return findings;
  return findings.filter((f) => {
    const file = f.location?.file;
    if (!file) return true;
    return !ignores.some((ig) => file === ig || file.startsWith(ig.endsWith('/') ? ig : `${ig}/`));
  });
}

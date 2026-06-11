import type { Config, Rule } from './types.js';
import { FRICTION_RULES } from './rules/friction.js';
import { COMPLIANCE_RULES } from './rules/compliance.js';

/** In-core rule registry (REQ Item 10). No plugin loader — built-ins only. */
const REGISTRY = new Map<string, Rule>();
for (const rule of FRICTION_RULES) REGISTRY.set(rule.id, rule);
for (const rule of COMPLIANCE_RULES) REGISTRY.set(rule.id, rule);

/**
 * Named built-in packs (A1). `recommended` = friction ONLY (D-CONFIG / OQ-D10): `compliance`
 * is a SEPARATE OPT-IN pack, NEVER unioned into `recommended`, so the no-config path stays
 * byte-identical to R2. A user opts in with `extends:['recommended','compliance']`.
 */
const PACKS: Record<string, () => Rule[]> = {
  recommended: () => [...FRICTION_RULES],
  friction: () => [...FRICTION_RULES],
  compliance: () => [...COMPLIANCE_RULES],
};

/** Look up a registered rule by id. */
export function getRule(id: string): Rule | undefined {
  return REGISTRY.get(id);
}

/** The built-in default pack — exactly the R2 friction rules (the `recommended`-equivalent). */
export function defaultPack(): Rule[] {
  return [...FRICTION_RULES];
}

/**
 * Resolve the active rule set from config `extends` (A1). Defaults to `['recommended']`
 * when unset → byte-identical to R2. Unknown pack names are ignored (degrade, never
 * throw); rules are de-duplicated by id across packs in `extends` order. Per-rule
 * enable/`off` is applied downstream in {@link import('./analyze.js').analyze}, not here.
 */
export function resolvePack(config?: Config): Rule[] {
  const names = config?.extends?.length ? config.extends : ['recommended'];
  const seen = new Set<string>();
  const out: Rule[] = [];
  for (const name of names) {
    const pack = PACKS[name];
    if (!pack) continue;
    for (const rule of pack()) {
      if (!seen.has(rule.id)) {
        seen.add(rule.id);
        out.push(rule);
      }
    }
  }
  return out;
}

/** Every registered rule. */
export function allRules(): Rule[] {
  return [...REGISTRY.values()];
}

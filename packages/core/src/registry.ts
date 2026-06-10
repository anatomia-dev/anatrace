import type { Config, Rule } from './types.js';
import { FRICTION_RULES } from './rules/friction.js';

/** In-core rule registry (REQ Item 10). No plugin loader — built-ins only. */
const REGISTRY = new Map<string, Rule>();
for (const rule of FRICTION_RULES) REGISTRY.set(rule.id, rule);

/**
 * Named built-in packs (A1). `recommended` = friction ∪ later compliance packs; today
 * only friction exists, so both names resolve to the friction set. Phase D's compliance
 * pack extends this map — `resolvePack` then unions it into `recommended` additively.
 */
const PACKS: Record<string, () => Rule[]> = {
  recommended: () => [...FRICTION_RULES],
  friction: () => [...FRICTION_RULES],
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

import type { Rule } from './types.js';
import { FRICTION_RULES } from './rules/friction.js';

/** In-core rule registry (REQ Item 10). No plugin loader — built-ins only. */
const REGISTRY = new Map<string, Rule>();
for (const rule of FRICTION_RULES) REGISTRY.set(rule.id, rule);

/** Look up a registered rule by id. */
export function getRule(id: string): Rule | undefined {
  return REGISTRY.get(id);
}

/** The built-in default pack — exactly the R2 friction rules (the `recommended`-equivalent). */
export function defaultPack(): Rule[] {
  return [...FRICTION_RULES];
}

/** Every registered rule. */
export function allRules(): Rule[] {
  return [...REGISTRY.values()];
}

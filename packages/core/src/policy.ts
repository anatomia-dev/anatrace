import { parseDocument } from 'yaml';
import type {
  ClaimSubject,
  Mandate,
  MandateClaim,
  PredicateTarget,
} from './mandate.js';
import { validateMandate } from './mandate-validate.js';

export type PolicyVerb =
  | 'never_read'
  | 'only_read'
  | 'never_egress'
  | 'never_run'
  | 'only_edit';

export type PolicyLoadResult =
  | { ok: true; mandate: Mandate }
  | { ok: false; errors: string[] };

const POLICY_VERBS: readonly PolicyVerb[] = [
  'never_read',
  'only_read',
  'never_egress',
  'never_run',
  'only_edit',
];
const ROOT_KEYS = new Set(['version', 'name', 'rules']);
const RULE_KEYS = new Set(['id', 'subject', 'delegates', ...POLICY_VERBS]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringList(value: unknown, label: string, errors: string[]): string[] {
  const values =
    typeof value === 'string'
      ? [value]
      : Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? value
        : null;
  if (!values || values.length === 0 || values.some((item) => item.length === 0)) {
    errors.push(`${label} must be a non-empty string or list of non-empty strings`);
    return [];
  }
  return values;
}

function parseSubject(
  value: unknown,
  delegatesValue: unknown,
  label: string,
  errors: string[],
): ClaimSubject | null {
  if (typeof value !== 'string') {
    errors.push(`${label}.subject must be a string`);
    return null;
  }
  if (value === 'this-agent') {
    if (delegatesValue !== undefined) {
      errors.push(`${label}.delegates must not accompany subject 'this-agent'`);
    }
    return { kind: 'agent', selector: 'this', delegates: 'exclude' };
  }
  if (value === 'this-agent-and-all-delegates') {
    if (delegatesValue !== undefined) {
      errors.push(
        `${label}.delegates must not accompany subject 'this-agent-and-all-delegates'`,
      );
    }
    return { kind: 'agent', selector: 'this', delegates: 'include' };
  }
  if (value === 'any-agent-in-session') {
    if (delegatesValue !== undefined) {
      errors.push(`${label}.delegates must not accompany subject 'any-agent-in-session'`);
    }
    return { kind: 'session' };
  }
  if (value.startsWith('role:')) {
    const role = value.slice('role:'.length);
    if (!role) {
      errors.push(`${label}.subject role must not be empty`);
      return null;
    }
    const delegates = delegatesValue ?? 'exclude';
    if (delegates !== 'include' && delegates !== 'exclude') {
      errors.push(`${label}.delegates must be 'include' or 'exclude'`);
      return null;
    }
    return { kind: 'role', role, delegates };
  }
  errors.push(
    `${label}.subject must be this-agent, this-agent-and-all-delegates, any-agent-in-session, or role:<name>`,
  );
  return null;
}

function targetFor(verb: PolicyVerb): Exclude<PredicateTarget, 'message-text'> {
  switch (verb) {
    case 'never_read':
    case 'only_read':
      return 'read-paths';
    case 'never_egress':
      return 'egress';
    case 'never_run':
      return 'command-content';
    case 'only_edit':
      return 'edit-paths';
  }
}

function kindFor(verb: PolicyVerb): Exclude<MandateClaim['kind'], 'intent'> {
  switch (verb) {
    case 'only_edit':
    case 'only_read':
      return 'file-scope';
    case 'never_run':
      return 'command-run';
    default:
      return 'human-constraint';
  }
}

function saysFor(verb: PolicyVerb, value: string): string {
  switch (verb) {
    case 'never_read':
      return `never reads ${value}`;
    case 'only_read':
      return `reads only declared path ${value}`;
    case 'never_egress':
      return `never egresses to ${value}`;
    case 'never_run':
      return `never runs ${value}`;
    case 'only_edit':
      return `edits only declared path ${value}`;
  }
}

/**
 * Parse a generic `.anatrace.yaml` policy into the framework-neutral Mandate IR.
 * Pure: YAML text in, typed data out; no filesystem, clock, network, or randomness.
 *
 * @param text - UTF-8 policy text.
 * @param sourceName - Stable source label used by claim evidence.
 * @returns A validated Mandate or closed load errors.
 */
export function loadPolicyYaml(
  text: string,
  sourceName = '.anatrace.yaml',
): PolicyLoadResult {
  const errors: string[] = [];
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return {
      ok: false,
      errors: document.errors.map((error) => `invalid YAML: ${error.message}`),
    };
  }
  const root = recordOf(document.toJS({ maxAliasCount: 0 }));
  if (!root) return { ok: false, errors: ['policy must be a YAML mapping'] };
  for (const key of Object.keys(root)) {
    if (!ROOT_KEYS.has(key)) errors.push(`unknown policy key '${key}'`);
  }
  if (root['version'] !== 1) errors.push('policy.version must be 1');
  if (!Array.isArray(root['rules']) || root['rules'].length === 0) {
    errors.push('policy.rules must be a non-empty list');
    return { ok: false, errors };
  }

  const claims: MandateClaim[] = [];
  for (const [ruleIndex, rawRule] of root['rules'].entries()) {
    const label = `rules[${ruleIndex}]`;
    const rule = recordOf(rawRule);
    if (!rule) {
      errors.push(`${label} must be a mapping`);
      continue;
    }
    for (const key of Object.keys(rule)) {
      if (!RULE_KEYS.has(key)) errors.push(`${label} has unknown key '${key}'`);
    }
    const id = typeof rule['id'] === 'string' && rule['id'] ? rule['id'] : '';
    if (!id) errors.push(`${label}.id must be a non-empty string`);
    const subject = parseSubject(rule['subject'], rule['delegates'], label, errors);
    const verbs = POLICY_VERBS.filter((verb) => rule[verb] !== undefined);
    if (verbs.length !== 1) {
      errors.push(`${label} must declare exactly one policy verb`);
      continue;
    }
    const verb = verbs[0];
    if (!verb) continue;
    const values = stringList(rule[verb], `${label}.${verb}`, errors);
    if (!id || !subject || values.length === 0) continue;

    for (const [valueIndex, value] of values.entries()) {
      claims.push({
        id: values.length === 1 ? id : `${id}:${valueIndex + 1}`,
        says: saysFor(verb, value),
        kind: kindFor(verb),
        ...(verb === 'only_edit' ? { deviationHandling: 'strict' as const } : {}),
        subject,
        scope: { kind: 'whole-session' },
        source: { kind: 'in-blob', blob: sourceName, fidelity: 'verbatim' },
        predicate: {
          target: targetFor(verb),
          scope: 'transcript',
          matcher: verb.startsWith('never_') ? 'not_contains' : 'contains',
          value,
        },
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const mandate: Mandate = {
    schemaVersion: 1,
    framework: 'anatrace-policy',
    claims,
  };
  const mandateErrors = validateMandate(mandate);
  return mandateErrors.length > 0
    ? { ok: false, errors: mandateErrors }
    : { ok: true, mandate };
}

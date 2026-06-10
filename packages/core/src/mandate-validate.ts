import type {
  Mandate,
  MandateClaim,
  ClaimPredicate,
  ClaimKind,
  Matcher,
  PredicateTarget,
} from './mandate.js';

/**
 * Load-time (semantic) validation for a hand-authored / extracted {@link Mandate}. This is the
 * runtime counterpart to the compile-time boundary guard (`test/types/boundary.type-test.ts`):
 * type-checking proves a `MandateClaim` shape; this proves the SEMANTIC bright line that the
 * type cannot — that a `message-text`/`literalsOnly` predicate cannot smuggle a prose-grep
 * (`matches: ".*I verified.*"`) and masquerade as a mechanical verdict.
 *
 * Pure: no disk, no clock, no throw on bad input — returns a list of error strings (empty = ok).
 */

const CLAIM_KINDS: ReadonlySet<ClaimKind> = new Set<ClaimKind>([
  'dispatch',
  'skill-announced',
  'skill-invoked',
  'command-run',
  'file-scope',
  'tdd-ordering',
  'contract-matcher',
  'artifact-saved',
  'task-completed',
  'human-constraint',
  'intent',
]);

const TARGETS: ReadonlySet<PredicateTarget> = new Set<PredicateTarget>([
  'edit-paths',
  'tool-names',
  'read-paths',
  'skill-events',
  'message-text',
  'subagent',
  'file-content',
  'event-order',
]);

const MATCHERS: ReadonlySet<Matcher> = new Set<Matcher>([
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'exists',
  'matches',
  'gte',
  'lte',
]);

/**
 * A `matches` pattern is a prose-grep MASQUERADE when it is unanchored/wildcard — i.e. it
 * relies on `.*`/`.+`/`.`-class wildcards rather than matching a literal. On a
 * `message-text`/`literalsOnly` predicate that is forbidden (the brand bright line): the
 * predicate must match a LITERAL, never a wildcard pattern dressed up as a mechanical verdict.
 */
function isWildcardPattern(pattern: string): boolean {
  // Any regex metacharacter that introduces non-literal matching → wildcard/prose-grep.
  return /[.*+?^${}()|[\]\\]/.test(pattern);
}

function validateMessageTextPredicate(p: ClaimPredicate, claimId: string, errs: string[]): void {
  if (p.target !== 'message-text') return;
  // literalsOnly is a typed literal `true`; defend at runtime for hand-authored data too.
  if (p.literalsOnly !== true) {
    errs.push(`claim ${claimId}: message-text predicate must set literalsOnly:true`);
  }
  if (p.role !== 'user' && p.role !== 'assistant') {
    errs.push(`claim ${claimId}: message-text predicate must set role to 'user' or 'assistant'`);
  }
  if (p.matcher === 'matches') {
    const v = typeof p.value === 'string' ? p.value : '';
    if (isWildcardPattern(v)) {
      errs.push(
        `claim ${claimId}: a 'matches' matcher with a wildcard/regex pattern (${JSON.stringify(
          v,
        )}) is forbidden on a literalsOnly message-text predicate (prose-grep masquerade)`,
      );
    }
  }
}

function validatePredicate(p: ClaimPredicate, claimId: string, errs: string[]): void {
  if (!TARGETS.has(p.target)) errs.push(`claim ${claimId}: unknown predicate target '${p.target}'`);
  if (!MATCHERS.has(p.matcher)) errs.push(`claim ${claimId}: unknown matcher '${p.matcher}'`);
  if (p.scope !== 'transcript' && p.scope !== 'runtime') {
    errs.push(`claim ${claimId}: predicate.scope must be 'transcript' or 'runtime'`);
  }
  validateMessageTextPredicate(p, claimId, errs);
}

/**
 * A windowed claim is scoped to exactly ONE agent timeline. `agentScope` is MANDATORY on every
 * `event-triggered-window` claim (concurrency axis): without it, a flat window silently
 * mis-attributes events across concurrent subagent timelines. Validate it is present and a
 * well-formed `AgentScope` (`{kind:'root'}` or `{kind:'subagent', subagentId}`).
 */
function validateScope(c: MandateClaim, errs: string[]): void {
  if (c.scope.kind !== 'event-triggered-window') return;
  const a = (c.scope as { agentScope?: unknown }).agentScope as
    | { kind?: unknown; subagentId?: unknown }
    | undefined;
  const ok =
    !!a &&
    (a.kind === 'root' || (a.kind === 'subagent' && typeof a.subagentId === 'string' && !!a.subagentId));
  if (!ok) {
    errs.push(`claim ${c.id}: an event-triggered-window claim must set agentScope (concurrency axis)`);
  }
}

function validateClaim(c: MandateClaim, errs: string[]): void {
  if (!c.id) errs.push('claim missing id');
  if (!CLAIM_KINDS.has(c.kind)) errs.push(`claim ${c.id}: unknown kind '${c.kind}'`);
  validateScope(c, errs);
  if (c.kind === 'intent') {
    // The boundary: only `intent` forbids a predicate.
    if ('predicate' in c && (c as { predicate?: unknown }).predicate !== undefined) {
      errs.push(`claim ${c.id}: an 'intent' claim must NOT carry a predicate`);
    }
  } else if (c.predicate) {
    validatePredicate(c.predicate, c.id, errs);
  }
}

/** Validate a Mandate. Returns the (possibly empty) list of human-readable error strings. */
export function validateMandate(m: Mandate): string[] {
  const errs: string[] = [];
  if (typeof m.framework !== 'string' || !m.framework) errs.push('mandate missing framework');
  if (!Array.isArray(m.claims)) {
    errs.push('mandate.claims must be an array');
    return errs;
  }
  for (const c of m.claims) validateClaim(c, errs);
  return errs;
}

/** True iff the Mandate is semantically valid (no errors). */
export function isValidMandate(m: Mandate): boolean {
  return validateMandate(m).length === 0;
}

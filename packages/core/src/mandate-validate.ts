import type {
  Mandate,
  MandateClaim,
  ClaimPredicate,
  ClaimKind,
  ClaimSubject,
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
  'command-content',
  'egress',
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

function validateSubject(subject: ClaimSubject | undefined, claimId: string, errs: string[]): void {
  if (!subject) return; // legacy whole-session Mandates remain valid
  if (subject.kind === 'session') return;
  if (subject.kind === 'agent') {
    if (subject.selector !== 'this') {
      errs.push(`claim ${claimId}: agent subject selector must be 'this'`);
    }
    if (subject.delegates !== 'include' && subject.delegates !== 'exclude') {
      errs.push(`claim ${claimId}: agent subject delegates must be 'include' or 'exclude'`);
    }
    return;
  }
  if (subject.kind === 'role') {
    if (!subject.role) errs.push(`claim ${claimId}: role subject must name a role`);
    if (subject.delegates !== 'include' && subject.delegates !== 'exclude') {
      errs.push(`claim ${claimId}: role subject delegates must be 'include' or 'exclude'`);
    }
    return;
  }
  errs.push(`claim ${claimId}: unknown subject kind`);
}

/**
 * A window must resolve to exactly one lane. Identity lives only in `subject`; the removed
 * `scope.agentScope` representation is rejected so no claim can carry competing WHO axes.
 */
function validateScope(c: MandateClaim, errs: string[]): void {
  const legacyAgentScope = (c.scope as { agentScope?: unknown }).agentScope;
  if (legacyAgentScope !== undefined) {
    errs.push(`claim ${c.id}: scope.agentScope was replaced by claim.subject`);
  }
  if (c.scope.kind !== 'event-triggered-window') return;
  const subject = c.subject;
  const singleLane =
    subject?.kind === 'agent' && subject.delegates === 'exclude'
      ? true
      : subject?.kind === 'role' && subject.delegates === 'exclude';
  if (!singleLane) {
    errs.push(
      `claim ${c.id}: an event-triggered-window claim requires a single-lane subject with delegates:'exclude'`,
    );
  }
}

function validateClaim(c: MandateClaim, errs: string[]): void {
  if (!c.id) errs.push('claim missing id');
  if (!CLAIM_KINDS.has(c.kind)) errs.push(`claim ${c.id}: unknown kind '${c.kind}'`);
  validateSubject(c.subject, c.id, errs);
  validateScope(c, errs);
  if (
    c.deviationHandling !== undefined &&
    (c.kind !== 'file-scope' ||
      c.predicate?.target !== 'edit-paths' ||
      (c.deviationHandling !== 'adaptive' && c.deviationHandling !== 'strict'))
  ) {
    errs.push(
      `claim ${c.id}: deviationHandling is valid only for edit-paths file-scope claims`,
    );
  }
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
  const ids = new Set<string>();
  if (typeof m.framework !== 'string' || !m.framework) errs.push('mandate missing framework');
  if (!Array.isArray(m.claims)) {
    errs.push('mandate.claims must be an array');
    return errs;
  }
  for (const c of m.claims) {
    validateClaim(c, errs);
    if (ids.has(c.id)) errs.push(`duplicate claim id '${c.id}'`);
    ids.add(c.id);
  }
  return errs;
}

/** True iff the Mandate is semantically valid (no errors). */
export function isValidMandate(m: Mandate): boolean {
  return validateMandate(m).length === 0;
}

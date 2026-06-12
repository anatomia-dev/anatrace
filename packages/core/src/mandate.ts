/**
 * The Mandate schema (Phase C — the keystone / the moat). A `Mandate` is the typed,
 * cross-framework declaration of *what the agent was supposed to do*; each `MandateClaim`
 * is *either* deterministically checkable (it carries a `predicate`) *or* explicitly routed
 * to the user's own LLM (no predicate / `kind:'intent'`). The deterministic-vs-LLM boundary
 * lives IN THE DATA — the schema, not any single check, is the durable asset.
 *
 * BRIGHT LINES this module type-enforces (a change that erodes either is wrong):
 *  1. The boundary is a FIELD, not a wall. Only `kind:'intent'` FORBIDS a predicate
 *     (compile-checked via {@link IntentClaim}); a non-`intent` claim MAY omit it (routes to
 *     the LLM in Phase E). Visible in the C5 coverage stat; tested by the C4 negative test.
 *  2. A `MandateClaim` carries NO LLM-result field — EVER (the E2 guard). There is no
 *     `verdict`/`judge`/`satisfied` member anywhere in these types; C is the language, not
 *     the checker (no `ComplianceVerdict`, no `check()`, no judge call lives in C).
 *
 * Forward-compat (DECISION A — reserve broadly, implement narrowly): every additive slot is
 * present in the type now so nothing forces a later reshape — `scope-depth` (window nesting),
 * `event-order` (predicate target), `guard?` (conditional carve-out), `confidence?`, and the
 * orthogonal `subject?` identity axis. Only the cheap high-value ones are *implemented* in C;
 * the rest route to the LLM (`intent`) in v1.
 */

/**
 * The closed claim taxonomy (exactly 11 members; order-independent). NEVER widen casually —
 * each member is a distinct obligation a framework can declare.
 *  - `task-completed` / `tdd-ordering` are "kind kept, check deferred": always emitted as
 *    `intent` in C (no evidence target exists until D / no test-run event is emitted).
 */
export type ClaimKind =
  | 'dispatch'
  | 'skill-announced'
  | 'skill-invoked'
  | 'command-run'
  | 'file-scope'
  | 'tdd-ordering'
  | 'contract-matcher'
  | 'artifact-saved'
  | 'task-completed'
  | 'human-constraint'
  | 'intent';

/** Did the adapter QUOTE the obligation verbatim, or INFER it? An existential audit field for a verifier. */
export type SourceFidelity = 'verbatim' | 'derived';

/**
 * Where the obligation text was found. Discriminated union FROM DAY ONE (forward-compat):
 *  - `in-blob` — a line in one of the session's own byte-blobs.
 *  - `cross-artifact` — a separate work-item artifact (e.g. a `contract.yaml`), resolved
 *    slug→bytes by the injected `ContentResolver` at the CLI; core never touches disk.
 */
export type ClaimSource =
  | { kind: 'in-blob'; blob: string; line?: number; fidelity: SourceFidelity }
  | {
      kind: 'cross-artifact';
      workItemSlug: string;
      path: string;
      line?: number;
      fidelity: SourceFidelity;
    };

/** What opens an event-triggered window. */
export type WindowOpensOn = 'skill-announced' | 'skill-invoked' | 'dispatch' | 'command';

/**
 * What closes an event-triggered window. `scope-depth` is RESERVED (window nesting) — present
 * in the type so a depth model can land later without a reshape, but NOT implemented in C
 * (flat windows ship in C; nested cases degrade to `unverifiable` via `confidence:'low'`).
 */
export type WindowClosesOn =
  | 'rest-of-session'
  | 'next-skill-announce'
  | 'next-same-skill-announce'
  | 'marker-text'
  | 'scope-depth'; // RESERVED — do NOT implement in C

/** Whole-session / a single event-triggered window / a cross-session span. */
export type ClaimScope =
  | { kind: 'whole-session' }
  | {
      kind: 'event-triggered-window';
      opensOn: WindowOpensOn;
      closesOn: WindowClosesOn;
      /** The marker literal when `closesOn === 'marker-text'`. */
      marker?: string;
    }
  | { kind: 'cross-session' };

/**
 * WHO a claim applies to. This is deliberately independent from {@link ClaimScope}, which
 * answers WHEN. A claim never carries identity inside its temporal scope.
 *
 * `subject` is optional only for backward compatibility with pre-subject Mandates. Omitted
 * means the legacy flat session union. New loaders and adapters MUST emit it explicitly.
 */
export type ClaimSubject =
  | { kind: 'agent'; selector: 'this'; delegates: 'exclude' | 'include' }
  | { kind: 'session' }
  | { kind: 'role'; role: string; delegates: 'exclude' | 'include' };

/**
 * The closed predicate-target vocabulary (NEVER a selector DSL — the live `contract.yaml`
 * `target` is an open namespace of ~1,000+ distinct prefixes; we do NOT reproduce it).
 * `event-order` is RESERVED (unimplemented in C).
 *
 * `command-content` (D-NONOBVIOUS) is the narrowly-implemented completion of the long-reserved
 * `command-run` claim KIND: it matches against the shell-command STRING of a `Bash`/`exec_command`
 * tool event (`ToolEvent.input.command`), NOT the tool name. It exists so a role can declare a
 * FORBIDDEN command class ("AnaVerify must not rebase or force-push the code branch") that
 * `tool-names` (name-only) cannot express. Cross-harness real (both harnesses emit a shell tool);
 * the negative-matcher (`not_contains`/`not_equals`) "forbidden command" direction is the one the
 * Anatomia adapter uses, mirroring the read-paths/forbidden-edit blacklist evaluators.
 */
export type PredicateTarget =
  | 'edit-paths'
  | 'tool-names'
  | 'command-content'
  | 'egress'
  | 'read-paths'
  | 'skill-events'
  | 'message-text'
  | 'subagent'
  | 'file-content'
  | 'event-order'; // RESERVED — unimplemented in C

/**
 * The matcher set implemented in C (string + numeric). `matches` is a regex match — but on a
 * `message-text` predicate it is constrained by `literalsOnly` (see {@link MessageTextPredicate})
 * AND validated to reject unanchored/wildcard patterns, so prose-grep can never masquerade as
 * a mechanical verdict (the brand bright line).
 */
export type Matcher =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'exists'
  | 'matches'
  | 'gte'
  | 'lte';

/**
 * Whether D resolves this predicate against the TRANSCRIPT (mechanically checkable — counted
 * in the C5 coverage numerator) or against RUNTIME state (→ `unverifiable` at D, NOT counted).
 * REQUIRED — it keeps the coverage stat honest (the `anatomia` adapter's contract assertions
 * are ~90%+ runtime; faking them as transcript checks is the exact overstatement this prevents).
 */
export type PredicateScope = 'transcript' | 'runtime';

/**
 * A conditional carve-out on a predicate. RESERVED — present in the type so a guard can land
 * later without a reshape, but UNIMPLEMENTED in C (a claim that would need a guard routes to
 * `intent`/the LLM in v1).
 */
export interface PredicateGuard {
  /** RESERVED shape — a future condition expression. Opaque in C. */
  reserved?: unknown;
}

/** Fields common to every predicate variant. */
interface PredicateBase {
  scope: PredicateScope; // REQUIRED
  matcher: Matcher;
  value?: string | number;
  guard?: PredicateGuard; // RESERVED — unimplemented in C
}

/**
 * A `message-text` predicate. Carries TWO typed fields the brand bright line depends on:
 *  - `role` — which side of the conversation the text must appear on.
 *  - `literalsOnly: true` — pins this predicate to LITERAL matching. Combined with the
 *    load-time validation (reject a wildcard/unanchored `matches` pattern here), it makes
 *    prose-grep (`matches: ".*I verified.*"` masquerading as a mechanical verdict)
 *    impossible to express as a checked claim.
 */
export interface MessageTextPredicate extends PredicateBase {
  target: 'message-text';
  role: 'user' | 'assistant';
  literalsOnly: true;
}

/** Every non-`message-text` predicate target. */
export interface GenericPredicate extends PredicateBase {
  target: Exclude<PredicateTarget, 'message-text'>;
}

/** The boundary value: a deterministically-checkable predicate. */
export type ClaimPredicate = MessageTextPredicate | GenericPredicate;

/**
 * The DECLARED obligation STRENGTH (D-A / D-D — positive obligations). NOT a `ClaimKind` (the
 * 11-member enum stays frozen); a net-new OPTIONAL field on `ClaimBase`, default `optional`.
 *
 *  - `optional` (the DEFAULT, and the brand-safety hinge): a claim makes NO obligation about
 *    presence OR absence — present → `satisfied`, ABSENT → today's `unverifiable`, NEVER
 *    `violated`. An omitted `strength` is byte-IDENTICAL to pre-positive-obligations behavior.
 *  - `required`: the obligation MUST occur. Absent from a RELIABLY-OBSERVABLE + COMPLETE lane →
 *    `violated`; absent from any lane not affirmatively proven observable+complete →
 *    `unverifiable` (the honesty floor — over-claiming is structurally impossible by default).
 *  - `forbidden`: the obligation MUST NOT occur. PRESENT → `violated`; absent → `satisfied`.
 *
 * Strength is DECLARED by the adapter from known framework knowledge (D-D), NEVER reverse-
 * engineered from prose. Only an adapter that explicitly declares `required`/`forbidden` can
 * ever produce a `violated` on this axis.
 */
export type ClaimStrength = 'required' | 'optional' | 'forbidden';

/**
 * How an edit allowlist treats a large out-of-scope spread. Framework-extracted contracts may
 * be under-specified (`adaptive`); a directly authored `.anatrace.yaml only_edit` is `strict`.
 */
export type FileScopeDeviationHandling = 'adaptive' | 'strict';

/** Fields every claim carries regardless of kind. */
interface ClaimBase {
  /** Stable, human-meaningful — the join key to verdicts/proof-chain. */
  id: string;
  /** Human-readable obligation, verbatim from the source where possible. */
  says: string;
  /**
   * Identity axis (WHO), independent from `scope` (WHEN). Omitted preserves the legacy flat
   * session union; all new policy loaders and migrated adapters emit an explicit subject.
   */
  subject?: ClaimSubject;
  scope: ClaimScope;
  source: ClaimSource;
  /**
   * RESERVED + USED: the `superpowers` adapter emits `'low'` on nested/overlapping windows →
   * `unverifiable`. EXCLUDED from the C5 coverage NUMERATOR (it stays in the denominator).
   */
  confidence?: 'low' | 'high';
  /**
   * DECLARED obligation strength (D-A / D-D). ABSENT ⇒ `optional` (byte-identical to today —
   * the no-strength path never produces a `violated`). Only `required`/`forbidden` flip the
   * absence/presence arms. See {@link ClaimStrength}.
   */
  strength?: ClaimStrength;
  /** File-scope-only; absent preserves the legacy adaptive MASS-finding behavior. */
  deviationHandling?: FileScopeDeviationHandling;
}

/**
 * An `intent` claim: the ONLY kind that FORBIDS a predicate. `predicate?: never` makes a
 * predicate-carrying `intent` claim a compile error — half of the boundary type-invariant.
 */
export interface IntentClaim extends ClaimBase {
  kind: 'intent';
  predicate?: never;
}

/**
 * Every non-`intent` claim. `predicate` is OPTIONAL: present ⇒ checked model-free (D);
 * absent ⇒ routes to the LLM (E). There is deliberately NO verdict/result field here — the
 * E2 guard. (The boundary lives in the DATA: predicate-present vs predicate-absent.)
 */
export interface CheckableClaim extends ClaimBase {
  kind: Exclude<ClaimKind, 'intent'>;
  predicate?: ClaimPredicate;
}

/**
 * One claim of a mandate. The boundary is a FIELD: an `IntentClaim` cannot carry a predicate;
 * a `CheckableClaim` may or may not. Neither variant can carry an LLM-result field (the E2
 * guard — type-impossible by construction).
 */
export type MandateClaim = IntentClaim | CheckableClaim;

/**
 * A framework-agnostic mandate: the typed declaration extracted by a `MandateAdapter`. Net
 * fills the prior `claims: unknown[]` stub.
 */
export interface Mandate {
  schemaVersion: number;
  framework: string;
  claims: MandateClaim[];
}

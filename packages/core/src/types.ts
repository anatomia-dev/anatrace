import type { NormalizedSession } from './session.js';
import type { NamedBlob } from './adapter.js';
import type { Mandate } from './mandate.js';

export type { Mandate } from './mandate.js';

/**
 * Active severity = the configurable gate level (ESLint-style). The level lives in
 * {@link Config}, never baked into a {@link Rule}. Maps to SARIF note/warning/error
 * + exit codes.
 *
 * NOTE: this is the *gate* axis. Anatomia's risk|debt|observation is a finding
 * *nature*, carried in finding metadata — a different axis (do not conflate).
 */
export type Severity = 'off' | 'info' | 'warn' | 'error';

/**
 * A finding emitted by a rule. `location.file` is populated where a friction finding
 * maps to an edit target; `location.line` is UNPOPULATED in R2 (only the deferred AST
 * rule emits line numbers — REQ Item 6). `fingerprint?` is DEFERRED (Action-pass only).
 */
export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  /** Shape locked; `line` unpopulated in R2. */
  location?: { file: string; line?: number };
}

/** @experimental Opaque marker; do NOT pre-spec a bytes payload (REQ Item 5). */
export interface RepoSnapshot {
  schemaVersion: number;
}
/**
 * @experimental A framework mandate extractor — symmetric to
 * {@link import('./adapter.js').Adapter} (`detect`/`parse`). C2 double-fix:
 *  - `detect(group)` takes a `NamedBlob[]` (a single blob cannot carry a multi-file mandate).
 *  - `extract(group) → Mandate | null` is added — degrade-to-null, NEVER throws.
 *
 * `extract` stays PURE: it reads only the bytes in `group`. The on-disk content a predicate
 * references arrives via the injected {@link ContentResolver} at D, NEVER at extract.
 *
 * Reshaped safely on its `@experimental` marker (no known external implementor); it is a
 * published type, so the justification is `@experimental`, not "zero callers".
 */
export interface MandateAdapter {
  framework: string;
  detect(group: NamedBlob[]): boolean;
  extract(group: NamedBlob[]): Mandate | null;
}

/**
 * @experimental A parsed syntax tree. OPAQUE to core — the injected parser owns the
 * concrete shape (tree-sitter `Tree` at the CLI; a browser WASM tree in Cracked). Core
 * never inspects it structurally, so it stays `unknown` here. Reserved for Phase C+.
 */
export type Tree = unknown;

/**
 * @experimental Syntax-tree parser capability — injected by the CLI, never imported by
 * core. Transport-agnostic: a Node tree-sitter parser AND a browser WASM parser both
 * satisfy it (no Node/fs in the signature). Reserved for Phase C+.
 */
export interface ParserCapability {
  parse(src: string): Tree;
}

/**
 * @experimental A content source (B4): full bytes of a file path, or `null` when unknown.
 * INJECTABLE — disk is ONE impl (the CLI supplies it for live `--last` / a PR checkout);
 * the in-core `transcriptContentResolver` is the browser/no-disk impl. Core NEVER calls fs
 * inline — content arrives through this seam.
 */
export type ContentResolver = (path: string) => Uint8Array | null;

import type { JudgeInput as JudgeInputT, JudgeVerdict as JudgeVerdictT } from './hook.js';

/**
 * @experimental Phase-E judge input — the bounded, scrubbed dossier SLICE (NOT the transcript;
 * the cost lever). D-HOOK reshapes the prior `unknown` placeholder into a concrete frozen
 * interface (licensed by the `@experimental` marker + a byte-verified ZERO external implementor —
 * crack3d has 0 `JudgeInput`/`JudgeOutput` hits). The judge IMPL is injected at the CLI in E;
 * core only declares the type.
 */
export type JudgeInput = JudgeInputT;
/**
 * @experimental Phase-E judge output — the type-DISJOINT `JudgeVerdict` (`source:'llm'`,
 * `rationale`, `model`, NO `severity`). Literal-discriminant vs `ComplianceVerdict
 * {source:'deterministic'}` so the deterministic channel can never leak prose.
 */
export type JudgeOutput = JudgeVerdictT;
/**
 * @experimental The user's LLM judge — a function TYPE in core; the impl is injected at
 * the CLI (Phase E/E1), NEVER named or imported here. Adjudicates ONLY the `unverifiable`
 * residue. Async-friendly. This is the SAME injected-capability idiom as
 * `computeCost(tokens, model, { priceTable })` (pricing.ts) and the `Adapter`.
 */
export type JudgeFn = (input: JudgeInput) => JudgeOutput | Promise<JudgeOutput>;

/**
 * @experimental The capability channel (A4): ONE seam carrying MULTIPLE injected
 * capabilities. The CLI wires the impls; core only declares the function types, so the
 * `dependencies:{}` + purity wall holds and the seam is transport-agnostic (browser WASM
 * parser + browser LLM both satisfy it). Nothing in A+B injects or consumes these — the
 * seam is the deliverable; the parser impl lands at C+, the judge at E.
 */
export interface Capabilities {
  /** Syntax-tree parser (tree-sitter at the CLI; WASM in the browser). Reserved for Phase C+. */
  parser?: ParserCapability;
  /** The user's LLM judge — adjudicates only the `unverifiable` residue. Reserved for Phase E. */
  judge?: JudgeFn;
  /** File-content source (B4): disk impl from the CLI, or the in-core transcript impl. */
  contentResolver?: ContentResolver;
}

/**
 * The evidence a rule evaluates over. `mandate`/`repo` are optional → tier-1 rules ignore
 * them. `capabilities` is the A4 injection channel (parser + judge) — also optional, also
 * ignored by tier-1 rules; impls injected by the CLI, never by core.
 */
export interface EvalContext {
  session: NormalizedSession;
  mandate?: Mandate;
  repo?: RepoSnapshot;
  capabilities?: Capabilities;
}

/** Config-resolved per-rule settings (the deferred thrash rule's `N` etc. live here). */
export type RuleOptions = Record<string, unknown>;

/** One rule. `defaultSeverity` is a default; active severity is config-driven. */
export interface Rule {
  id: string;
  pack: string;
  meta: { docs?: string; rationale?: string };
  defaultSeverity: Severity;
  evaluate(ctx: EvalContext, opts?: RuleOptions): Finding[];
}

/**
 * One rule's config entry: a bare active severity, or `[severity, options]`. `off`
 * disables the rule. Mirrors ESLint's `rules` value grammar.
 */
export type RuleSetting = Severity | [Severity, RuleOptions];

/**
 * ESLint-shaped config — DATA IN, nothing else. Core reads NO disk: the CLI does
 * discovery (A3) and hands a resolved `Config` to {@link import('./analyze.js').analyze}.
 * `extends` defaults to `['recommended']` (friction ONLY) when unset, so the no-config path
 * is byte-identical to R2. Compliance is OPT-IN — a SEPARATE `compliance` pack, NEVER unioned
 * into `recommended` (D-CONFIG; OQ-D10 resolved).
 *
 * @remarks The harness extensions (`mandates`/`claims`/`judge`) are DECLARED here but
 *   reserved for Phases C–E; `judge` is CONFIG ONLY (model + prompt) — the judge IMPL is
 *   injected at the CLI as a capability (A4/E1), NEVER named or imported in core.
 */
export interface Config {
  schemaVersion: number;
  /** Pack resolution. `recommended` = friction ONLY; `compliance` is a SEPARATE opt-in pack (D-CONFIG). */
  extends?: string[];
  /**
   * Per-rule overrides. Keys are rule ids OR the reserved `plugin:ns/id` grammar
   * (namespaced plugin rules — grammar reserved now, the loader is deferred). Value is a
   * bare severity or `[severity, options]`; `off` disables the rule.
   */
  rules?: Record<string, RuleSetting>;
  /** Suppression subset: drop findings whose `location.file` is at/under an ignore path. */
  ignores?: string[];
  /** @experimental Mandate-source selection (framework ids) — reserved for Phase C. */
  mandates?: string[];
  /** @experimental Claim-kind selection — reserved for Phase C/D. */
  claims?: string[];
  /** @experimental LLM-judge config ONLY (model + prompt); impl injected at CLI (Phase E). */
  judge?: { model: string; prompt?: string };
}

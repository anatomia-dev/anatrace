import type { NormalizedSession } from './session.js';

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

/** @experimental Declared, ZERO implementations in R2 (REQ Item 5 — lock the seam). */
export interface Mandate {
  schemaVersion: number;
  framework: string;
  claims: unknown[];
}
/** @experimental Opaque marker; do NOT pre-spec a bytes payload (REQ Item 5). */
export interface RepoSnapshot {
  schemaVersion: number;
}
/** @experimental Symmetric to {@link import('./adapter.js').Adapter}; no impl in R2. */
export interface MandateAdapter {
  framework: string;
  detect(bytes: Uint8Array): boolean;
}

/** The evidence a rule evaluates over. `mandate`/`repo` are optional → tier-1 rules ignore them. */
export interface EvalContext {
  session: NormalizedSession;
  mandate?: Mandate;
  repo?: RepoSnapshot;
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

/** @experimental ESLint-shaped config (extends/severity overrides land later). */
export interface Config {
  schemaVersion: number;
}

/**
 * Active severity = the configurable gate level (ESLint-style). The level lives in
 * {@link Config}, never baked into a {@link Rule}. Maps to SARIF note/warning/error
 * + exit codes.
 *
 * NOTE: this is the *gate* axis. Anatomia's risk|debt|observation is a finding
 * *nature*, carried in finding metadata — a different axis (do not conflate).
 */
export type Severity = 'off' | 'info' | 'warn' | 'error';

/** @experimental One normalized agent session — the shared object every adapter yields. */
export interface NormalizedSession {
  /** In-band compat signal; the real stability contract (Runbook 2 evolves the body). */
  schemaVersion: number;
}

/** @experimental Harness adapter. Raw bytes in (keeps core pure), one session out. */
export interface Adapter {
  harness: string;
  detect(bytes: Uint8Array): boolean;
  parse(bytes: Uint8Array): NormalizedSession;
}

/** @experimental A finding emitted by a rule. */
export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
}

/** @experimental One rule. `defaultSeverity` is a default; active severity is config-driven. */
export interface Rule {
  id: string;
  pack: string;
  meta: { docs?: string; rationale?: string };
  defaultSeverity: Severity;
  evaluate(session: NormalizedSession, opts?: Record<string, unknown>): Finding[];
}

/** @experimental Run output envelope. */
export interface Report {
  schemaVersion: number;
  findings: Finding[];
}

/** @experimental ESLint-shaped config (extends/severity overrides land in Runbook 2). */
export interface Config {
  schemaVersion: number;
}

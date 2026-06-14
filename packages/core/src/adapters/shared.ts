import type { NormalizedSession, SessionEvent, SubagentMeta, Harness } from '../session.js';
import type { ProvenanceCounts } from '../provenance.js';
import { canonicalSort } from '../order.js';
import { deriveCounts } from '../derive.js';

export const SCHEMA_VERSION = 1;

/** Safe string read from an untyped line object (boundary discipline — never throws). */
export function rStr(o: Record<string, unknown> | undefined, k: string): string {
  const v = o ? o[k] : undefined;
  return typeof v === 'string' ? v : '';
}

/** Safe finite-number read. `0` when absent/non-number. */
export function rNum(o: Record<string, unknown> | undefined, k: string): number {
  const v = o ? o[k] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Safe nested-object read. `undefined` when absent/non-object/array. */
export function rObj(
  o: Record<string, unknown> | undefined,
  k: string,
): Record<string, unknown> | undefined {
  const v = o ? o[k] : undefined;
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Safe array read. `[]` when absent/non-array. */
export function rArr(o: Record<string, unknown> | undefined, k: string): unknown[] {
  const v = o ? o[k] : undefined;
  return Array.isArray(v) ? v : [];
}

/** Deterministic epoch-ms parse of an ISO timestamp string; `undefined` when absent/unparseable. */
export function parseTs(iso: string): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso); // parses input — NOT a clock read
  return Number.isNaN(ms) ? undefined : ms;
}

function zeroCounts(): ProvenanceCounts {
  return {
    tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0 },
    price_table_version: '',
    derive_version: '',
    duration_ms: 0,
    turns: 0,
    tool_calls: 0,
    commands_run: 0,
    tests_executed: 0,
    failures_encountered: 0,
    files_touched: 0,
    model: '',
  };
}

/**
 * Canonically order the events (core re-sorts defensively, Item 9) and attach the pure
 * `deriveCounts` projection. The single assembly path both adapters share.
 */
export function assembleSession(
  harness: Harness,
  sessionId: string,
  observedVersions: string[],
  subagents: SubagentMeta[],
  events: SessionEvent[],
  // P0.6 — per-parse health captured SYNCHRONOUSLY by the adapter at end-of-parse (NOT read from the
  // module-level `capabilities` singleton later — a second parse() would overwrite it). Omitted for
  // synthetic/hand-built sessions, which are treated as healthy.
  health?: { tokenTotalSuspect: boolean; inputNonEmpty: boolean },
): NormalizedSession {
  const ordered = canonicalSort(events);
  const session: NormalizedSession = {
    schemaVersion: SCHEMA_VERSION,
    harness,
    sessionId,
    observedVersions,
    subagents,
    events: ordered,
    counts: zeroCounts(),
    ...(health
      ? {
          parseHealth: {
            tokenTotalSuspect: health.tokenTotalSuspect,
            structuredEventCount: ordered.length,
            inputNonEmpty: health.inputNonEmpty,
          },
        }
      : {}),
  };
  session.counts = deriveCounts(session);
  return session;
}

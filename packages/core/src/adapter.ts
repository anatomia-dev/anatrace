import type { NormalizedSession, Harness } from './session.js';

/** A session group: named byte-blobs. Name = stable, discovery-order-independent relative path. */
export interface NamedBlob {
  name: string;
  bytes: Uint8Array;
}

/** Capability record — makes a 0 intentional-not-missing (REQ Item 2). */
export interface AdapterCapabilities {
  supportsCacheCreate: boolean; // codex=false
  /** set true if a message.id's per-line total ever DECREASES (monotonicity canary, Item 3). */
  tokenTotalSuspect: boolean;
}

export interface Adapter {
  harness: Harness;
  detect(bytes: Uint8Array): boolean; // bounded: first line / first-N-bytes
  parse(group: NamedBlob[]): NormalizedSession | null; // never throws; degrade-to-null
  capabilities: AdapterCapabilities;
}

// NAVIGATOR-CORRECTED (round 3): pure core sets `types: []` (no DOM/node libs) + `lib: ["ES2022"]`,
// under which `new TextDecoder()` errors `TS2304: Cannot find name 'TextDecoder'` (reproduced) — which
// would red CI's `typecheck` required check. Declare it minimally so it typechecks WITHOUT a DOM lib
// (DOM would reintroduce fetch/window and trip the purity wall). Verified: this ambient compiles clean.
declare const TextDecoder: {
  new (label?: string): { decode(input?: Uint8Array): string };
};

/** Decode UTF-8 bytes to a string, stripping a leading BOM. Never throws. */
function decodeUtf8(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // BOM strip (REQ Item 2 — defensive)
}

/** Shared JSONL line reader: strip a leading BOM, split, skip malformed lines, never throw. */
export function readJsonlLines(bytes: Uint8Array): Record<string, unknown>[] {
  const text = decodeUtf8(bytes);
  const out: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object') out.push(o as Record<string, unknown>);
    } catch {
      /* skip malformed; never throw */
    }
  }
  return out;
}

/** Parse whole-file JSON (e.g. a pretty-printed `agent-*.meta.json` sidecar). `null` on any failure. */
export function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const o = JSON.parse(decodeUtf8(bytes));
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

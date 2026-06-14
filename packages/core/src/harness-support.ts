import type { Harness } from './session.js';

/**
 * P0.6 — the COARSE catastrophic-floor of supported harness MAJOR versions.
 *
 * This is the ONLY place the supported range lives. It is NOT a per-version allowlist and NOT a
 * trust signal: being "within range" means "plausibly the shape I know," NEVER "validated." It
 * catches only a harness that drifted a WHOLE MAJOR (a format anatrace has never seen). Within-range
 * format drift — e.g. the CC `toolUseId` sidecar field that appeared INSIDE 2.1.x — is caught
 * STRUCTURALLY by `parseHealth` / the absence gate (`session-parse-suspect`), NEVER here.
 *
 * Edit this table ONLY on a major harness bump (a rare event), not when a minor ships.
 */
const SUPPORTED_MAJOR: Record<Harness, { min: number; maxExclusive: number }> = {
  claude: { min: 2, maxExclusive: 3 }, // Claude Code 2.x
  codex: { min: 0, maxExclusive: 1 }, // Codex 0.x
};

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Parse the leading `major.minor[.patch]` integers from a version string; `null` if unparseable. */
export function parseSemver(v: string): Semver | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: m[3] ? Number(m[3]) : 0 };
}

export type HarnessVersionStatus = 'recognized' | 'out-of-range' | 'absent';

/**
 * Classify the harness version against the catastrophic-floor.
 *  - `out-of-range` — a PARSEABLE version whose major is outside the supported band (a whole-major
 *    drift). This is the ONLY status that GATES a verdict to `unverifiable(harness-version-unrecognized)`.
 *  - `absent` — no parseable version string. Surfaced as a breadcrumb but NOT gated: a version-less
 *    session that still parsed to real events is not proof of misparse (that is the parse-suspect
 *    signal's job), and gating on `absent` would falsely abstain on every synthetic/version-less
 *    session.
 *  - `recognized` — every parseable version is within the supported major band.
 */
export function harnessVersionStatus(
  harness: Harness,
  observedVersions: readonly string[] | undefined,
): HarnessVersionStatus {
  const range = SUPPORTED_MAJOR[harness];
  if (!range) return 'recognized'; // an unknown harness has no floor to violate
  const parsed = (observedVersions ?? []).map(parseSemver).filter((v): v is Semver => v !== null);
  if (parsed.length === 0) return 'absent';
  for (const v of parsed) {
    if (v.major < range.min || v.major >= range.maxExclusive) return 'out-of-range';
  }
  return 'recognized';
}

/**
 * Is at least one observed version `>= floor`? Used for feature-presence guards — e.g. the CC
 * `toolUseId` delegate-sidecar field did NOT exist at or below 2.1.90, so its absence on an older
 * session must not be read as a missing dispatch link. Unparseable/absent → `false` (treat the
 * feature as NOT expected — the conservative choice; never accuse on an unknown version).
 */
export function harnessVersionAtLeast(
  observedVersions: readonly string[] | undefined,
  floor: string,
): boolean {
  const f = parseSemver(floor);
  if (!f) return false;
  for (const raw of observedVersions ?? []) {
    const v = parseSemver(raw);
    if (!v) continue;
    if (v.major !== f.major) {
      if (v.major > f.major) return true;
      continue;
    }
    if (v.minor !== f.minor) {
      if (v.minor > f.minor) return true;
      continue;
    }
    if (v.patch >= f.patch) return true;
  }
  return false;
}

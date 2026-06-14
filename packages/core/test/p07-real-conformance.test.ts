/**
 * P0.7 (Phase 0, Step 7) — version-stamped conformance over real-FORMAT fixtures.
 *
 * Two corpora, both read here:
 *  1. `fixtures/real/<harness>@<version>/` — COMMITTED, real-FORMAT / synthetic-CONTENT. The wire
 *     shape (keys, event types, version strings) is transcribed verbatim from real transcripts; only
 *     the VALUES (commands, paths) are safe placeholders. This is the regression guard against the
 *     KNOWN format (the class of the `cmd`-key bug) and is safe on a PUBLIC repo.
 *  2. `fixtures/real-local/<harness>@<version>/` — GITIGNORED, true ground truth. Read WHEN PRESENT,
 *     skipped otherwise. This is the periodic check against UNKNOWN drift; it is never pushed.
 *
 * The conformance contract: every real-format fixture parses to a non-trivial, version-RECOGNIZED,
 * parse-HEALTHY session — and the Codex force-push fixture (real `cmd` key) yields `violated` for a
 * forbidden `git push --force` (Step 3's headline exit criterion, proven on the real key shape).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSession, verdictForClaim, harnessVersionStatus } from 'anatrace-core';
import type { Harness, CheckableClaim } from 'anatrace-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMITTED = path.join(here, 'fixtures', 'real');
const LOCAL = path.join(here, 'fixtures', 'real-local');

interface RealFixture {
  harness: Harness;
  version: string;
  dirName: string;
  parentBytes: Uint8Array;
  origin: 'committed' | 'local';
}

function loadCorpus(root: string, origin: 'committed' | 'local'): RealFixture[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // absent corpus (the gitignored local one on a fresh checkout / CI)
  }
  const out: RealFixture[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.includes('@')) continue;
    const [harness, version] = e.name.split('@');
    const parentPath = path.join(root, e.name, 'parent.jsonl');
    if (!fs.existsSync(parentPath)) continue;
    out.push({
      harness: harness as Harness,
      version: version!,
      dirName: e.name,
      parentBytes: new Uint8Array(fs.readFileSync(parentPath)),
      origin,
    });
  }
  return out.sort((a, b) => a.dirName.localeCompare(b.dirName));
}

const committed = loadCorpus(COMMITTED, 'committed');
const local = loadCorpus(LOCAL, 'local');
const all = [...committed, ...local];

function forbiddenCommandClaim(value: string): CheckableClaim {
  return {
    id: `cmd:${value}`,
    says: `must not run ${value}`,
    kind: 'command-run',
    scope: { kind: 'whole-session' },
    source: { kind: 'in-blob', blob: 'agents/ana-verify.md', fidelity: 'verbatim' },
    predicate: { target: 'command-content', matcher: 'not_contains', scope: 'transcript', value },
  };
}

describe('P0.7 — real-format conformance (committed skeletons + local corpus if present)', () => {
  it('has at least the committed claude + codex skeletons', () => {
    expect(committed.length).toBeGreaterThanOrEqual(2);
    expect(committed.some((f) => f.harness === 'codex')).toBe(true);
    expect(committed.some((f) => f.harness === 'claude')).toBe(true);
  });

  if (local.length === 0) {
    it('local real corpus absent → skipped (committed skeletons still gate)', () => {
      expect(local.length).toBe(0); // documents the skip; CI/public sees only committed fixtures
    });
  }

  // The property-style contract, run over every fixture in BOTH corpora.
  for (const f of all) {
    describe(`${f.origin}: ${f.dirName}`, () => {
      const session = parseSession([{ name: 'parent', bytes: f.parentBytes }], f.harness);

      it('parses to a non-trivial session', () => {
        expect(session).not.toBeNull();
        expect(session!.harness).toBe(f.harness);
        expect(session!.events.length).toBeGreaterThan(0);
      });

      it('extracts the stamped version and recognizes it (not catastrophic drift)', () => {
        expect(session!.observedVersions).toContain(f.version);
        expect(harnessVersionStatus(f.harness, session!.observedVersions)).toBe('recognized');
      });

      it('is parse-healthy (no token-monotonicity break, non-zero structured events)', () => {
        expect(session!.parseHealth).toBeDefined();
        expect(session!.parseHealth!.tokenTotalSuspect).toBe(false);
        expect(session!.parseHealth!.structuredEventCount).toBeGreaterThan(0);
        expect(session!.parseHealth!.inputNonEmpty).toBe(true);
      });
    });
  }

  it('the Codex real-`cmd` fixture yields VIOLATED for a force-push (Step 3 exit criterion, real key)', () => {
    const fx = committed.find((f) => f.harness === 'codex');
    expect(fx).toBeDefined();
    const session = parseSession([{ name: 'parent', bytes: fx!.parentBytes }], 'codex');
    expect(session).not.toBeNull();
    const v = verdictForClaim(forbiddenCommandClaim('git push --force'), session!);
    expect(v).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
  });
});

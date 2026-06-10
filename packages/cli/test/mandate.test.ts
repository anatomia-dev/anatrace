import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mandateShow, renderMandate } from '../src/mandate.js';
import { coverageStat } from 'anatrace-core';
import type { Mandate } from 'anatrace-core';

const here = path.dirname(fileURLToPath(import.meta.url));
// The committed framework-source slices + the hand-authored mandate fixtures live in core's tests.
const CORE_FIX = path.join(here, '..', '..', 'core', 'test', 'fixtures');
const SRC = path.join(CORE_FIX, 'framework-src');
const MANDATES = path.join(CORE_FIX, 'mandates');

describe('C5 — `anatrace mandate show` end-to-end (extract → render → coverage)', () => {
  it('anatomia source slice: extracts 7 claims and prints an EXACT 5 of 7', () => {
    const res = mandateShow(path.join(SRC, 'anatomia'));
    expect(res.ok).toBe(true);
    expect(res.message).toContain('mandate — anatomia (7 claim(s))');
    // EXACT X/Y — a wrong denominator (collapsing the 2 runtime contract-matchers) would fail.
    expect(res.message).toContain(
      'anatrace mechanically checks 5 of 7 declared obligations on this transcript; the rest route to your model.',
    );
  });

  it('superpowers source slice: confidence:low dispatch excluded → EXACT 1 of 2', () => {
    const res = mandateShow(path.join(SRC, 'superpowers'));
    expect(res.ok).toBe(true);
    expect(res.message).toContain(
      'anatrace mechanically checks 1 of 2 declared obligations on this transcript; the rest route to your model.',
    );
  });

  it('errors cleanly on a non-mandate directory', () => {
    const res = mandateShow(path.join(here)); // the CLI test dir — no mandate source
    expect(res.ok).toBe(false);
  });
});

describe('C5 — EXACT X/Y on the low-yield spec-kit fixture (KNOWN composition)', () => {
  it('renders an EXACT 1 of 5 (runtime/intent/tdd/task-completed kept in denominator)', () => {
    const m = JSON.parse(
      fs.readFileSync(path.join(MANDATES, 'spec-kit-lowyield.mandate.json'), 'utf8'),
    ) as Mandate;
    expect(coverageStat(m)).toEqual({ checkable: 1, total: 5 });
    const out = renderMandate(m);
    expect(out).toContain(
      'anatrace mechanically checks 1 of 5 declared obligations on this transcript; the rest route to your model.',
    );
  });
});

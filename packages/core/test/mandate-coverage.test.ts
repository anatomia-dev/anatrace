import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageStat, renderCoverageLine } from '../src/mandate-coverage.js';
import type { Mandate } from '../src/mandate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MANDATES = path.join(here, 'fixtures', 'mandates');
const read = (n: string): Mandate => JSON.parse(fs.readFileSync(path.join(MANDATES, n), 'utf8'));

describe('C5 — predicate coverage stat (per-claim; runtime + confidence excluded from numerator)', () => {
  it('low-yield spec-kit fixture: EXACT 1 of 5 (runtime/intent/tdd/task-completed stay in denominator)', () => {
    const stat = coverageStat(read('spec-kit-lowyield.mandate.json'));
    expect(stat).toEqual({ checkable: 1, total: 5 });
    expect(renderCoverageLine(stat)).toBe(
      'anatrace mechanically checks 1 of the 5 obligations it could structurally recognize on this transcript; obligations it could not recognize (and the rest) route to your model.',
    );
  });

  it('anatomia fixture: transcript claims counted, runtime contract-matchers EXCLUDED from numerator but KEPT in denominator', () => {
    const m = read('anatomia.mandate.json');
    const stat = coverageStat(m);
    // 7 claims total: 2 skill-invoked + 1 human-constraint + 2 file-scope = 5 transcript; 2 runtime.
    expect(stat.total).toBe(7);
    expect(stat.checkable).toBe(5);
    // A wrong denominator (collapsing runtime out) would give 5/5 — the overstatement we forbid.
    expect(stat.total).not.toBe(stat.checkable);
  });

  it('confidence:low is EXCLUDED from the numerator but KEPT in the denominator (superpowers dispatch)', () => {
    const m = read('superpowers.mandate.json');
    const stat = coverageStat(m);
    // 2 claims: skill-announced (transcript, no confidence → counted) + dispatch
    // (transcript predicate BUT confidence:'low' → unverifiable → excluded from numerator).
    expect(stat.total).toBe(2);
    expect(stat.checkable).toBe(1);
  });
});

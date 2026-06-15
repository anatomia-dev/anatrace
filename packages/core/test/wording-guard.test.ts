/**
 * N4/Tier-3 — the WORDING-SWEEP grep guard. The dossier demotion makes "zero-LLM" a SURFACE property,
 * not just a runtime one — but the `Config.judge`/`adjudicate` seam still EXISTS internally, so any
 * unqualified "no LLM anywhere" claim in user-facing prose is a tell a careful reader turns against us.
 * This guard makes the sweep MECHANICAL and complete: a half-done state (one stale absolute claim while
 * the seam is discoverable in source) can't regress, and it forward-covers the N5 essay (it lives in
 * `docs/`). It is deliberately NARROW — it polices user-facing MARKDOWN, never in-context code comments
 * (which are already scoped) — exactly the precision `03` calls for.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** User-facing markdown in scope (README + docs + package READMEs). */
function userFacingDocs(): string[] {
  const files = [
    path.join(REPO, 'README.md'),
    path.join(REPO, 'packages', 'core', 'README.md'),
    path.join(REPO, 'packages', 'cli', 'README.md'),
  ];
  const docsDir = path.join(REPO, 'docs');
  if (fs.existsSync(docsDir)) {
    for (const e of fs.readdirSync(docsDir)) if (e.endsWith('.md')) files.push(path.join(docsDir, e));
  }
  return files.filter((f) => fs.existsSync(f));
}

// Absolute "no LLM anywhere"-class claims — FORBIDDEN outright (the seam exists internally).
const FORBIDDEN = [
  /no llm anywhere/i,
  /100% no[- ]llm/i,
  /never uses an llm/i,
  /without any llm/i,
  /no llm at all/i,
  /zero[- ]llm anywhere/i,
  /no llm involved/i,
  /entirely llm-free/i,
];

// A "zero-LLM" claim is OK only when scoped to the verdict path/surface (or the accurate grading/dep facts).
const SCOPING = /verdict path|verdict surface|published|grades? the llm|dependency|residue|never gates?|opt-in|byte-reproducible/i;

/** Split into paragraphs (blank-line separated) so a scoped claim wrapped across lines isn't a false hit. */
function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/);
}

describe('N4 — wording-sweep grep guard (zero-LLM claims stay scoped to the published verdict path)', () => {
  it('no user-facing doc makes an absolute "no LLM anywhere" claim', () => {
    const offenders: string[] = [];
    for (const file of userFacingDocs()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const re of FORBIDDEN) if (re.test(text)) offenders.push(`${path.basename(file)}: matches ${re}`);
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });

  it('every "zero-LLM" claim is SCOPED (to the published verdict path / surface), never bare', () => {
    const offenders: string[] = [];
    for (const file of userFacingDocs()) {
      for (const para of paragraphs(fs.readFileSync(file, 'utf8'))) {
        if (/zero[- ]llm/i.test(para) && !SCOPING.test(para)) {
          offenders.push(`${path.basename(file)}: unscoped "zero-LLM" → ${para.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });
});

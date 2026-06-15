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

/**
 * Every user-facing TEXT in scope: not just markdown, but the surfaces a reader/consumer actually sees —
 * the Action manifest, the CLI `--help` description, the release notes (CHANGELOGs + the pending
 * changesets that become them). The earlier README-only guard was defeatable by exactly these gaps.
 */
function userFacingTexts(): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  const add = (p: string): void => {
    if (fs.existsSync(p)) out.push({ name: path.relative(REPO, p), text: fs.readFileSync(p, 'utf8') });
  };
  // Markdown: README + package READMEs + docs/.
  add(path.join(REPO, 'README.md'));
  for (const pkg of ['core', 'cli', 'action']) {
    add(path.join(REPO, 'packages', pkg, 'README.md'));
    add(path.join(REPO, 'packages', pkg, 'CHANGELOG.md'));
  }
  const docsDir = path.join(REPO, 'docs');
  if (fs.existsSync(docsDir)) {
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) add(p);
      }
    };
    walk(docsDir);
  }
  // The Action manifest (consumer-facing metadata).
  add(path.join(REPO, 'packages', 'action', 'action.yml'));
  // The pending release notes (the changesets that become the next CHANGELOG).
  const csDir = path.join(REPO, '.changeset');
  if (fs.existsSync(csDir)) {
    for (const e of fs.readdirSync(csDir)) if (e.endsWith('.md') && e !== 'README.md') add(path.join(csDir, e));
  }
  // The CLI `--help` description string (extracted — we police the help text, not all code comments).
  const cli = path.join(REPO, 'packages', 'cli', 'src', 'index.ts');
  if (fs.existsSync(cli)) {
    const m = /\.description\(\s*(['"`])([\s\S]*?)\1\s*\)/.exec(fs.readFileSync(cli, 'utf8'));
    if (m) out.push({ name: 'cli --help', text: m[2]! });
  }
  return out;
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
// A zero-LLM claim is OK when it sits near verdict/surface/published/quarantine language (the legitimate
// scopings) — the absolute "no LLM anywhere" class is caught separately by FORBIDDEN, strictly.
const SCOPING = /verdict|surface|published|grades? the llm|dependency|residue|never gates?|opt-in|byte-reproducible|quarantin/i;

/** Split into paragraphs (blank-line separated) so a scoped claim wrapped across lines isn't a false hit. */
function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/);
}

describe('N4 — wording-sweep grep guard (zero-LLM claims stay scoped to the published verdict path)', () => {
  it('no user-facing surface makes an absolute "no LLM anywhere" claim (README / docs / action.yml / CLI --help / CHANGELOGs / changesets)', () => {
    const offenders: string[] = [];
    for (const { name, text } of userFacingTexts()) {
      for (const re of FORBIDDEN) if (re.test(text)) offenders.push(`${name}: matches ${re}`);
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });

  it('every "zero-LLM" claim is SCOPED (to the published verdict path / surface), never bare', () => {
    const offenders: string[] = [];
    for (const { name, text } of userFacingTexts()) {
      for (const para of paragraphs(text)) {
        if (/zero[- ]llm/i.test(para) && !SCOPING.test(para)) {
          offenders.push(`${name}: unscoped "zero-LLM" → ${para.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });
});

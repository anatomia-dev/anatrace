/**
 * P0.3 (Phase 0, Step 4) — feeders fail LOUD. A drifted/garbage framework source must yield a
 * VISIBLE, typed extraction gap, never a silent omission or a flattering empty result.
 *
 * The diagnostics are deterministic and bounded: they fire ONLY on markers the adapter already
 * recognizes as obligation-bearing (a reworded independence rule, an unparsed `skills:` block, a
 * superpowers `Iron Law`, or a detected-but-empty framework). The coverage DENOMINATOR is unchanged
 * (= extracted claims) — we never inject an unrecognized-prose count (circular + non-deterministic).
 */
import { describe, it, expect } from 'vitest';
import { anatomiaAdapter } from '../src/adapters/anatomia.js';
import { superpowersAdapter } from '../src/adapters/superpowers.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const blob = (name: string, body: string) => [{ name, bytes: enc(body) }];

describe('P0.3 — anatomia adapter surfaces extraction gaps instead of dropping them', () => {
  it('a CLEAN verify agent (independence intact, inline skills) yields NO diagnostics (omitted)', () => {
    const def = [
      '---', 'name: ana-verify', 'skills: [testing-standards]', '---',
      '# AnaVerify',
      'You never read the build report.',
      'You are read-only on the codebase. You do NOT fix code.',
    ].join('\n');
    const m = anatomiaAdapter.extract(blob('agents/ana-verify.md', def));
    expect(m).not.toBeNull();
    expect(m!.claims.length).toBeGreaterThan(0);
    expect(m!.diagnostics).toBeUndefined(); // clean output is byte-identical to before
  });

  it('a DRIFTED verify agent (independence reworded) surfaces verify-independence — partial loss is visible', () => {
    const def = [
      '---', 'name: ana-verify', 'skills: [testing-standards]', '---',
      '# AnaVerify',
      // independence reworded so INDEPENDENCE_RE ("never read … report") no longer matches:
      "You must not consult the builder's writeup before forming your own view.",
      'You are read-only on the codebase. You do NOT fix code.',
    ].join('\n');
    const m = anatomiaAdapter.extract(blob('agents/ana-verify.md', def));
    expect(m).not.toBeNull();
    // the skill claim still extracts — this is PARTIAL loss made visible, not total silence
    expect(m!.claims.some((c) => c.kind === 'skill-invoked')).toBe(true);
    const gap = m!.diagnostics?.find((d) => d.marker === 'verify-independence');
    expect(gap).toBeDefined();
    expect(gap!.kind).toBe('unextracted-marker');
  });

  it('a YAML block-list `skills:` (not inline) surfaces skills-frontmatter — every skill claim would have vanished', () => {
    const def = ['---', 'name: ana-build', 'skills:', '  - git-workflow', '  - testing-standards', '---', '# AnaBuild'].join('\n');
    const m = anatomiaAdapter.extract(blob('agents/ana-build.md', def));
    expect(m).not.toBeNull();
    expect(m!.diagnostics?.some((d) => d.marker === 'skills-frontmatter')).toBe(true);
  });

  it('a detected-but-empty agent-def → recognized-but-empty (not a silent null)', () => {
    const def = ['---', 'name: ana-build', '---', '# AnaBuild', 'lorem ipsum, nothing structural here'].join('\n');
    const m = anatomiaAdapter.extract(blob('agents/ana-build.md', def));
    expect(m).not.toBeNull();
    expect(m!.claims.length).toBe(0);
    expect(m!.diagnostics?.some((d) => d.kind === 'recognized-but-empty')).toBe(true);
  });

  it('a file we do NOT recognize as ours → still null (degrade-to-null contract preserved)', () => {
    const m = anatomiaAdapter.extract(blob('README.md', '# Just a readme, no agent def, no contract'));
    expect(m).toBeNull();
  });
});

describe('P0.3 — superpowers adapter surfaces the Iron Law it triggers on but cannot extract', () => {
  it('an Iron-Law-only skill → iron-law marker + recognized-but-empty, never a silent null', () => {
    const skill = ['---', 'name: brainstorming', '---', '# Brainstorming', 'The Iron Law: never write code while brainstorming.'].join(
      '\n',
    );
    const m = superpowersAdapter.extract(blob('skills/brainstorming/SKILL.md', skill));
    expect(m).not.toBeNull();
    expect(m!.claims.length).toBe(0);
    expect(m!.diagnostics?.some((d) => d.marker === 'iron-law')).toBe(true);
    expect(m!.diagnostics?.some((d) => d.kind === 'recognized-but-empty')).toBe(true);
  });

  it('a skill that DOES announce keeps its claim AND still flags a co-present Iron Law (partial)', () => {
    const skill = [
      '---', 'name: planning', '---', '# Planning',
      '**Announce at start:** "Using the planning skill"',
      'The Iron Law: never skip the plan.',
    ].join('\n');
    const m = superpowersAdapter.extract(blob('skills/planning/SKILL.md', skill));
    expect(m).not.toBeNull();
    expect(m!.claims.some((c) => c.kind === 'skill-announced')).toBe(true);
    expect(m!.diagnostics?.some((d) => d.marker === 'iron-law')).toBe(true);
  });
});

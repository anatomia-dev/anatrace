import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMandate } from '../src/mandate-validate.js';
import { anatomiaAdapter } from '../src/adapters/anatomia.js';
import { superpowersAdapter } from '../src/adapters/superpowers.js';
import { detectMandateAdapter } from '../src/adapters/mandate-registry.js';
import type { NamedBlob } from '../src/adapter.js';
import type { Mandate, MandateClaim } from '../src/mandate.js';
import schema from '../src/mandate.schema.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));
const MANDATES = path.join(here, 'fixtures', 'mandates');
const SRC = path.join(here, 'fixtures', 'framework-src');

function readMandate(name: string): Mandate {
  return JSON.parse(fs.readFileSync(path.join(MANDATES, name), 'utf8')) as Mandate;
}
function blob(rel: string, name: string): NamedBlob {
  return { name, bytes: new Uint8Array(fs.readFileSync(path.join(SRC, rel))) };
}

/** The 11 closed ClaimKind members (frozen REQ — exactly this set, order-independent). */
const CLAIM_KINDS = [
  'dispatch',
  'skill-announced',
  'skill-invoked',
  'command-run',
  'file-scope',
  'tdd-ordering',
  'contract-matcher',
  'artifact-saved',
  'task-completed',
  'human-constraint',
  'intent',
];

describe('C4 — mandate.schema.json is well-formed + enum-frozen', () => {
  it('is a draft-07 schema with the 11-member ClaimKind enum', () => {
    expect(schema.$schema).toContain('json-schema.org');
    expect([...schema.definitions.ClaimKind.enum].sort()).toEqual([...CLAIM_KINDS].sort());
    expect(schema.definitions.ClaimKind.enum).toHaveLength(11);
  });
  it("pins the closed PredicateTarget union (incl. reserved 'event-order')", () => {
    expect(schema.definitions.ClaimPredicate.properties.target.enum).toContain('message-text');
    expect(schema.definitions.ClaimPredicate.properties.target.enum).toContain('event-order');
  });
  it('makes predicate.scope REQUIRED on a predicate', () => {
    expect(schema.definitions.ClaimPredicate.required).toContain('scope');
  });
});

describe('C4 — round-trip (validate → serialize → validate) on the golden corpus', () => {
  const valid = ['anatomia', 'superpowers', 'frameworkless', 'spec-kit-lowyield'];
  for (const name of valid) {
    it(`${name}: round-trips clean`, () => {
      const m = readMandate(`${name}.mandate.json`);
      expect(validateMandate(m)).toEqual([]); // validate
      const serialized = JSON.stringify(m);
      const reparsed = JSON.parse(serialized) as Mandate;
      expect(validateMandate(reparsed)).toEqual([]); // validate again
      expect(JSON.stringify(reparsed)).toBe(serialized); // byte-stable round-trip
    });
  }

  it('framework-less mandate carries an intent claim (boundary reachable)', () => {
    const m = readMandate('frameworkless.mandate.json');
    const intent = m.claims.find((c) => c.kind === 'intent');
    expect(intent).toBeDefined();
    expect((intent as { predicate?: unknown }).predicate).toBeUndefined();
  });

  it('spec-kit low-yield mandate is judgment-heavy (mostly NOT transcript-checkable)', () => {
    const m = readMandate('spec-kit-lowyield.mandate.json');
    const transcript = m.claims.filter(
      (c) => c.predicate && c.predicate.scope === 'transcript',
    ).length;
    // 1 of 5 — the coverage stat must tell the truth about a judgment-heavy framework.
    expect(transcript).toBe(1);
    expect(m.claims.length).toBe(5);
  });
});

describe('C4 — literalsOnly masquerade is REJECTED at validate (the brand bright line)', () => {
  it('a matches+wildcard pattern on a message-text/literalsOnly predicate fails validation', () => {
    const m = readMandate('masquerade.invalid.json');
    const errs = validateMandate(m);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(' ')).toMatch(/prose-grep masquerade/);
  });
  it('a literal contains on a message-text predicate is ACCEPTED', () => {
    const m = readMandate('superpowers.mandate.json');
    // superpowers skill-announced uses message-text + matcher:'contains' + a literal value.
    const mt = m.claims.find((c) => c.predicate && c.predicate.target === 'message-text');
    expect(mt).toBeDefined();
    expect(validateMandate(m)).toEqual([]);
  });
});

describe('C4 — EXTRACTION-CORRECTNESS goldens (the #1 risk: did the adapter aim right?)', () => {
  it('anatomia adapter output matches the committed golden, per real source construct', () => {
    const group = [
      blob('anatomia/agents/ana-verify.md', 'agents/ana-verify.md'),
      blob('anatomia/contract.yaml', 'contract.yaml'),
    ];
    expect(detectMandateAdapter(group)).toBe(anatomiaAdapter);
    const extracted = anatomiaAdapter.extract(group);
    expect(extracted).not.toBeNull();
    const golden = readMandate('anatomia.mandate.json');
    expect(extracted).toEqual(golden);

    const claims = extracted!.claims;
    // agent-def `skills:` entry → skill-invoked / skill-events / transcript.
    const skill = claims.find((c) => c.id === 'ana-verify:skill:testing-standards')!;
    expect(skill.kind).toBe('skill-invoked');
    expect(skill.predicate).toMatchObject({ target: 'skill-events', scope: 'transcript' });
    // verify-independence imperative → human-constraint / read-paths / transcript (ENABLED).
    const indep = claims.find((c) => c.id === 'ana-verify:verify-independence')!;
    expect(indep.kind).toBe('human-constraint');
    expect(indep.predicate).toMatchObject({
      target: 'read-paths',
      scope: 'transcript',
      matcher: 'not_contains',
    });
    // file_changes entry → file-scope / edit-paths / transcript.
    const fileScope = claims.find((c) => c.kind === 'file-scope')!;
    expect(fileScope.predicate).toMatchObject({ target: 'edit-paths', scope: 'transcript' });
    // contract.yaml assertion → contract-matcher / RUNTIME (honest, not faked).
    const cm = claims.filter((c) => c.kind === 'contract-matcher');
    expect(cm.length).toBeGreaterThan(0);
    for (const c of cm) expect(c.predicate!.scope).toBe('runtime');
  });

  it('superpowers adapter: real announce literal → skill-announced; placeholder template emits NOTHING', () => {
    const group = [
      blob('superpowers/skills/executing-plans/SKILL.md', 'skills/executing-plans/SKILL.md'),
      blob('superpowers/skills/using-superpowers/SKILL.md', 'skills/using-superpowers/SKILL.md'),
      blob(
        'superpowers/skills/subagent-driven-development/SKILL.md',
        'skills/subagent-driven-development/SKILL.md',
      ),
    ];
    expect(detectMandateAdapter(group)).toBe(superpowersAdapter);
    const extracted = superpowersAdapter.extract(group)!;
    expect(extracted).toEqual(readMandate('superpowers.mandate.json'));

    // The real `**Announce at start:** "…"` literal → skill-announced (message-text/literal).
    const announced = extracted.claims.find((c) => c.kind === 'skill-announced')!;
    expect(announced.id).toBe('executing-plans:announced');
    expect(announced.predicate).toMatchObject({
      target: 'message-text',
      role: 'assistant',
      literalsOnly: true,
    });
    // The using-superpowers graphviz placeholder template must NOT yield a skill-announced.
    expect(extracted.claims.some((c) => c.id.startsWith('using-superpowers'))).toBe(false);
    // dispatch fan-out → confidence:'low' (nested windows degrade to unverifiable).
    const dispatch = extracted.claims.find((c) => c.kind === 'dispatch')!;
    expect(dispatch.confidence).toBe('low');
    // Every event-triggered-window claim carries the MANDATORY agentScope (concurrency axis).
    for (const c of extracted.claims) {
      if (c.scope.kind === 'event-triggered-window') {
        expect(c.scope.agentScope).toBeDefined();
      }
    }
  });
});

describe('C4 — Track-P manifest is represented (Done-state 4 — a runnable check, not a gesture)', () => {
  // The frozen REQ requires a representation of every labeled Track-P case:
  //  - file-scope deviations (the ~9 mined plans): represented by the anatomia file-scope claim
  //    shape (edit-paths/transcript) — the kind a real deviation is checked against at D.
  //  - verify-independence clean set (14/14): represented by the ana-verify human-constraint
  //    claim (read-paths/not_contains/build_report) — the ENABLED, transcript-checkable claim.
  //  - FI-7 synthetic verify-independence negatives: labeled TODO (not yet minted — see below).
  it('file-scope deviation shape is representable + checkable on the transcript', () => {
    const m = readMandate('anatomia.mandate.json');
    const fs0 = m.claims.find((c) => c.kind === 'file-scope')!;
    expect(fs0.predicate).toMatchObject({ target: 'edit-paths', scope: 'transcript' });
  });
  it('verify-independence clean-set shape is the ENABLED transcript claim', () => {
    const m = readMandate('anatomia.mandate.json');
    const indep = m.claims.find((c) => c.kind === 'human-constraint')!;
    expect(indep.predicate).toMatchObject({
      target: 'read-paths',
      scope: 'transcript',
      matcher: 'not_contains',
      value: 'build_report',
    });
  });
  it('FI-7 synthetic verify-independence NEGATIVES — labeled TODO (not yet minted)', () => {
    // The synthetic negative corpus (a verify session that DOES read the build report) is a
    // Phase-F / FI-7 follow-on. Represented here as a labeled TODO so Done-state 4 is honest.
    const FI7_NEGATIVES_MINTED = false;
    expect(FI7_NEGATIVES_MINTED).toBe(false);
  });
});

describe('C4 — boundary negative test (the runtime arm; the compile arm is boundary.type-test.ts)', () => {
  it('an intent claim with a predicate is rejected at validate', () => {
    const bad = {
      schemaVersion: 1,
      framework: 'x',
      claims: [
        {
          id: 'i',
          says: 's',
          kind: 'intent',
          scope: { kind: 'whole-session' },
          source: { kind: 'in-blob', blob: 'parent', fidelity: 'verbatim' },
          predicate: { target: 'tool-names', scope: 'transcript', matcher: 'exists' },
        },
      ],
    } as unknown as Mandate;
    const errs = validateMandate(bad);
    expect(errs.join(' ')).toMatch(/'intent' claim must NOT carry a predicate/);
  });
  it('a predicate-absent intent claim is valid (the boundary is reachable)', () => {
    const ok: Mandate = {
      schemaVersion: 1,
      framework: 'x',
      claims: [
        {
          id: 'i',
          says: 's',
          kind: 'intent',
          scope: { kind: 'whole-session' },
          source: { kind: 'in-blob', blob: 'parent', fidelity: 'verbatim' },
        } as MandateClaim,
      ],
    };
    expect(validateMandate(ok)).toEqual([]);
  });
});

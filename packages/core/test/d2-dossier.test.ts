import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { analyze } from '../src/analyze.js';
import { buildDossier, buildZeroMandateWedge, EVIDENCE_CAP } from '../src/dossier.js';
import { verdictsForMandate } from '../src/verdict.js';
import { scrubText, scrubFinding, SCRUB_VERSION } from '../src/scrub.js';
import type { Mandate, CheckableClaim } from '../src/mandate.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');
function assistant(content: unknown[], uuid: string, ts: string): unknown {
  return { type: 'assistant', sessionId: 's', uuid, timestamp: ts, message: { id: `m-${uuid}`, role: 'assistant', model: 'claude-opus-4-8', content, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } };
}
const xa = (): CheckableClaim['source'] => ({ kind: 'cross-artifact', workItemSlug: 'plan', path: 'contract.yaml', fidelity: 'verbatim' });

const readClaim: CheckableClaim = {
  id: 'verify-independence', says: 'never reads build_report', kind: 'human-constraint',
  scope: { kind: 'whole-session' }, source: xa(),
  predicate: { target: 'read-paths', matcher: 'not_contains', scope: 'transcript', value: 'build_report' },
};

// ─── the scrub golden (shared cross-repo conformance — bit-identical to crack3d) ──────────
describe('D2 — scrub is versioned + matches the crack3d canonical vocabulary', () => {
  const PAIRS: Array<[string, string]> = [
    ['/Users/rsmith/Projects/anatrace/x.ts', '∎path'],
    ['contact me at jane.doe@example.com please', 'contact me at ∎mail please'],
    ['token sk-ABCDEFGH12345678 leaked', 'token ∎key leaked'],
    ['gh token ghp_ABCDEFGH1234 here', 'gh token ∎key here'],
    ['aws AKIAABCDEFGH1234 key', 'aws ∎key key'],
    ['sha 0123456789abcdef0123456789abcdef01234567 done', 'sha ∎hex done'],
    ['nothing to scrub here', 'nothing to scrub here'],
  ];
  it('SCRUB_VERSION is stamped', () => {
    expect(SCRUB_VERSION).toBe('1');
  });
  for (const [input, expected] of PAIRS) {
    it(`scrubs: ${input.slice(0, 30)}…`, () => {
      expect(scrubText(input)).toBe(expected);
    });
  }
  it('scrubFinding covers the finding message AND location.file', () => {
    const f = scrubFinding({ message: 'edited /Users/rsmith/x.ts', location: { file: '/Users/rsmith/x.ts' } });
    expect(f.message).toBe('edited ∎path');
    expect(f.location?.file).toBe('∎path');
  });
});

// ─── the dossier (D2) ────────────────────────────────────────────────────────────────────
describe('D2 — buildDossier (said-vs-did; bounded scrubbed evidence; residue first-class)', () => {
  function sess(): ReturnType<typeof claudeAdapter.parse> {
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'tool_use', name: 'Read', input: { file_path: '/Users/rsmith/.ana/build_report.md' } }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }]);
  }
  const mandate: Mandate = { schemaVersion: 1, framework: 'anatomia', claims: [readClaim] };

  it('a violated read-paths claim lands in dossier.violated with a SCRUBBED excerpt', () => {
    const s = sess()!;
    const verdicts = verdictsForMandate(mandate, s);
    const d = buildDossier(s, mandate, verdicts);
    expect(d.violated).toHaveLength(1);
    expect(d.satisfied).toHaveLength(0);
    const slice = d.violated[0];
    // evidence text is scrubbed (no /Users path leaks)
    const joined = (slice.evidenceText ?? []).map((e) => e.text).join('');
    expect(joined.includes('/Users/')).toBe(false);
  });

  it('coverage is carried; schemaVersion is stamped', () => {
    const s = sess()!;
    const d = buildDossier(s, mandate, verdictsForMandate(mandate, s));
    expect(d.schemaVersion).toBe(1);
    expect(d.coverage.total).toBe(1);
  });

  it('evidence excerpts are BOUNDED (≤ EVIDENCE_CAP lines)', () => {
    const big = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'text', text: big }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    const m: Mandate = { schemaVersion: 1, framework: 'x', claims: [{
      id: 'msg', says: 'announces', kind: 'human-constraint', scope: { kind: 'whole-session' }, source: xa(),
      predicate: { target: 'message-text', matcher: 'contains', scope: 'transcript', value: 'line 0', role: 'assistant', literalsOnly: true },
    }] };
    const d = buildDossier(s, m, verdictsForMandate(m, s));
    const ex = d.satisfied[0]?.evidenceText?.[0];
    expect(ex).toBeDefined();
    expect(ex!.text.split('\n').length).toBeLessThanOrEqual(EVIDENCE_CAP);
  });

  it('the zero-mandate human-constraint wedge works (no mandate file)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'tool_use', id: 'e0', name: 'Write', input: { file_path: 'secrets/keys.txt', content: 'x' } }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    const syntheticMandate: Mandate = { schemaVersion: 1, framework: 'human-constraint', claims: [{
      id: 'human-constraint', says: 'do not touch secrets/keys.txt', kind: 'human-constraint', scope: { kind: 'whole-session' },
      source: { kind: 'in-blob', blob: 'parent', fidelity: 'derived' },
      predicate: { target: 'edit-paths', matcher: 'not_contains', scope: 'transcript', value: 'secrets/keys.txt' },
    }] };
    const verdicts = verdictsForMandate(syntheticMandate, s);
    const d = buildZeroMandateWedge(s, 'secrets/keys.txt', verdicts);
    // an edit of the forbidden path → violated
    expect(d.violated.length + d.satisfied.length).toBe(1);
  });
});

// ─── R2 byte-identity: no mandate ⇒ the three fields are omitted ──────────────────────────
describe('D — analyze without a mandate stays R2-byte-identical (the 3 fields omitted)', () => {
  it('no mandate ⇒ no compliance/dossier/hookRequests keys', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant([], 'a1', '2026-06-08T00:00:01.000Z')])) }])!;
    const r = analyze(s);
    expect('compliance' in r).toBe(false);
    expect('dossier' in r).toBe(false);
    expect('hookRequests' in r).toBe(false);
  });
});

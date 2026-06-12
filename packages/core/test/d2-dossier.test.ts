import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeAdapter } from '../src/adapters/claude.js';
import { analyze } from '../src/analyze.js';
import { buildDossier, buildZeroMandateWedge, EVIDENCE_CAP } from '../src/dossier.js';
import { verdictsForMandate } from '../src/verdict.js';
import { scrubText, scrubFinding, SCRUB_VERSION } from '../src/scrub.js';
import type { Mandate, CheckableClaim } from '../src/mandate.js';
import type { NormalizedSession } from '../src/session.js';

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
// The in/out pairs are loaded from ONE committed canonical artifact (scrub-golden.json) so a
// consumer (crack3d) can load the SAME file and run its own scrub against it. anatrace is the
// canonical owner; do NOT inline these pairs.
const here = path.dirname(fileURLToPath(import.meta.url));
interface ScrubGolden {
  scrubVersion: string;
  vocabulary: string[];
  pairs: Array<{ in: string; out: string }>;
}
const GOLDEN = JSON.parse(
  fs.readFileSync(path.join(here, 'fixtures', 'scrub-golden.json'), 'utf8'),
) as ScrubGolden;

describe('D2 — scrub is versioned + matches the crack3d canonical vocabulary', () => {
  it('SCRUB_VERSION is stamped + matches the committed golden', () => {
    expect(SCRUB_VERSION).toBe('1');
    expect(GOLDEN.scrubVersion).toBe(SCRUB_VERSION);
  });
  for (const { in: input, out: expected } of GOLDEN.pairs) {
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

  // The zero-mandate "don't touch X" wedge — the forbidden-edit blacklist evaluator. Uses an
  // ARBITRARY forbidden path (config/production.env), not a memorized exemplar.
  const FORBIDDEN = 'config/production.env';
  function forbiddenMandate(value = FORBIDDEN, matcher: 'not_contains' | 'not_equals' = 'not_contains'): Mandate {
    return { schemaVersion: 1, framework: 'human-constraint', claims: [{
      id: 'human-constraint', says: `do not touch ${value}`, kind: 'human-constraint', scope: { kind: 'whole-session' },
      source: { kind: 'in-blob', blob: 'parent', fidelity: 'derived' },
      predicate: { target: 'edit-paths', matcher, scope: 'transcript', value },
    }] };
  }
  function claudeEdits(paths: string[]): ReturnType<typeof claudeAdapter.parse> {
    const content = paths.map((p, i) => ({ type: 'tool_use', id: `e${i}`, name: 'Write', input: { file_path: p, content: 'x' } }));
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant(content, 'a1', '2026-06-08T00:00:01.000Z')])) }]);
  }

  it('wedge: the forbidden path WAS edited → violated(predicate-not-matched) with evidence', () => {
    const s = claudeEdits([FORBIDDEN])!;
    const verdicts = verdictsForMandate(forbiddenMandate(), s);
    expect(verdicts[0]).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(verdicts[0]!.evidence.length).toBeGreaterThan(0);
    const d = buildZeroMandateWedge(s, FORBIDDEN, verdicts);
    expect(d.violated).toHaveLength(1);
    expect(d.satisfied).toHaveLength(0);
  });

  it('wedge: the forbidden path was NOT touched → satisfied(predicate-matched)', () => {
    const s = claudeEdits(['src/app.ts', 'README.md'])!;
    const verdicts = verdictsForMandate(forbiddenMandate(), s);
    expect(verdicts[0]).toMatchObject({ status: 'satisfied', reason: 'predicate-matched' });
  });

  it('wedge: a NON-COMPARABLE forbidden value (absolute, no repoRoot) → unverifiable(content-unresolvable)', () => {
    const s = claudeEdits(['/abs/config/production.env'])!;
    const verdicts = verdictsForMandate(forbiddenMandate('/abs/config/production.env'), s);
    // forbidden value stays absolute after normalization → not comparable → must NOT silently pass
    expect(verdicts[0]).toMatchObject({ status: 'unverifiable', reason: 'content-unresolvable' });
  });

  it('wedge: a worktree-prefixed edit of the forbidden path normalizes → violated (blacklist-side normalization)', () => {
    const s = claudeEdits(['/abs/.ana/worktrees/some-slug/config/production.env'])!;
    const verdicts = verdictsForMandate(forbiddenMandate(), s);
    expect(verdicts[0]).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(verdicts[0]!.evidence.length).toBeGreaterThan(0);
  });

  it('wedge: not_equals forbidden value → exact match required (a child path does NOT violate)', () => {
    const exact = claudeEdits([FORBIDDEN])!;
    expect(verdictsForMandate(forbiddenMandate(FORBIDDEN, 'not_equals'), exact)[0]).toMatchObject({ status: 'violated' });
    const child = claudeEdits(['config/production.env.bak'])!;
    expect(verdictsForMandate(forbiddenMandate(FORBIDDEN, 'not_equals'), child)[0]).toMatchObject({ status: 'satisfied' });
  });
});

// ─── cross-harness: edit-paths is NOT codex-blind (Codex emits EditEvents) ────────────────
describe('D1 — forbidden-edit is cross-harness real (Codex patch_apply_end edits)', () => {
  function codexSessionEditing(paths: string[]): NormalizedSession {
    return {
      schemaVersion: 2, harness: 'codex', sessionId: 's', observedVersions: [], subagents: [],
      counts: {} as NormalizedSession['counts'],
      events: paths.map((p, i) => ({
        type: 'edit' as const, op: 'modify' as const, paths: [p],
        agent: { kind: 'root' as const }, blobName: 'parent', lineIndex: i,
      })),
    };
  }
  const FORBIDDEN = 'config/production.env';
  function mandate(): Mandate {
    return { schemaVersion: 1, framework: 'human-constraint', claims: [{
      id: 'human-constraint', says: `do not touch ${FORBIDDEN}`, kind: 'human-constraint', scope: { kind: 'whole-session' },
      source: { kind: 'in-blob', blob: 'parent', fidelity: 'derived' },
      predicate: { target: 'edit-paths', matcher: 'not_contains', scope: 'transcript', value: FORBIDDEN },
    }] };
  }
  it('a Codex session editing the forbidden path → violated (NOT codex-blind)', () => {
    const s = codexSessionEditing([FORBIDDEN]);
    const v = verdictsForMandate(mandate(), s)[0]!;
    expect(v).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(v.evidence.length).toBeGreaterThan(0);
  });
  it('a Codex session NOT touching the forbidden path → satisfied', () => {
    const s = codexSessionEditing(['src/main.rs']);
    expect(verdictsForMandate(mandate(), s)[0]).toMatchObject({ status: 'satisfied', reason: 'predicate-matched' });
  });
});

// ─── R2 byte-identity: no mandate ⇒ mandate-derived fields are omitted ───────────────────
describe('D — analyze without a mandate stays R2-byte-identical', () => {
  it('no mandate ⇒ no compliance/dossier/hookRequests/verificationCoverage keys', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant([], 'a1', '2026-06-08T00:00:01.000Z')])) }])!;
    const r = analyze(s);
    expect('compliance' in r).toBe(false);
    expect('dossier' in r).toBe(false);
    expect('hookRequests' in r).toBe(false);
    expect('verificationCoverage' in r).toBe(false);
  });
});

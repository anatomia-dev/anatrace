import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { analyze } from '../src/analyze.js';
import { adjudicate, buildHookRequests, type JudgeVerdict } from '../src/hook.js';
import { buildDossier } from '../src/dossier.js';
import { verdictsForMandate } from '../src/verdict.js';
import type { Mandate, CheckableClaim, IntentClaim } from '../src/mandate.js';
import type { Capabilities } from '../src/types.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');
function assistant(content: unknown[], uuid: string, ts: string): unknown {
  return { type: 'assistant', sessionId: 's', uuid, timestamp: ts, message: { id: `m-${uuid}`, role: 'assistant', model: 'claude-opus-4-8', content, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } };
}
const xa = (): CheckableClaim['source'] => ({ kind: 'cross-artifact', workItemSlug: 'plan', path: 'contract.yaml', fidelity: 'verbatim' });

function sess() {
  return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
    assistant([{ type: 'tool_use', name: 'Read', input: { file_path: '/r/x.ts' } }], 'a1', '2026-06-08T00:00:01.000Z'),
  ])) }])!;
}

const intentClaim: IntentClaim = { id: 'intent-1', says: 'do good work', kind: 'intent', scope: { kind: 'whole-session' }, source: xa() };
const mandate: Mandate = { schemaVersion: 1, framework: 'x', claims: [intentClaim] };

// ─── THE E2 GUARD TEST (the bright line) ─────────────────────────────────────────────────
describe('D-HOOK / E2 — analyze with vs without capabilities.judge is BYTE-IDENTICAL', () => {
  it('Report.compliance + dossier are byte-identical with and without a judge in capabilities', () => {
    const s = sess();
    const noJudge = analyze(s, undefined, undefined, mandate);
    const withJudge: Capabilities = { judge: async () => ({ claimId: 'intent-1', status: 'satisfied', source: 'llm', model: 'x', rationale: 'ok' } as JudgeVerdict) };
    const withJudgeReport = analyze(s, undefined, withJudge, mandate);
    expect(JSON.stringify(withJudgeReport.compliance)).toBe(JSON.stringify(noJudge.compliance));
    expect(JSON.stringify(withJudgeReport.dossier)).toBe(JSON.stringify(noJudge.dossier));
    expect(JSON.stringify(withJudgeReport.hookRequests)).toBe(JSON.stringify(noJudge.hookRequests));
    // the whole Report is byte-identical — analyze NEVER touches the judge
    expect(JSON.stringify(withJudgeReport)).toBe(JSON.stringify(noJudge));
  });
});

// ─── hookRequests = the routed-to-llm residue manifest ───────────────────────────────────
describe('D-HOOK — hookRequests carries the routed-to-llm residue (zero LLM calls)', () => {
  it('an intent claim (routed-to-llm) appears in hookRequests with a bounded slice', () => {
    const s = sess();
    const r = analyze(s, undefined, undefined, mandate);
    expect(r.hookRequests).toHaveLength(1);
    expect(r.hookRequests![0].claimId).toBe('intent-1');
    expect(r.hookRequests![0].input.claim.says).toBe('do good work');
  });

  it('buildHookRequests only includes routed-to-llm, not satisfied/violated/runtime', () => {
    const s = sess();
    const m: Mandate = { schemaVersion: 1, framework: 'x', claims: [
      intentClaim,
      { id: 'rp', says: 'never reads x', kind: 'human-constraint', scope: { kind: 'whole-session' }, source: xa(),
        predicate: { target: 'read-paths', matcher: 'not_contains', scope: 'transcript', value: 'x.ts' } },
    ] };
    const verdicts = verdictsForMandate(m, s);
    const d = buildDossier(s, m, verdicts);
    const hooks = buildHookRequests(m, verdicts, d);
    expect(hooks.map((h) => h.claimId)).toEqual(['intent-1']); // the read-paths violated is NOT routed
  });
});

// ─── adjudicate is a SEPARATE entrypoint honoring budget ─────────────────────────────────
describe('D-HOOK — adjudicate is a separate entrypoint (NOT inside analyze) + honors budget', () => {
  it('adjudicate walks hookRequests and calls the injected judge', async () => {
    const s = sess();
    const r = analyze(s, undefined, undefined, mandate);
    const seen: string[] = [];
    const out = await adjudicate(r.hookRequests!, async (input) => {
      seen.push((input as { claim: { id: string } }).claim.id);
      return { claimId: 'intent-1', status: 'unverifiable', source: 'llm', model: 'haiku', rationale: 'unclear' };
    });
    expect(seen).toEqual(['intent-1']);
    expect(out[0].source).toBe('llm');
    expect(out[0].rationale).toBe('unclear');
  });

  it('budget.maxClaims caps the judge calls', async () => {
    const m: Mandate = { schemaVersion: 1, framework: 'x', claims: [
      { ...intentClaim, id: 'i1' }, { ...intentClaim, id: 'i2' }, { ...intentClaim, id: 'i3' },
    ] };
    const s = sess();
    const r = analyze(s, undefined, undefined, m);
    let calls = 0;
    await adjudicate(r.hookRequests!, async () => { calls += 1; return { claimId: 'i', status: 'satisfied', source: 'llm', model: 'm', rationale: 'r' }; }, { maxClaims: 2 });
    expect(calls).toBe(2);
  });
});

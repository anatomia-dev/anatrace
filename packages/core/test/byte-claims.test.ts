import { describe, it, expect } from 'vitest';
import { parseSession } from '../src/parse.js';
import { analyze } from '../src/analyze.js';
import { allRules } from '../src/registry.js';
import { claudeAdapter } from '../src/adapters/claude.js';
import { loadCorpus, type CorpusSession } from './_corpus.js';

const corpus = loadCorpus();
function byName(name: string): CorpusSession {
  const s = corpus.find((c) => c.name === name);
  if (!s) throw new Error(`fixture not found: ${name}`);
  return s;
}
function freshBlobs(s: CorpusSession) {
  return s.blobs.map((b) => ({ name: b.name, bytes: new Uint8Array(b.bytes) }));
}
function parse(name: string) {
  const s = byName(name);
  return parseSession(freshBlobs(s), s.harness);
}

/**
 * Re-verify every Round-1/2 byte-claim on the SYNTHETIC corpus (A14, fail-closed). Each
 * shape is modeled on a real transcript; real-world fidelity is the A16 local smoke. No
 * skips — a divergence FAILS the runbook.
 */
describe('A14 — byte-claims on the synthetic corpus', () => {
  it('#1 message.id divergence: dedup picks MAX total (59, not 1, not 60)', () => {
    const s = parse('claude-iddiverge')!;
    // msg_div kept at output 59 (MAX of 59/1); msg_div2 adds 30 → 89. input 100 + 50 = 150.
    expect(s.counts.tokens.output).toBe(89);
    expect(s.counts.tokens.input).toBe(150);
  });

  it('#2 non-monotonic case: the canary FLAGS (never throws/fails)', () => {
    const s = byName('claude-iddiverge');
    claudeAdapter.parse(freshBlobs(s));
    expect(claudeAdapter.capabilities.tokenTotalSuspect).toBe(true);
  });

  it('#3 move_path rename [SYNTHETIC]: update + move_path → op:rename with two paths', () => {
    const s = parse('codex-rename')!;
    const rename = s.events.find((e) => e.type === 'edit' && e.op === 'rename');
    expect(rename).toBeDefined();
    expect((rename as { paths: string[] }).paths).toEqual([
      '/work/proj/old_name.ts',
      '/work/proj/new_name.ts',
    ]);
  });

  it('#4 Claude interrupt is NOT shipped: no interrupt event, no interrupt finding, no rule', () => {
    const s = parse('claude-plain')!;
    expect(s.events.some((e) => e.type === 'interrupt')).toBe(false);
    const report = analyze(s);
    expect(report.findings.some((f) => f.ruleId.includes('interrupt'))).toBe(false);
    expect(allRules().some((r) => r.id === 'claude-interrupt')).toBe(false);
  });

  it('#5 sidechain precedence: keep the non-sidechain copy even at a lower total', () => {
    const s = parse('claude-sidechain')!;
    // non-sidechain (cache_read 0) kept over the sidechain replay (cache_read 500).
    expect(s.counts.tokens.cache_read).toBe(0);
    expect(s.counts.tokens.output).toBe(50);
    expect(s.counts.tokens.input).toBe(50);
  });

  it('#6 Codex cache-inclusive input: cached ≤ input; cost uses input - cached', () => {
    const s = parse('codex-cacheheavy')!;
    expect(s.counts.tokens.input).toBe(4000); // 20000 gross - 16000 cached
    expect(s.counts.tokens.cache_read).toBe(16000);
    expect(s.counts.tokens.output).toBe(500);
    expect(s.counts.tokens.cache_create).toBe(0);
  });

  it('bonus — Claude is_error is exercised on the corpus (claude-tool-failure fires)', () => {
    const report = analyze(parse('claude-toolfail')!);
    expect(report.findings.filter((f) => f.ruleId === 'claude-tool-failure').length).toBe(1);
  });

  it('bonus — fan-out subagent inclusion + attribution', () => {
    const s = parse('claude-fanout')!;
    expect(s.subagents.length).toBe(1);
    expect(s.subagents[0]!.agentType).toBe('explorer');
    expect(s.subagents[0]!.dispatchToolUseId).toBe('toolu_disp');
    // subagent tokens are INCLUDED (parent-only would be 1400 input; with subagents 4900).
    expect(s.counts.tokens.input).toBe(4900);
  });
});

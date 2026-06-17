import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyze.js';
import { parseSession } from '../src/parse.js';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { buildSessionMeta } from '../src/meta/facts.js';
import { gitOpsTimeline } from '../src/meta/git-ops.js';
import { runnerOutcomes } from '../src/meta/runner.js';
import { contextLimitFor, CONTEXT_LIMITS } from '../src/meta/context-limits.js';
import { loadCorpus, type CorpusSession } from './_corpus.js';
import type { NamedBlob } from '../src/adapter.js';
import type { Report } from '../src/report.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

const corpus = loadCorpus();
function fixture(name: string): CorpusSession {
  const s = corpus.find((c) => c.name === name);
  if (!s) throw new Error(`fixture ${name} not loaded (corpus has: ${corpus.map((c) => c.name).join(', ')})`);
  return s;
}
function reportOf(name: string): Report {
  const s = parseSession(fixture(name).blobs, fixture(name).harness);
  expect(s).not.toBeNull();
  return analyze(s!);
}

// ─── S1 / M1 — compaction (STRUCTURED marker only; the substring trap) ────────────────────
describe('S1/M1 — compaction is detected on the STRUCTURED marker only', () => {
  it('a real compact_boundary fixture → compaction.count=1 with the boundary line index', () => {
    const r = reportOf('claude-compact-inplace');
    expect(r.session.compaction?.count).toBe(1);
    expect(r.session.compaction?.boundaries[0]?.lineIndex).toBe(1);
    expect(r.session.compaction?.boundaries[0]?.trigger).toBe('manual');
    expect(r.session.compaction?.boundaries[0]?.preTokens).toBe(177500);
  });

  it('a session that MENTIONS "compact_boundary" only as prose → count=0 (NO substring false-positive)', () => {
    // The string appears in assistant prose + a tool_result — never as a `type:"system"`
    // record. The structured detector must NOT fire (the 44-vs-6 substring trap).
    const lines = jsonl([
      {
        type: 'assistant', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:01.000Z',
        message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'The harness emits a compact_boundary system line on subtype:"compact_boundary".' }],
          usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 200 } },
      },
      {
        type: 'user', sessionId: 's', uuid: 'u2', timestamp: '2026-06-08T00:00:02.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'grep hit: "subtype":"compact_boundary"' }] },
      },
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    const r = analyze(s);
    expect(r.session.compaction).toBeUndefined();
  });

  it('Codex structured marker (payload.type:"compacted") → compaction.count=1', () => {
    const r = reportOf('codex-compacted');
    expect(r.session.compaction?.count).toBe(1);
    // Codex carries no preTokens/trigger → both omitted (honest unknown, never guessed).
    expect(r.session.compaction?.boundaries[0]?.preTokens).toBeUndefined();
    expect(r.session.compaction?.boundaries[0]?.trigger).toBeUndefined();
  });
});

// ─── M1 — ROOT-LANE context (formula + lane scoping; NEVER the merged sum) ────────────────
describe('M1 — rootPeakTokens = ROOT-lane max(input+cache_read+cache_create), output excluded', () => {
  it('peak is within ~1% of compactMetadata.preTokens (the byte-validated formula)', () => {
    const r = reportOf('claude-compact-inplace');
    const peak = r.session.context!.rootPeakTokens;
    const pre = r.session.compaction!.boundaries[0]!.preTokens!;
    expect(Math.abs(peak - pre) / pre).toBeLessThan(0.01);
    // 12000 + 8000(cache_create) + 158000(cache_read) = 178000; output (300) EXCLUDED.
    expect(peak).toBe(178000);
  });

  it('subagent peak is emitted SEPARATELY and is NEVER merged into the root peak', () => {
    const r = reportOf('claude-compact-lanestart');
    // root: 3000+900+12000 = 15900; subagent: 40000+2000+60000 = 102000 (LARGER).
    expect(r.session.context!.rootPeakTokens).toBe(15900);
    expect(r.session.context!.subagentPeakTokens).toBe(102000);
    // the merged sum (117900) must NOT appear — root is the human-driven signal.
    expect(r.session.context!.rootPeakTokens).not.toBe(117900);
    expect(r.session.context!.rootFlowCompacted).toBe(true);
  });

  it('rootContextUtilization present for a known model with a sane (<=1) ratio', () => {
    const r = reportOf('claude-compact-inplace'); // sonnet, 178000/200000 = 0.89
    expect(r.session.context!.rootContextUtilization).toBeCloseTo(0.89, 5);
    expect(r.session.context!.contextLimitsVersion).toBeDefined();
  });

  it('rootContextUtilization OMITTED for an unknown model (never guessed)', () => {
    const lines = jsonl([
      {
        type: 'assistant', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:01.000Z',
        message: { id: 'm1', role: 'assistant', model: 'some-future-model-9',
          content: [], usage: { input_tokens: 1000, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 } },
      },
    ]);
    const r = analyze(claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!);
    expect(r.session.context!.rootPeakTokens).toBe(3000);
    expect(r.session.context!.rootContextUtilization).toBeUndefined();
  });

  it('rootContextUtilization OMITTED when the peak EXCEEDS the table limit (a 1M-beta session — never a nonsense >1 ratio)', () => {
    // Byte-reality: ~12% of the real corpus reaches ~976k tokens on model:"claude-opus-4-6"
    // with NO structured 1M marker → a 200k limit would emit a 4.88 ratio. We omit instead.
    const lines = jsonl([
      {
        type: 'assistant', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:01.000Z',
        message: { id: 'm1', role: 'assistant', model: 'claude-opus-4-6',
          content: [], usage: { input_tokens: 800000, output_tokens: 100, cache_creation_input_tokens: 8000, cache_read_input_tokens: 168000 } },
      },
    ]);
    const r = analyze(claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!);
    expect(r.session.context!.rootPeakTokens).toBe(976000); // byte-exact peak still emitted
    expect(r.session.context!.rootContextUtilization).toBeUndefined(); // the un-guessable ratio withheld
  });
});

// ─── M2 — segment-aware git-ops (NOT a ^git match) ────────────────────────────────────────
describe('M2 — git-ops is SEGMENT-aware (catches the cd worktree && git idiom)', () => {
  it('the chain fixture → rebases>=1 and forcePushes>=1 (mid-chain, a ^git match would miss)', () => {
    const r = reportOf('claude-gitchain');
    const g = r.session.gitOps!.total;
    expect(g.rebases).toBeGreaterThanOrEqual(1);
    expect(g.forcePushes).toBeGreaterThanOrEqual(1);
    expect(g.pushes).toBeGreaterThanOrEqual(1);
  });

  it('a "cd src && git add ; git commit" chain → adds>=1, commits>=1 (proves segment-split, not ^git)', () => {
    const r = reportOf('claude-gitchain');
    const g = r.session.gitOps!.total;
    expect(g.adds).toBeGreaterThanOrEqual(1);
    expect(g.commits).toBeGreaterThanOrEqual(1);
  });

  it('git -C global flags are skipped before the subcommand; checkout -b creates a branch; log is read-only (uncounted)', () => {
    const r = reportOf('claude-gitchain');
    const g = r.session.gitOps!.total;
    expect(g.checkouts).toBeGreaterThanOrEqual(1);
    expect(g.branchesCreated).toBeGreaterThanOrEqual(1); // from `checkout -b`
  });

  it('cross-harness: Codex exec_command chains classify identically', () => {
    const r = reportOf('codex-gitchain');
    const g = r.session.gitOps!.total;
    expect(g.rebases).toBeGreaterThanOrEqual(1);
    expect(g.forcePushes).toBeGreaterThanOrEqual(1);
    expect(g.adds).toBeGreaterThanOrEqual(1);
    expect(g.commits).toBeGreaterThanOrEqual(1);
  });

  it('a no-git session → all zeros (not absent-as-error)', () => {
    const r = reportOf('claude-plain');
    const g = r.session.gitOps!.total;
    expect(g.commits).toBe(0);
    expect(g.pushes).toBe(0);
    expect(g.rebases).toBe(0);
  });

  it('the root-vs-subagent split is wired INTO the shape (total === root + subagents, field-wise)', () => {
    const r = reportOf('claude-gitchain');
    const { total, root, subagents } = r.session.gitOps!;
    for (const k of Object.keys(total) as (keyof typeof total)[]) {
      expect(total[k]).toBe(root[k] + subagents[k]);
    }
  });
});

// ─── A2.2 — gitOpsTimeline (positioned mutating git ops; the recovery-episode substrate) ───
describe('A2.2 — gitOpsTimeline places mutating git ops ON the ordered timeline', () => {
  function sessionOf(name: string): NonNullable<ReturnType<typeof parseSession>> {
    const s = parseSession(fixture(name).blobs, fixture(name).harness);
    expect(s).not.toBeNull();
    return s!;
  }

  it('claude-gitchain → the ordered op stream, segment-split, read-only `log` excluded', () => {
    // The fixture runs three commands:
    //   1. cd … && git rebase origin/main && git push --force-with-lease   → rebase, push(force)
    //   2. cd src && git add -A; git commit -m 'wip'                        → add, commit
    //   3. git -C /repo checkout -b feature/new && git -C /repo log … | head → checkout(-b)  [log excluded]
    const ops = gitOpsTimeline(sessionOf('claude-gitchain').events);
    expect(ops.map((o) => o.subcommand)).toEqual(['rebase', 'push', 'add', 'commit', 'checkout']);
    // the read-only `log` segment never reaches the stream
    expect(ops.some((o) => o.subcommand === 'log')).toBe(false);
  });

  it('forcePush is precomputed on the push op only; `git -C` globals are stripped from the subcommand', () => {
    const ops = gitOpsTimeline(sessionOf('claude-gitchain').events);
    const push = ops.find((o) => o.subcommand === 'push')!;
    expect(push.forcePush).toBe(true);
    expect(ops.filter((o) => o.subcommand !== 'push').every((o) => o.forcePush === false)).toBe(true);
    // `git -C /repo checkout -b …` → subcommand is `checkout` (the `-C /repo` global is skipped),
    // and the argv exposes the branch-create flag + name.
    const checkout = ops.find((o) => o.subcommand === 'checkout')!;
    expect(checkout.argv).toEqual(['-b', 'feature/new']);
  });

  it('ops from one chained command share the source event position (rebase+push are the same Bash call)', () => {
    const ops = gitOpsTimeline(sessionOf('claude-gitchain').events);
    const rebase = ops.find((o) => o.subcommand === 'rebase')!;
    const push = ops.find((o) => o.subcommand === 'push')!;
    expect(rebase.lineIndex).toBe(push.lineIndex); // same `cd … && git rebase && git push` event
    expect(rebase.blobName).toBe(push.blobName);
    for (const o of ops) expect(o.agent).toEqual({ kind: 'root' });
  });

  it('argv is verbatim — exposes --allow-empty / --amend so the consumer judges real-vs-no-op itself', () => {
    const lines = jsonl([
      {
        type: 'assistant', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:01.000Z',
        message: {
          id: 'm1', role: 'assistant', model: 'claude-opus-4-8',
          content: [
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git commit --allow-empty -m "noop"' } },
          ],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
      {
        type: 'assistant', sessionId: 's', uuid: 'u2', timestamp: '2026-06-08T00:00:02.000Z',
        message: {
          id: 'm2', role: 'assistant', model: 'claude-opus-4-8',
          content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'git commit --amend --no-edit' } }],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    const ops = gitOpsTimeline(claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!.events);
    expect(ops.map((o) => o.subcommand)).toEqual(['commit', 'commit']);
    expect(ops[0]!.argv).toContain('--allow-empty');
    expect(ops[1]!.argv).toContain('--amend');
  });

  it('cross-harness: Codex exec_command chains place identically (rebase/push/add/commit present)', () => {
    const ops = gitOpsTimeline(sessionOf('codex-gitchain').events);
    const subs = ops.map((o) => o.subcommand);
    for (const s of ['rebase', 'push', 'add', 'commit']) expect(subs).toContain(s);
    expect(ops.find((o) => o.subcommand === 'push')!.forcePush).toBe(true);
  });

  it('a no-git session → an empty stream (not absent-as-error); empty events → empty', () => {
    expect(gitOpsTimeline(sessionOf('claude-plain').events)).toEqual([]);
    expect(gitOpsTimeline([])).toEqual([]);
  });

  it('quote-aware: a git token inside echo "…; git push …" DATA yields NO phantom op (the over-emit fix)', () => {
    const lines = jsonl([
      {
        type: 'assistant', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:01.000Z',
        message: {
          id: 'm1', role: 'assistant', model: 'claude-opus-4-8',
          content: [
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo "hello; git push --force"' } },
            { type: 'tool_use', id: 't2', name: 'Bash', input: { command: "git commit -m 'git push origin'" } },
          ],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    const ops = gitOpsTimeline(claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!.events);
    // only the real commit; the echo's quoted `git push` is data, and the commit message is ONE argv token.
    expect(ops.map((o) => o.subcommand)).toEqual(['commit']);
    expect(ops[0]!.argv).toEqual(['-m', 'git push origin']);
  });

  it('force-push variant matrix: -f / --force / --force-with-lease[=ref] are force; a plain push is not', () => {
    const variants: Array<[string, boolean]> = [
      ['git push -f', true],
      ['git push --force', true],
      ['git push --force-with-lease', true],
      ['git push --force-with-lease=origin/main', true],
      ['git push -u origin feature', false],
    ];
    for (const [cmd, expected] of variants) {
      const lines = jsonl([
        {
          type: 'assistant', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:01.000Z',
          message: {
            id: 'm1', role: 'assistant', model: 'claude-opus-4-8',
            content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: cmd } }],
            usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        },
      ]);
      const [op] = gitOpsTimeline(claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!.events);
      expect([cmd, op!.forcePush]).toEqual([cmd, expected]);
    }
  });

  it('lane-tagging: a git op run on a SUBAGENT lane carries agent.kind === "subagent"', () => {
    const mk = (id: string, cmd: string): string =>
      jsonl([
        {
          type: 'assistant', sessionId: 's', uuid: `${id}1`, timestamp: '2026-06-08T00:00:01.000Z',
          message: {
            id: `m${id}`, role: 'assistant', model: 'claude-opus-4-8',
            content: [{ type: 'tool_use', id: `t${id}`, name: 'Bash', input: { command: cmd } }],
            usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        },
      ]);
    const session = claudeAdapter.parse([
      { name: 'parent', bytes: enc(mk('root', 'git add -A')) },
      { name: 'agent-reviewer.jsonl', bytes: enc(mk('sub', 'git commit -m wip')) },
    ])!;
    const ops = gitOpsTimeline(session.events);
    const commit = ops.find((o) => o.subcommand === 'commit')!;
    expect(commit.agent).toEqual({ kind: 'subagent', subagentId: 'reviewer' });
    expect(commit.blobName).toBe('agent-reviewer.jsonl');
    expect(ops.find((o) => o.subcommand === 'add')!.agent).toEqual({ kind: 'root' });
  });

  it('full-shape lock: a GitOpEvent carries exactly the documented fields (no stray/identity field)', () => {
    const session = sessionOf('claude-gitchain');
    const ops = gitOpsTimeline(session.events);
    const push = ops.find((o) => o.subcommand === 'push')!;
    expect(Object.keys(push).sort()).toEqual(
      ['agent', 'argv', 'blobName', 'forcePush', 'lineIndex', 'subcommand', 'ts'].sort(),
    );
  });

  it('ts is omitted (not undefined) when the source event has no timestamp', () => {
    const lines = jsonl([
      {
        type: 'assistant', sessionId: 's', uuid: 'u1', // no timestamp on this line
        message: {
          id: 'm1', role: 'assistant', model: 'claude-opus-4-8',
          content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git commit -m x' } }],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    const [op] = gitOpsTimeline(claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!.events);
    expect('ts' in op!).toBe(false);
  });
});

// ─── A2.3 — runnerOutcomes (structured, runner-gated PASS/FAIL/unknown) ────────────────────
describe('A2.3 — runnerOutcomes classifies test results, runner-gated, abstaining when unsure', () => {
  // Build a Claude session of (tool, result-text) pairs. `tool` defaults to Bash (a command tool →
  // its result is runner-gated); pass tool:'Read' to exercise the phantom-echo guard. The adapter's
  // FI-2 post-pass stamps `ToolResultEvent.forTool` from the tool_use_id join.
  function results(specs: { tool?: string; result: string }[]): NonNullable<ReturnType<typeof claudeAdapter.parse>> {
    const objs: unknown[] = [];
    specs.forEach((r, i) => {
      const id = `tr${i}`;
      const tool = r.tool ?? 'Bash';
      const input = tool === 'Bash' ? { command: 'pnpm test' } : { file_path: '/notes.txt' };
      objs.push({
        type: 'assistant', sessionId: 's', uuid: `a${i}`, timestamp: `2026-06-08T00:00:0${i}.000Z`,
        message: {
          id: `m${i}`, role: 'assistant', model: 'claude-opus-4-8',
          content: [{ type: 'tool_use', id, name: tool, input }],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      });
      objs.push({
        type: 'user', sessionId: 's', uuid: `u${i}`, timestamp: `2026-06-08T00:00:0${i}.500Z`,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: r.result }] },
      });
    });
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl(objs)) }])!;
  }

  it('vitest PASS → outcome pass with the parsed count (verbatim corpus shape)', () => {
    const text = ' Test Files  1 passed (1)\n      Tests  13 passed (13)\n   Duration  285ms';
    const [o] = runnerOutcomes(results([{ result: text }]).events);
    expect(o).toMatchObject({ runner: 'vitest', outcome: 'pass', passed: 13 });
    expect(o!.failed).toBeUndefined();
  });

  it('vitest FAIL → outcome fail with passed/failed split (the failed keyword in the Tests line)', () => {
    const text = ' Test Files  1 failed (1)\n      Tests  1 failed | 37 passed (38)\n   Duration  297ms';
    const [o] = runnerOutcomes(results([{ result: text }]).events);
    expect(o).toMatchObject({ runner: 'vitest', outcome: 'fail', failed: 1, passed: 37 });
  });

  it('vitest with skipped → counts carry skipped; no failed keyword → pass', () => {
    const text = ' Test Files  131 passed (131)\n      Tests  3200 passed | 2 skipped (3202)';
    const [o] = runnerOutcomes(results([{ result: text }]).events);
    expect(o).toMatchObject({ runner: 'vitest', outcome: 'pass', passed: 3200, skipped: 2 });
  });

  it('ana-internal (verdict: …) is authoritative and checked before the vitest arm', () => {
    const pass = '✓ captured  counts: 3525 passed, 0 failed, 2 skipped  (verdict: pass)';
    const fail = '✓ checkpoint  counts: 224 passed, 1 failed, 0 skipped  (verdict: fail)';
    expect(runnerOutcomes(results([{ result: pass }]).events)[0]).toMatchObject({
      runner: 'ana', outcome: 'pass', passed: 3525, failed: 0, skipped: 2,
    });
    expect(runnerOutcomes(results([{ result: fail }]).events)[0]).toMatchObject({
      runner: 'ana', outcome: 'fail', failed: 1,
    });
  });

  it('HONESTY FLOOR: only a runner-SPECIFIC banner (vitest/ana) classifies — everything else yields NO outcome', () => {
    // Real non-test command output that merely contains test-shaped words — must yield NO outcome,
    // never a pass. Includes the deceptive timing-line / `test result:` phrasings: those are NOT
    // runner-specific, so pytest/cargo are a deliberate blind spot rather than a false-PASS vector.
    for (const text of [
      'Sentinel policy: 5 passed, 0 failed.', // terraform/sentinel
      'Rollout status: 3 passed readiness probes. Service healthy.',
      'audited 300 packages\n12 passed audit checks', // npm audit
      'checks.........: 100.00% 4 passed 0 failed', // k6 load test
      'Pre-commit hook: 4 passed, 1 failed checks.',
      '2 passed, 3 failed', // bare counts, no anchor at all
      'Deploying...\n3 passed in 4s\nDeploy complete', // deceptive `in <n>s` timing phrasing
      'Health check: 3 passed in 2.0s',
      'checks.........: 100.00% 5 passed in 30s', // k6 with a timing phrase
      'Audits: 5 passed in 0.5 seconds', // lighthouse
      'log: test result: ok. 5 passed; 0 failed; 0 ignored', // a `test result:` line in a log
      '===== 5 passed in 0.31s =====', // a real pytest banner — still NOT classified (no corpus grounding yet)
      'test result: ok. 42 passed; 0 failed', // a real cargo banner — likewise deliberately not classified
    ]) {
      expect(runnerOutcomes(results([{ result: text }]).events)).toEqual([]);
    }
  });

  it('ANSI/CSI cannot flip a real FAIL to pass (every CSI form is stripped, not lost)', () => {
    // A control sequence spliced into / around the failure token must not hide it. Cover SGR color,
    // 256-color, RGB, bold, AND a non-SGR erase sequence (`\x1b[2K`) spliced INSIDE the count token.
    for (const coloredFail of [
      '   Tests  2\x1b[31m failed\x1b[39m | 3 passed (5)', // basic SGR color
      ' Test Files 1 failed (1)\n Tests  2\x1b[38;5;1m failed\x1b[0m | 3 passed', // 256-color + reset
      ' Test Files 1 failed (1)\n Tests  2\x1b[38;2;255;0;0m failed\x1b[0m | 3 passed', // RGB
      '   Tests  1 \x1b[2Kfailed | 4 passed (5)', // non-SGR erase spliced into the token
    ]) {
      expect(runnerOutcomes(results([{ result: coloredFail }]).events)[0]!.outcome).toBe('fail');
    }
    // and a colored PASS still reads pass (the strip is lossless for the good case)
    const coloredPass = ' \x1b[32mTest Files\x1b[39m  1 passed (1)\n      \x1b[32mTests\x1b[39m  13 passed (13)';
    expect(runnerOutcomes(results([{ result: coloredPass }]).events)[0]).toMatchObject({ outcome: 'pass', passed: 13 });
  });

  it('worst-wins: Test Files failed even though every Tests-line test passed → fail (suite-load failure)', () => {
    const text = ' Test Files  1 failed (1)\n      Tests  5 passed (5)';
    expect(runnerOutcomes(results([{ result: text }]).events)[0]).toMatchObject({
      runner: 'vitest', outcome: 'fail', passed: 5,
    });
  });

  it('ABSTAIN: runner banner present but no readable count (truncated) → outcome unknown, no counts', () => {
    const truncated = ' RUN  v4.1.8 /repo\n Test Files  2 (2)\n'; // a `| head`-truncated vitest banner
    const [o] = runnerOutcomes(results([{ result: truncated }]).events);
    expect(o).toMatchObject({ runner: 'vitest', outcome: 'unknown' });
    expect(o!.passed).toBeUndefined();
    expect(o!.failed).toBeUndefined();
  });

  it('the crack3d FP fix: a NON-command tool (Read) echoing a full vitest block → NO outcome', () => {
    const text = ' Test Files  1 passed (1)\n      Tests  13 passed (13)';
    // Same bytes, but the result originates from `Read` (forTool='Read'), not a command tool.
    expect(runnerOutcomes(results([{ tool: 'Read', result: text }]).events)).toEqual([]);
  });

  it('a command result with NO test evidence (git status) → no outcome (no over-emission)', () => {
    expect(runnerOutcomes(results([{ result: 'On branch main\nnothing to commit, working tree clean' }]).events)).toEqual([]);
  });

  it('positioned + ordered: a fail then a later pass → two outcomes in order, each keyed by toolUseId', () => {
    const fail = ' Test Files  1 failed (1)\n      Tests  1 failed | 0 passed (1)';
    const pass = ' Test Files  1 passed (1)\n      Tests  1 passed (1)';
    const outcomes = runnerOutcomes(results([{ result: fail }, { result: pass }]).events);
    expect(outcomes.map((o) => o.outcome)).toEqual(['fail', 'pass']);
    expect(outcomes.every((o) => o.agent.kind === 'root' && typeof o.toolUseId === 'string')).toBe(true);
    expect(outcomes[0]!.lineIndex).toBeLessThan(outcomes[1]!.lineIndex);
  });

  it('the crack3d FP fix, end-to-end: a Read echo of a FAIL banner + a real Bash PASS run → only the PASS', () => {
    // The Read result carries a full vitest FAIL banner; the Bash result a real PASS banner. Only the
    // command-tool (Bash) outcome may survive — the Read echo (which would be a fail) is gated out.
    const readBanner = ' Test Files  1 failed (1)\n      Tests  9 failed | 1 passed (10)';
    const bashBanner = ' Test Files  1 passed (1)\n      Tests  13 passed (13)';
    const out = runnerOutcomes(results([{ tool: 'Read', result: readBanner }, { result: bashBanner }]).events);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ runner: 'vitest', outcome: 'pass', passed: 13 });
  });

  it('full-shape lock: a RunnerOutcome carries exactly the documented fields (no stray/identity field)', () => {
    const session = results([{ result: ' Test Files  1 passed (1)\n      Tests  13 passed (13)' }]);
    const ev = session.events.find((e) => e.type === 'toolResult')!;
    expect(runnerOutcomes(session.events)).toEqual([
      {
        runner: 'vitest', outcome: 'pass', passed: 13,
        toolUseId: ev.toolUseId, lineIndex: ev.lineIndex, ts: ev.ts, agent: { kind: 'root' }, blobName: 'parent',
      },
    ]);
  });

  it('cross-harness: a vitest banner through Codex `exec_command` joins via forTool and classifies', () => {
    const lines = [
      { timestamp: '2026-06-08T00:00:00.000Z', type: 'session_meta', payload: { id: 'sc', originator: 'codex_cli', cli_version: '0.9.1', cwd: '/w', source: 'startup' } },
      { timestamp: '2026-06-08T00:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.5', cwd: '/w' } },
      { timestamp: '2026-06-08T00:00:03.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"command":"pnpm test"}' } },
      { timestamp: '2026-06-08T00:00:04.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: { content: ' Test Files  1 passed (1)\n      Tests  7 passed (7)' } } },
    ];
    const session = codexAdapter.parse([{ name: 'parent', bytes: enc(jsonl(lines)) }])!;
    expect(runnerOutcomes(session.events)[0]).toMatchObject({ runner: 'vitest', outcome: 'pass', passed: 7 });
  });

  it('honest abstain on a real fixture: codex-plain `pytest -q` → bare "7 passed" → no outcome (pytest is a blind spot)', () => {
    // pytest is deliberately not classified (no runner-specific banner we can pin without a false-PASS
    // risk), so a real pytest result produces no outcome — an honest gap, never a guessed pass.
    const s = parseSession(fixture('codex-plain').blobs, 'codex')!;
    expect(runnerOutcomes(s.events)).toEqual([]);
  });

  it('ts omitted when the source event has none; empty input → empty output', () => {
    expect(runnerOutcomes([])).toEqual([]);
    const noTs = { type: 'toolResult', text: ' Test Files  1 passed (1)\n      Tests  1 passed (1)', forTool: 'Bash', toolUseId: 'x', agent: { kind: 'root' }, blobName: 'b', lineIndex: 0 } as unknown as Parameters<typeof runnerOutcomes>[0][number];
    const [o] = runnerOutcomes([noTs]);
    expect('ts' in o!).toBe(false);
  });
});

// ─── M3 — environment (skillOriginCounts + INVOKED mcp; trimmed) ──────────────────────────
describe('M3 — environment is the two observable, non-poisoned bits only', () => {
  it('skillOriginCounts (four-valued) + invoked mcpServers + mcpToolCalls', () => {
    const r = reportOf('claude-mcp-env');
    const env = r.session.environment!;
    expect(env.skillOriginCounts.stock).toBe(1);
    expect(env.mcpServers).toEqual(['computer-use', 'linkedin']);
    expect(env.mcpToolCalls).toBe(3);
  });

  it('NO dropped M3 fields are present (no hooks / CLAUDE.md / commandCount)', () => {
    const r = reportOf('claude-mcp-env');
    const env = r.session.environment! as Record<string, unknown>;
    for (const dropped of ['hasClaudeMd', 'hasAgentsMd', 'hooksPresent', 'hookEventCounts', 'authoredCommands', 'commandCount', 'authoredSkills']) {
      expect(dropped in env).toBe(false);
    }
  });
});

// ─── M4 — flow + scopeShape ───────────────────────────────────────────────────────────────
describe('M4 — flow fact + scopeShape gate', () => {
  it('a subagent-parallel session → parallelism:"subagents" + a dispatch volume from Agent count', () => {
    const r = reportOf('claude-compact-lanestart');
    expect(r.session.flow!.parallelism).toBe('subagents');
    expect(r.session.flow!.subagentDispatchVolume).toBe(1); // Task folded to Agent
  });

  it('a single-lane session → parallelism:"none"', () => {
    const r = reportOf('claude-plain');
    expect(r.session.flow!.parallelism).toBe('none');
  });

  it('frameworkInvoked from a PURE session signal (stock-origin skill) — never detectMandateAdapter', () => {
    const r = reportOf('claude-mcp-env');
    expect(r.session.flow!.frameworkInvoked).toBe(true);
  });

  it('scopeShape uses the FLAT union of edit-paths (root ∪ subagents)', () => {
    // synthetic: a root edit + a subagent edit → multiFile true via the flat union.
    const parent = jsonl([
      { type: 'assistant', sessionId: 's', uuid: 'u1', timestamp: '2026-06-08T00:00:01.000Z',
        message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-6',
          content: [{ type: 'tool_use', id: 'd', name: 'Task', input: { description: 'x', subagent_type: 'e' } },
                    { type: 'tool_use', id: 'e1', name: 'Write', input: { file_path: 'src/a.ts', content: 'x' } }],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    ]);
    const sub = jsonl([
      { type: 'assistant', isSidechain: true, sessionId: 's', uuid: 'sa1', timestamp: '2026-06-08T00:00:02.000Z',
        message: { id: 'sm1', role: 'assistant', model: 'claude-sonnet-4-6',
          content: [{ type: 'tool_use', id: 'e2', name: 'Edit', input: { file_path: '.github/workflows/ci.yml', old_string: 'a', new_string: 'b' } }],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    ]);
    const blobs: NamedBlob[] = [
      { name: 'parent', bytes: enc(parent) },
      { name: 'subagents/agent-e.jsonl', bytes: enc(sub) },
      { name: 'subagents/agent-e.meta.json', bytes: enc(JSON.stringify({ agentId: 'e', agentType: 'e', description: 'x' })) },
    ];
    const r = analyze(parseSession(blobs, 'claude')!);
    expect(r.session.scopeShape!.multiFile).toBe(true); // root src/a.ts + subagent ci.yml
    expect(r.session.scopeShape!.hasSrc).toBe(true); // src/a.ts
    expect(r.session.scopeShape!.hasGitOrConfig).toBe(true); // .github/workflows/ci.yml
  });
});

// ─── S4 — InterruptEvent robustness LOCK (per-harness, forward-compat) ────────────────────
describe('S4 — InterruptEvent coverage is LOCKED with per-harness fixtures', () => {
  it('Claude: BOTH marker variants (bare + "for tool use") become InterruptEvents', () => {
    const s = parseSession(fixture('claude-interrupt').blobs, 'claude')!;
    const interrupts = s.events.filter((e) => e.type === 'interrupt');
    expect(interrupts.length).toBe(2);
    // the interrupt markers must NOT leak as human prose (precision).
    const proseTexts = s.events.filter((e) => e.type === 'message' && e.role === 'user').map((e) => (e as { text?: string }).text);
    for (const t of proseTexts) expect(t).not.toMatch(/Request interrupted/);
  });

  it('Codex: turn_aborted reason:"interrupted" → an InterruptEvent', () => {
    const s = parseSession(fixture('codex-interrupt').blobs, 'codex')!;
    expect(s.events.filter((e) => e.type === 'interrupt').length).toBe(1);
  });
});

// ─── the surveillance guard (DEEP recursive key-walk + composite-keyword denial) ──────────
describe('META — surveillance guard: NO identity key, NO composite/score key (mirror+extend d1-verdict:84-98)', () => {
  const IDENTITY = ['author', 'authorName', 'authorEmail', 'user', 'userId', 'name', 'email', 'identity', 'person'];
  const COMPOSITE = ['score', 'grade', 'rank', 'hygiene', 'sophistication', 'rating', 'tier', 'percentile'];

  function walkKeys(o: unknown, visit: (k: string) => void): void {
    if (Array.isArray(o)) { for (const v of o) walkKeys(v, visit); return; }
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) { visit(k); walkKeys((o as Record<string, unknown>)[k], visit); }
    }
  }

  // exercise EVERY block across the fixtures so the walk covers nested boundaries[]/splits/gitOps.
  const names = ['claude-compact-inplace', 'claude-compact-lanestart', 'claude-gitchain', 'codex-gitchain', 'claude-mcp-env'];

  it('no facts block carries an identity key (deep, incl. nested boundaries[]/lane splits/gitOps)', () => {
    for (const n of names) {
      const meta = buildSessionMeta(parseSession(fixture(n).blobs, fixture(n).harness)!);
      walkKeys(meta, (k) => {
        expect(IDENTITY.includes(k), `identity key "${k}" in ${n}`).toBe(false);
      });
    }
  });

  it('no facts block carries a COMPOSITE/score key (the forward-defense for rootContextUtilization)', () => {
    for (const n of names) {
      const meta = buildSessionMeta(parseSession(fixture(n).blobs, fixture(n).harness)!);
      walkKeys(meta, (k) => {
        const lk = k.toLowerCase();
        for (const bad of COMPOSITE) {
          expect(lk.includes(bad), `composite key "${k}" (~${bad}) in ${n}`).toBe(false);
        }
      });
    }
  });
});

// ─── determinism + freeze (schemaVersion stays 2; parse-twice identical) ──────────────────
describe('META — determinism + freeze', () => {
  it('Report.schemaVersion stays 2 even with the meta-facts blocks present', () => {
    const r = reportOf('claude-compact-inplace');
    expect(r.schemaVersion).toBe(2);
  });

  it('parse-twice → analyze-twice byte-identical (the meta-facts blocks are deterministic)', () => {
    for (const n of ['claude-gitchain', 'claude-compact-lanestart', 'claude-mcp-env', 'codex-gitchain']) {
      const fx = fixture(n);
      const a = analyze(parseSession(fx.blobs.map((b) => ({ name: b.name, bytes: new Uint8Array(b.bytes) })), fx.harness)!);
      const b = analyze(parseSession(fx.blobs.map((b) => ({ name: b.name, bytes: new Uint8Array(b.bytes) })), fx.harness)!);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

// ─── CONTEXT_LIMITS is PRICES-class reference data (no judge model) ───────────────────────
describe('META — CONTEXT_LIMITS is PRICES-class reference data', () => {
  it('a known model resolves a positive limit; an unknown model → undefined (never guessed)', () => {
    expect(contextLimitFor('claude-sonnet-4-6')).toBeGreaterThan(0);
    expect(contextLimitFor('some-future-model-9')).toBeUndefined();
    expect(CONTEXT_LIMITS.length).toBeGreaterThan(0);
  });
});

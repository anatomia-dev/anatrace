import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyze.js';
import { parseSession } from '../src/parse.js';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { buildSessionMeta } from '../src/meta/facts.js';
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

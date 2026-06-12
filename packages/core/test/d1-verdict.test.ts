import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import {
  verdictForClaim,
  verdictsForMandate,
  type ComplianceVerdict,
} from '../src/verdict.js';
import type { Mandate, MandateClaim, CheckableClaim, Matcher } from '../src/mandate.js';
import type { NormalizedSession } from '../src/session.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

function assistant(content: unknown[], uuid: string, ts: string): unknown {
  return {
    type: 'assistant',
    sessionId: 's',
    uuid,
    timestamp: ts,
    message: {
      id: `m-${uuid}`,
      role: 'assistant',
      model: 'claude-opus-4-8',
      content,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}
function userText(text: string, uuid: string, ts: string): unknown {
  return { type: 'user', sessionId: 's', uuid, timestamp: ts, message: { role: 'user', content: text } };
}

const xaSource = (slug: string, p: string): CheckableClaim['source'] => ({
  kind: 'cross-artifact',
  workItemSlug: slug,
  path: p,
  fidelity: 'verbatim',
});

function readPathClaim(value: string, matcher: 'contains' | 'not_contains'): CheckableClaim {
  return {
    id: 'verify-independence',
    says: `the verifier never reads ${value}`,
    kind: 'human-constraint',
    scope: { kind: 'whole-session' },
    source: xaSource('plan', 'contract.yaml'),
    predicate: { target: 'read-paths', matcher, scope: 'transcript', value },
  };
}
function editPathsClaim(id: string, value: string): CheckableClaim {
  return {
    id,
    says: `edits stay within ${value}`,
    kind: 'file-scope',
    scope: { kind: 'whole-session' },
    source: xaSource('plan', 'contract.yaml'),
    predicate: { target: 'edit-paths', matcher: 'contains', scope: 'transcript', value },
  };
}

// ─── the closed key set (the E2 structural guard) ────────────────────────────────────────
describe('D1 — ComplianceVerdict key set is FROZEN (no rationale/severity/model leak)', () => {
  const ALLOWED = new Set(['claimId', 'status', 'reason', 'evidence', 'source']);
  function assertKeySet(v: ComplianceVerdict): void {
    for (const k of Object.keys(v)) expect(ALLOWED.has(k)).toBe(true);
    expect(v.source).toBe('deterministic');
    expect('rationale' in v).toBe(false);
    expect('severity' in v).toBe(false);
    expect('model' in v).toBe(false);
  }

  it('every verdict across the matrix carries ONLY {claimId,status,reason,evidence,source}', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'tool_use', name: 'Read', input: { file_path: '/r/.ana/build_report.md' } }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    const claims: MandateClaim[] = [
      readPathClaim('build_report', 'not_contains'),
      { id: 'i', says: 'do good work', kind: 'intent', scope: { kind: 'whole-session' }, source: xaSource('p', 'c.yaml') },
    ];
    for (const c of claims) assertKeySet(verdictForClaim(c, s));
  });
});

// ─── the surveillance guardrail (STRUCTURAL — no identity key, no people-ranking) ───────
describe('D1 — surveillance guardrail: a verdict keys ONLY on claimId, never an identity', () => {
  const FORBIDDEN = ['author', 'authorName', 'authorEmail', 'user', 'userId', 'name', 'email', 'identity', 'person'];
  it('no ComplianceVerdict field is an author/identity key (the verdict keys on claimId)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'tool_use', name: 'Read', input: { file_path: '/r/.ana/build_report.md' } }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    const v = verdictForClaim(readPathClaim('build_report', 'not_contains'), s);
    for (const k of Object.keys(v)) expect(FORBIDDEN.includes(k)).toBe(false);
    // the join key is the OBLIGATION (claimId), not a person.
    expect(typeof v.claimId).toBe('string');
    // evidence pointers carry an agent ROLE (root/subagent), never an author name.
    for (const p of v.evidence) {
      expect(p.agent.kind === 'root' || p.agent.kind === 'subagent').toBe(true);
      expect('author' in p).toBe(false);
      expect('name' in p).toBe(false);
    }
  });
});

// ─── universal pre-checks (in order) ─────────────────────────────────────────────────────
describe('D1 — universal pre-checks resolve in order', () => {
  const empty = (): NormalizedSession => claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant([], 'a1', '2026-06-08T00:00:01.000Z')])) }])!;

  it('confidence:"low" → unverifiable(low-confidence) BEFORE anything else', () => {
    const c: MandateClaim = { ...readPathClaim('x', 'not_contains'), confidence: 'low' };
    expect(verdictForClaim(c, empty())).toMatchObject({ status: 'unverifiable', reason: 'low-confidence' });
  });
  it('intent / no predicate → unverifiable(routed-to-llm)', () => {
    const c: MandateClaim = { id: 'i', says: '', kind: 'intent', scope: { kind: 'whole-session' }, source: xaSource('p', 'c') };
    expect(verdictForClaim(c, empty())).toMatchObject({ status: 'unverifiable', reason: 'routed-to-llm' });
  });
  it('predicate.scope:"runtime" → unverifiable(runtime-scoped) (the honesty gate)', () => {
    const c: CheckableClaim = {
      id: 'cm', says: '', kind: 'contract-matcher', scope: { kind: 'whole-session' }, source: xaSource('p', 'c'),
      predicate: { target: 'file-content', matcher: 'contains', scope: 'runtime', value: 'x' },
    };
    expect(verdictForClaim(c, empty())).toMatchObject({ status: 'unverifiable', reason: 'runtime-scoped' });
  });
});

// ─── read-paths (verify-independence) + negative-matcher mapping ──────────────────────────
describe('D1 — read-paths binds to Read.file_path; negative-matcher mapping pinned', () => {
  function sessWith(reads: string[], greps: string[] = []): NormalizedSession {
    const content = [
      ...reads.map((p) => ({ type: 'tool_use', name: 'Read', input: { file_path: p } })),
      ...greps.map((p) => ({ type: 'tool_use', name: 'Grep', input: { pattern: p, path: '/r' } })),
    ];
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant(content, 'a1', '2026-06-08T00:00:01.000Z')])) }])!;
  }

  it('not_contains + a real Read of the path → violated(predicate-not-matched) with evidence', () => {
    const v = verdictForClaim(readPathClaim('build_report', 'not_contains'), sessWith(['/r/.ana/build_report.md']));
    expect(v).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(v.evidence.length).toBeGreaterThan(0);
  });
  it('not_contains + only a Grep reference → satisfied(predicate-matched) (the killed near-miss)', () => {
    const v = verdictForClaim(readPathClaim('build_report', 'not_contains'), sessWith([], ['build_report']));
    expect(v).toMatchObject({ status: 'satisfied', reason: 'predicate-matched' });
  });
  it('Codex session (no Read-tool shape) → unverifiable(codex-blind)', () => {
    const s = { harness: 'codex', events: [] } as unknown as NormalizedSession;
    expect(verdictForClaim(readPathClaim('build_report', 'not_contains'), s)).toMatchObject({ status: 'unverifiable', reason: 'codex-blind' });
  });
});

// ─── message-text (literal includes, never RegExp) ───────────────────────────────────────
describe('D1 — message-text uses literal includes (never RegExp)', () => {
  function sess(text: string): NormalizedSession {
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'text', text }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
  }
  const claim: CheckableClaim = {
    id: 'msg', says: 'announces the plan', kind: 'human-constraint', scope: { kind: 'whole-session' }, source: xaSource('p', 'c'),
    predicate: { target: 'message-text', matcher: 'contains', scope: 'transcript', value: 'I am done.*', role: 'assistant', literalsOnly: true },
  };
  it('a literal substring present → satisfied', () => {
    expect(verdictForClaim(claim, sess('I am done.* with the work')).status).toBe('satisfied');
  });
  it('treated as a LITERAL — a regex-shaped value does NOT match plain prose', () => {
    expect(verdictForClaim(claim, sess('I am done with the work')).status).toBe('unverifiable');
  });
});

// ─── file-scope SET rule (DECISIONS A+B) ─────────────────────────────────────────────────
describe('D1-FILESCOPE — SET/whitelist-union rule (NARROW→violated, MASS→Finding)', () => {
  function sessEdits(paths: string[]): NormalizedSession {
    const content = paths.map((p, i) => ({ type: 'tool_use', id: `e${i}`, name: 'Write', input: { file_path: p, content: 'x' } }));
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant(content, 'a1', '2026-06-08T00:00:01.000Z')])) }])!;
  }
  const WL = ['packages/cli/src/commands/scan.ts', 'packages/cli/tests/commands/scan.test.ts'];
  function mandate(): Mandate {
    return { schemaVersion: 1, framework: 'anatomia', claims: WL.map((p, i) => editPathsClaim(`fs${i}`, p)) };
  }

  it('reproduces the scan-card-redesign exemplar: an undeclared SOURCE edit → violated', () => {
    const s = sessEdits([...WL, 'packages/cli/src/utils/displayNames.ts']);
    const findings: { ruleId: string; count: number }[] = [];
    const vs = verdictsForMandate(mandate(), s, undefined, findings);
    // length invariant: one verdict per claim
    expect(vs).toHaveLength(2);
    expect(vs.every((v) => v.status === 'violated')).toBe(true);
    expect(findings).toHaveLength(0); // NARROW is a verdict, not a Finding
  });

  it('the sibling TEST of an in-contract source is licensed (not flagged)', () => {
    // only the whitelisted source + an extra test sibling → no source deviation
    const s = sessEdits(['packages/cli/src/commands/scan.ts', 'packages/cli/src/commands/scan.extra.test.ts']);
    const vs = verdictsForMandate(mandate(), s);
    expect(vs.every((v) => v.status === 'satisfied')).toBe(true);
  });

  it('collateral (.ana / snapshots / lockfiles) is ignored', () => {
    const s = sessEdits([...WL, '.ana/plans/active/x/build_report.md', 'pnpm-lock.yaml', 'packages/cli/__snapshots__/x.snap']);
    const vs = verdictsForMandate(mandate(), s);
    expect(vs.every((v) => v.status === 'satisfied')).toBe(true);
  });

  it('worktree-prefixed absolute edits normalize (relativize-then-strip) and match the whitelist', () => {
    const s = sessEdits(['/u/proj/.ana/worktrees/scan-card-redesign/packages/cli/src/commands/scan.ts']);
    const vs = verdictsForMandate(mandate(), s);
    expect(vs.every((v) => v.status === 'satisfied')).toBe(true);
  });

  it('MASS (≥4 undeclared source) → a non-gating info Finding, NOT a violated verdict (DECISION B)', () => {
    const extras = ['a/b/c1.ts', 'a/b/c2.ts', 'a/b/c3.ts', 'a/b/c4.ts'];
    const s = sessEdits([...WL, ...extras]);
    const findings: { ruleId: string; message: string; count: number }[] = [];
    const vs = verdictsForMandate(mandate(), s, undefined, findings);
    expect(vs.every((v) => v.status === 'satisfied')).toBe(true); // no violated verdict
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('compliance/contract-under-specified');
    expect(findings[0].count).toBe(4);
  });

  it('empty edit-set → satisfied (vacuously "stays within X"), never unverifiable', () => {
    const s = sessEdits(WL);
    const vs = verdictsForMandate(mandate(), s);
    expect(vs.every((v) => v.status === 'satisfied' && v.reason === 'predicate-matched')).toBe(true);
  });
});

// ─── file-scope: ABSOLUTE non-worktree edits + the repoRoot plumb + never-false-accuse net ──
describe('D1-FILESCOPE — absolute non-worktree edits: repoRoot relativizes; unknown root never false-accuses', () => {
  function sessEdits(paths: string[]): NormalizedSession {
    const content = paths.map((p, i) => ({ type: 'tool_use', id: `e${i}`, name: 'Write', input: { file_path: p, content: 'x' } }));
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant(content, 'a1', '2026-06-08T00:00:01.000Z')])) }])!;
  }
  const WL = ['packages/cli/src/commands/scan.ts', 'packages/cli/tests/commands/scan.test.ts'];
  function mandate(): Mandate {
    return { schemaVersion: 1, framework: 'anatomia', claims: WL.map((p, i) => editPathsClaim(`fs${i}`, p)) };
  }
  const REPO = '/Users/rsmith/Projects/anatomia_project/anatomia';

  it('(1) a non-worktree ABSOLUTE source edit WITH a supplied repoRoot → relativizes → matches the whitelist → NOT flagged', () => {
    // The whitelisted source, but edited via its ABSOLUTE path (Spike A: ~169/463 source edits).
    const s = sessEdits([`${REPO}/packages/cli/src/commands/scan.ts`]);
    const vs = verdictsForMandate(mandate(), s, undefined, undefined, REPO);
    expect(vs.every((v) => v.status === 'satisfied' && v.reason === 'predicate-matched')).toBe(true);
  });

  it('(2) a non-worktree ABSOLUTE source edit WITHOUT a supplied root → the safety net → NOT false-flagged (no violated)', () => {
    // An out-of-contract absolute SOURCE edit, root UNKNOWN: it stays absolute → non-comparable →
    // must NEVER produce a `violated`. (Before the fix this false-accused.)
    const s = sessEdits([...WL, `${REPO}/packages/cli/src/utils/displayNames.ts`]);
    const findings: { ruleId: string; count: number }[] = [];
    const vs = verdictsForMandate(mandate(), s, undefined, findings);
    expect(vs.some((v) => v.status === 'violated')).toBe(false);
    expect(findings).toHaveLength(0); // not a MASS Finding either — it's simply excluded
  });

  it('(2b) WITH the root the SAME out-of-contract absolute source edit DOES relativize → violated (the fix detects honestly)', () => {
    const s = sessEdits([...WL, `${REPO}/packages/cli/src/utils/displayNames.ts`]);
    const vs = verdictsForMandate(mandate(), s, undefined, undefined, REPO);
    expect(vs.some((v) => v.status === 'violated')).toBe(true);
  });

  it('(3) regression: the worktree-prefixed case still normalizes (strip) and matches the whitelist', () => {
    const s = sessEdits(['/u/proj/.ana/worktrees/scan-card-redesign/packages/cli/src/commands/scan.ts']);
    const vs = verdictsForMandate(mandate(), s);
    expect(vs.every((v) => v.status === 'satisfied')).toBe(true);
  });

  it('(4) regression: the scan-card-redesign exemplar (in-worktree out-of-contract displayNames.ts) still → violated', () => {
    const s = sessEdits([
      '/u/proj/.ana/worktrees/scan-card-redesign/packages/cli/src/commands/scan.ts',
      '/u/proj/.ana/worktrees/scan-card-redesign/packages/cli/src/utils/displayNames.ts',
    ]);
    const findings: { ruleId: string; count: number }[] = [];
    const vs = verdictsForMandate(mandate(), s, undefined, findings);
    expect(vs.some((v) => v.status === 'violated')).toBe(true);
    expect(findings).toHaveLength(0); // NARROW → a verdict, not a Finding
  });
});

// ─── skill-events absence → unverifiable(absent-signal), NEVER violated ──────────────────
describe('D1 — skill-events honesty (absence is unverifiable, never violated)', () => {
  const claim: CheckableClaim = {
    id: 'skill', says: 'uses the executing-plans skill', kind: 'skill-invoked', scope: { kind: 'whole-session' },
    source: xaSource('p', 'c'), predicate: { target: 'skill-events', matcher: 'contains', scope: 'transcript', value: 'executing-plans' },
  };
  it('a present structured Skill invocation → satisfied', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'tool_use', name: 'Skill', input: { skill: 'executing-plans' } }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    expect(verdictForClaim(claim, s).status).toBe('satisfied');
  });
  it('absence → unverifiable(absent-signal), NEVER violated', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant([], 'a1', '2026-06-08T00:00:01.000Z')])) }])!;
    expect(verdictForClaim(claim, s)).toMatchObject({ status: 'unverifiable', reason: 'absent-signal' });
  });
});

// ─── window resolver (structured open, not a text scan) ──────────────────────────────────
describe('D1 — window resolver binds opens to the STRUCTURED event (Spike C)', () => {
  const windowedSkillClaim: CheckableClaim = {
    id: 'win', says: 'within the executing-plans window, announces', kind: 'skill-invoked',
    subject: { kind: 'agent', selector: 'this', delegates: 'exclude' },
    scope: { kind: 'event-triggered-window', opensOn: 'skill-invoked', closesOn: 'rest-of-session' },
    source: xaSource('p', 'c'),
    predicate: { target: 'message-text', matcher: 'contains', scope: 'transcript', value: 'PHASE 1', role: 'assistant', literalsOnly: true },
  };
  it('no structured open event on the lane → unverifiable(window-unresolvable)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'text', text: 'PHASE 1 starting' }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    expect(verdictForClaim(windowedSkillClaim, s, undefined, undefined, '', { thisAgent: { kind: 'root' } })).toMatchObject({ status: 'unverifiable', reason: 'window-unresolvable' });
  });
  it('a structured Skill open + the literal LATER in the window → satisfied', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'tool_use', name: 'Skill', input: { skill: 'executing-plans' } }], 'a1', '2026-06-08T00:00:01.000Z'),
      assistant([{ type: 'text', text: 'PHASE 1 go' }], 'a2', '2026-06-08T00:00:02.000Z'),
    ])) }])!;
    expect(verdictForClaim(windowedSkillClaim, s, undefined, undefined, '', { thisAgent: { kind: 'root' } }).status).toBe('satisfied');
  });
  it('the literal BEFORE the window open is NOT counted (window correctly bounds)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'text', text: 'PHASE 1 early' }], 'a0', '2026-06-08T00:00:00.000Z'),
      assistant([{ type: 'tool_use', name: 'Skill', input: { skill: 'executing-plans' } }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    // open exists, but the literal only appears BEFORE it → absent in the window → unverifiable(absent-signal)
    expect(verdictForClaim(windowedSkillClaim, s, undefined, undefined, '', { thisAgent: { kind: 'root' } })).toMatchObject({ status: 'unverifiable', reason: 'absent-signal' });
  });
});

// ─── FI-17 matcher totality (no unhandled matcher ever silently passes) ───────────────────
describe('D1 — FI-17 matcher totality: an unhandled matcher → unverifiable, never silent satisfied', () => {
  // The FULL Matcher union (mandate.ts) — iterate every member per arm.
  const ALL: Matcher[] = ['contains', 'not_contains', 'equals', 'not_equals', 'exists', 'matches', 'gte', 'lte'];
  // The matchers each string arm can mechanically compare; everything else → content-unresolvable.
  const COMPARABLE = new Set<Matcher>(['contains', 'not_contains', 'equals', 'not_equals', 'exists']);
  // The matchers that are NEVER mechanically comparable → must be unverifiable on EVERY arm.
  const NEVER: Matcher[] = ['matches', 'gte', 'lte'];

  function sessReads(p: string): NormalizedSession {
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'tool_use', name: 'Read', input: { file_path: p } }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
  }
  function sessTool(name: string): NormalizedSession {
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'tool_use', name, input: {} }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
  }
  function sessEdit(p: string): NormalizedSession {
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'tool_use', id: 'e0', name: 'Write', input: { file_path: p, content: 'x' } }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
  }
  function sessMsg(text: string): NormalizedSession {
    return claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'text', text }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
  }

  function readClaimM(m: Matcher): CheckableClaim {
    return { id: 'r', says: '', kind: 'human-constraint', scope: { kind: 'whole-session' }, source: xaSource('p', 'c'),
      predicate: { target: 'read-paths', matcher: m, scope: 'transcript', value: 'x' } };
  }
  function editForbiddenClaimM(m: Matcher): CheckableClaim {
    return { id: 'e', says: '', kind: 'file-scope', scope: { kind: 'whole-session' }, source: xaSource('p', 'c'),
      predicate: { target: 'edit-paths', matcher: m, scope: 'transcript', value: 'forbidden/x.ts' } };
  }
  function toolClaimM(m: Matcher): CheckableClaim {
    return { id: 't', says: '', kind: 'command-run', scope: { kind: 'whole-session' }, source: xaSource('p', 'c'),
      predicate: { target: 'tool-names', matcher: m, scope: 'transcript', value: 'Bash' } };
  }
  function msgClaimM(m: Matcher): CheckableClaim {
    return { id: 'm', says: '', kind: 'human-constraint', scope: { kind: 'whole-session' }, source: xaSource('p', 'c'),
      predicate: { target: 'message-text', matcher: m, scope: 'transcript', value: 'hello', role: 'assistant', literalsOnly: true } };
  }

  it('read-paths: matches/gte/lte → unverifiable(content-unresolvable); never a silent satisfied', () => {
    for (const m of NEVER) {
      const v = verdictForClaim(readClaimM(m), sessReads('/r/x'));
      expect(v).toMatchObject({ status: 'unverifiable', reason: 'content-unresolvable' });
    }
  });
  it('edit-paths whitelist arm: matches/gte/lte → unverifiable(content-unresolvable) (only `contains` does SET membership)', () => {
    // The positive edit-paths arm implements file-scope SET membership, which only `contains`
    // expresses. A non-`contains` positive matcher is not mechanically applicable → honest
    // `unverifiable`, consistent with the read-paths/tool-names/message-text arms — NEVER
    // silently coerced to satisfied.
    for (const m of NEVER) {
      const v = verdictForClaim(editForbiddenClaimM(m), sessEdit('forbidden/x.ts'));
      expect(v).toMatchObject({ status: 'unverifiable', reason: 'content-unresolvable' });
    }
  });
  it('tool-names: matches/gte/lte → unverifiable(content-unresolvable)', () => {
    for (const m of NEVER) {
      const v = verdictForClaim(toolClaimM(m), sessTool('Bash'));
      expect(v).toMatchObject({ status: 'unverifiable', reason: 'content-unresolvable' });
    }
  });
  it('message-text: matches/gte/lte → unverifiable(content-unresolvable)', () => {
    for (const m of NEVER) {
      const v = verdictForClaim(msgClaimM(m), sessMsg('hello world'));
      expect(v).toMatchObject({ status: 'unverifiable', reason: 'content-unresolvable' });
    }
  });
  it('totality: NO comparable matcher arm ever returns a bare false-pass (every member resolves)', () => {
    // Sanity: each comparable matcher resolves to one of the three statuses (no throw, no undefined).
    for (const m of ALL) {
      const ok = ['satisfied', 'violated', 'unverifiable'];
      expect(ok).toContain(verdictForClaim(readClaimM(m), sessReads('/r/x')).status);
      expect(ok).toContain(verdictForClaim(toolClaimM(m), sessTool('Bash')).status);
      expect(ok).toContain(verdictForClaim(msgClaimM(m), sessMsg('hello')).status);
    }
    expect(COMPARABLE.size).toBe(5);
  });
});

// ─── the length invariant ────────────────────────────────────────────────────────────────
describe('D1 — verdicts.length === claims.length (every claim gets a verdict)', () => {
  it('emits one verdict per claim, claim order preserved (incl. intent/routed)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([assistant([], 'a1', '2026-06-08T00:00:01.000Z')])) }])!;
    const m: Mandate = {
      schemaVersion: 1, framework: 'x',
      claims: [
        { id: 'i', says: '', kind: 'intent', scope: { kind: 'whole-session' }, source: xaSource('p', 'c') },
        readPathClaim('build_report', 'not_contains'),
        editPathsClaim('fs', 'src/a.ts'),
      ],
    };
    const vs = verdictsForMandate(m, s);
    expect(vs.map((v) => v.claimId)).toEqual(['i', 'verify-independence', 'fs']);
  });
});

import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { parseSession } from '../src/parse.js';
import { verdictForClaim } from '../src/verdict.js';
import { laneCapture } from '../src/meta/lane.js';
import { anatomiaAdapter } from '../src/adapters/anatomia.js';
import { skillsInvoked } from '../src/skills.js';
import { severityForVerdict, complianceFindings } from '../src/compliance-config.js';
import { ciExitCode } from '../src/sarif.js';
import { loadCorpus } from './_corpus.js';
import type { Mandate } from '../src/mandate.js';
import type { CheckableClaim } from '../src/mandate.js';
import type { NormalizedSession } from '../src/session.js';
import type { NamedBlob } from '../src/adapter.js';

/**
 * POSITIVE OBLIGATIONS (required-step verification) — the cardinal-sin guard.
 *
 * The single load-bearing property under test: there is NO path to a FALSE `violated` on a
 * clean / incomplete / unobservable lane. A `required` skill's absence flips to `violated` ONLY
 * on a lane that is BOTH reliably observable (structured `Skill` events) AND complete; every
 * other shape (lane-start, Codex, announce-only, optional, present-in-subagent) must NOT violate.
 */

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
function skillUse(skill: string, uuid: string, ts: string): unknown {
  return assistant([{ type: 'tool_use', name: 'Skill', input: { skill } }], uuid, ts);
}
function compactBoundary(uuid: string, ts: string): unknown {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    sessionId: 's',
    uuid,
    timestamp: ts,
    compactMetadata: { trigger: 'manual', preTokens: 177500 },
  };
}

const inBlob: CheckableClaim['source'] = { kind: 'in-blob', blob: 'agents/ana-verify.md', fidelity: 'verbatim' };

function requiredSkill(skill: string): CheckableClaim {
  return {
    id: `ana-verify:skill:${skill}`,
    says: `ana-verify must load the ${skill} skill`,
    kind: 'skill-invoked',
    scope: { kind: 'whole-session' },
    source: inBlob,
    strength: 'required',
    predicate: { target: 'skill-events', scope: 'transcript', matcher: 'contains', value: skill },
  };
}
function optionalSkill(skill: string): CheckableClaim {
  return {
    id: `ana-plan:skill:${skill}`,
    says: `ana-plan loads the ${skill} skill`,
    kind: 'skill-invoked',
    scope: { kind: 'whole-session' },
    source: inBlob,
    // NO strength key → optional (the default).
    predicate: { target: 'skill-events', scope: 'transcript', matcher: 'contains', value: skill },
  };
}
function forbiddenSkill(skill: string): CheckableClaim {
  return {
    id: `ana-verify:skill:${skill}`,
    says: `ana-verify must NOT load the ${skill} skill`,
    kind: 'skill-invoked',
    scope: { kind: 'whole-session' },
    source: inBlob,
    strength: 'forbidden',
    predicate: { target: 'skill-events', scope: 'transcript', matcher: 'contains', value: skill },
  };
}

// ─── #1 — required absent on a COMPLETE, structured-Skill-emitting lane → violated ───────────
describe('PO #1 — required absent on a complete + observable lane → violated (with evidence)', () => {
  it('a complete root lane that emits SOME structured Skill but NOT the required one → violated', () => {
    // The lane is observable (a structured Skill tool_use is present) and complete (no boundary),
    // and the required skill `testing-standards` is genuinely absent → a PROVABLE skip.
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      skillUse('coding-standards', 'a1', '2026-06-08T00:00:01.000Z'),
      assistant([{ type: 'text', text: 'done' }], 'a2', '2026-06-08T00:00:02.000Z'),
    ])) }])!;
    const v = verdictForClaim(requiredSkill('testing-standards'), s);
    expect(v).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(v.evidence.length).toBeGreaterThan(0); // points at the expected locus
  });

  it('the SAME lane with the required skill present → satisfied', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      skillUse('testing-standards', 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    expect(verdictForClaim(requiredSkill('testing-standards'), s).status).toBe('satisfied');
  });
});

// ─── #2 — required absent on lane-start / Codex / announce-only → unverifiable (NEVER violated)
describe('PO #2 — the cardinal-sin guard: required absent on an UNOBSERVABLE/INCOMPLETE lane', () => {
  it('a LANE-START lane (boundary at line 0, zero prior messages) → unverifiable, NEVER violated', () => {
    // A subagent lane whose first event IS the compaction boundary: pre-history was never in-file.
    // It DOES emit a structured Skill afterward (observable), but it is ungradeable → unverifiable.
    const s = claudeAdapter.parse([
      { name: 'parent', bytes: enc(jsonl([
        skillUse('coding-standards', 'p1', '2026-06-08T00:00:01.000Z'),
      ])) },
      { name: 'agent-sub1.jsonl', bytes: enc(jsonl([
        compactBoundary('c0', '2026-06-08T00:00:02.000Z'),
        skillUse('git-workflow', 's1', '2026-06-08T00:00:03.000Z'),
      ])) },
    ])!;
    expect(laneCapture(s, { kind: 'subagent', subagentId: 'sub1' })).toBe('lane-start');
    const v = verdictForClaim(requiredSkill('testing-standards'), s);
    expect(v.status).toBe('unverifiable');
    expect(v.status).not.toBe('violated');
  });

  it('a COMPACTION-DROPPED-skill negative resolves unverifiable (not violated) — the seeded recall case', () => {
    // The root lane compacted (a boundary AFTER some messages → compacted-in-place, gradeable) but
    // a SUBAGENT lane is lane-start. The required skill could have run in the subagent's dropped
    // pre-history → the union has an incomplete lane → unverifiable, never a false skip.
    const s = claudeAdapter.parse([
      { name: 'parent', bytes: enc(jsonl([
        skillUse('coding-standards', 'p1', '2026-06-08T00:00:01.000Z'),
        assistant([{ type: 'text', text: 'work' }], 'p2', '2026-06-08T00:00:02.000Z'),
        compactBoundary('pc', '2026-06-08T00:00:03.000Z'),
      ])) },
      { name: 'agent-dropped.jsonl', bytes: enc(jsonl([
        compactBoundary('dc', '2026-06-08T00:00:04.000Z'),
        assistant([{ type: 'text', text: 'post' }], 'd1', '2026-06-08T00:00:05.000Z'),
      ])) },
    ])!;
    expect(laneCapture(s, { kind: 'root' })).toBe('compacted-in-place');
    expect(laneCapture(s, { kind: 'subagent', subagentId: 'dropped' })).toBe('lane-start');
    const v = verdictForClaim(requiredSkill('testing-standards'), s);
    expect(v).toMatchObject({ status: 'unverifiable', reason: 'content-unresolvable' });
    expect(v.status).not.toBe('violated');
  });

  it('a CODEX session (no Skill primitive) → unverifiable(codex-blind), NEVER violated', () => {
    const s = { harness: 'codex', sessionId: 's', schemaVersion: 1, observedVersions: [], subagents: [], events: [], counts: {} } as unknown as NormalizedSession;
    const v = verdictForClaim(requiredSkill('testing-standards'), s);
    expect(v).toMatchObject({ status: 'unverifiable', reason: 'codex-blind' });
  });

  it('an ANNOUNCE-TEXT-only lane (no structured Skill) → unverifiable(low-confidence), NEVER violated', () => {
    // A skill known ONLY by an announce-text match is NOT a structured emitter → half-(a) of the
    // gate fails (the harness only ANNOUNCES; it never proves a structured invocation). The
    // announce-text SkillEvent shape (Codex's portable signal) is hand-built on a Claude session
    // here to isolate the gate's low-confidence arm (Codex itself short-circuits to codex-blind).
    const s: NormalizedSession = {
      schemaVersion: 2,
      harness: 'claude',
      sessionId: 's',
      observedVersions: [],
      subagents: [],
      events: [
        { type: 'skill', skill: 'coding-standards', source: 'announce-text', agent: { kind: 'root' }, blobName: 'parent', lineIndex: 0 },
      ],
      counts: {} as NormalizedSession['counts'],
    };
    const v = verdictForClaim(requiredSkill('testing-standards'), s);
    expect(v).toMatchObject({ status: 'unverifiable', reason: 'low-confidence' });
    expect(v.status).not.toBe('violated');
  });

  it('a lane with NO skill signal at all (announce or structured) → unverifiable(absent-signal)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'text', text: 'just talking' }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    const v = verdictForClaim(requiredSkill('testing-standards'), s);
    expect(v).toMatchObject({ status: 'unverifiable', reason: 'absent-signal' });
    expect(v.status).not.toBe('violated');
  });
});

// ─── #3 — present in a SUBAGENT lane only → satisfied (the flat-union false-violated guard) ──
describe('PO #3 — required present in a SUBAGENT lane only → satisfied (flat union, never violated)', () => {
  it('the required skill runs ONLY in a subagent (root never does) → satisfied', () => {
    const s = claudeAdapter.parse([
      { name: 'parent', bytes: enc(jsonl([
        assistant([{ type: 'text', text: 'dispatching' }], 'p1', '2026-06-08T00:00:01.000Z'),
      ])) },
      { name: 'agent-worker.jsonl', bytes: enc(jsonl([
        skillUse('testing-standards', 's1', '2026-06-08T00:00:02.000Z'),
      ])) },
    ])!;
    // The flat union (root ∪ descendants) sees the subagent's skill → satisfied, NOT a false skip.
    expect(verdictForClaim(requiredSkill('testing-standards'), s).status).toBe('satisfied');
  });
});

// ─── #4 — strength: phantom-obligation guard + the forbidden arm ─────────────────────────────
describe('PO #4 — strength is DECLARED: phantom guard + forbidden arm', () => {
  it('an OPTIONAL skill absent (the ana-plan testing-standards phantom) → NO violated', () => {
    // A complete, observable lane that omits an OPTIONAL skill must NOT violate (default behavior).
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      skillUse('coding-standards', 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    const v = verdictForClaim(optionalSkill('testing-standards'), s);
    expect(v).toMatchObject({ status: 'unverifiable', reason: 'absent-signal' });
    expect(v.status).not.toBe('violated');
  });

  it('a FORBIDDEN skill PRESENT (git-workflow on Verify) → violated', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      skillUse('git-workflow', 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    const v = verdictForClaim(forbiddenSkill('git-workflow'), s);
    expect(v).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
  });

  it('a FORBIDDEN skill ABSENT → satisfied (the negative obligation is met)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      skillUse('coding-standards', 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    expect(verdictForClaim(forbiddenSkill('git-workflow'), s).status).toBe('satisfied');
  });

  it('a FORBIDDEN skill only ANNOUNCED (free text) → NOT violated (cannot prove a structured invoke)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'text', text: 'Using the git-workflow skill.' }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    expect(verdictForClaim(forbiddenSkill('git-workflow'), s).status).not.toBe('violated');
  });
});

// ─── the DECLARED strength map (D-D) — the adapter ships the correct per-(role × skill) map ──
describe('PO — anatomia adapter DECLARES strength per (role × skill); phantom is optional', () => {
  function strengthOf(group: NamedBlob[], claimId: string): string | undefined {
    const m = anatomiaAdapter.extract(group)!;
    const c = m.claims.find((c) => c.id === claimId);
    return c?.strength;
  }
  function agentBlob(name: string, role: string, skills: string[]): NamedBlob {
    const body = `---\nname: ${role}\nskills: [${skills.join(', ')}]\n---\n# ${role}\n`;
    return { name, bytes: enc(body) };
  }

  it('ana-plan testing-standards → OPTIONAL (phantom guard: strength omitted)', () => {
    const g = [agentBlob('agents/ana-plan.md', 'ana-plan', ['testing-standards', 'coding-standards'])];
    expect(strengthOf(g, 'ana-plan:skill:testing-standards')).toBeUndefined(); // optional ⇒ omitted
    // ana-plan coding-standards IS required (Plan needs the standard).
    expect(strengthOf(g, 'ana-plan:skill:coding-standards')).toBe('required');
  });

  it('ana-build coding-standards → OPTIONAL ("available on demand"), git-workflow → required', () => {
    const g = [agentBlob('agents/ana-build.md', 'ana-build', ['coding-standards', 'git-workflow', 'testing-standards'])];
    expect(strengthOf(g, 'ana-build:skill:coding-standards')).toBeUndefined(); // optional
    expect(strengthOf(g, 'ana-build:skill:testing-standards')).toBeUndefined(); // optional
    expect(strengthOf(g, 'ana-build:skill:git-workflow')).toBe('required');
  });

  it('ana-verify git-workflow → FORBIDDEN (read-only on the codebase); testing/coding → required', () => {
    const g = [agentBlob('agents/ana-verify.md', 'ana-verify', ['testing-standards', 'coding-standards', 'git-workflow'])];
    expect(strengthOf(g, 'ana-verify:skill:git-workflow')).toBe('forbidden');
    expect(strengthOf(g, 'ana-verify:skill:testing-standards')).toBe('required');
    expect(strengthOf(g, 'ana-verify:skill:coding-standards')).toBe('required');
  });

  it('an UNRECOGNIZED role → all skills optional (never a false required from an unknown def)', () => {
    const g = [agentBlob('agents/custom-helper.md', 'custom-helper', ['testing-standards', 'git-workflow'])];
    expect(strengthOf(g, 'custom-helper:skill:testing-standards')).toBeUndefined();
    expect(strengthOf(g, 'custom-helper:skill:git-workflow')).toBeUndefined();
  });
});

// ─── R2 byte-identity: an omitted-strength claim is byte-identical to pre-change ─────────────
describe('PO — determinism + byte-identity (omitted strength ≡ pre-change behavior)', () => {
  it('an optional (no-strength) skill claim parses the same verdict twice (parse-twice identical)', () => {
    const bytes = enc(jsonl([skillUse('coding-standards', 'a1', '2026-06-08T00:00:01.000Z')]));
    const s1 = claudeAdapter.parse([{ name: 'parent', bytes }])!;
    const s2 = claudeAdapter.parse([{ name: 'parent', bytes }])!;
    const v1 = verdictForClaim(optionalSkill('coding-standards'), s1);
    const v2 = verdictForClaim(optionalSkill('coding-standards'), s2);
    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
    expect(v1.status).toBe('satisfied'); // present optional → satisfied (unchanged)
  });
});

// ─── PRECISION = 1.0 + synthetic RECALL over the REAL committed corpus (P5) ─────────────────
describe('PO — precision = 1.0 on the clean corpus; synthetic recall holds', () => {
  const corpus = loadCorpus();

  it('the corpus is loaded (a non-empty validation surface)', () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  it('PRECISION: a required claim for a skill the session ACTUALLY ran → NEVER violated (0 false positives)', () => {
    // For every corpus session and every skill it STRUCTURALLY invoked, a `required` claim for
    // that skill must resolve `satisfied` (present) — NEVER `violated`. This is the precision=1.0
    // floor: no compliant/observed run is ever falsely flagged as a skip.
    let falsePositives = 0;
    let checked = 0;
    for (const cs of corpus) {
      const s = parseSession(cs.blobs, cs.harness);
      if (!s) continue;
      for (const inv of skillsInvoked(s)) {
        if (inv.source !== 'tool') continue; // only the structured ones can satisfy
        checked += 1;
        const v = verdictForClaim(requiredSkill(inv.skill), s);
        if (v.status === 'violated') falsePositives += 1;
        expect(v.status).toBe('satisfied');
      }
    }
    expect(falsePositives).toBe(0);
    expect(checked).toBeGreaterThan(0); // we actually exercised the path
  });

  it('PRECISION: NO corpus session produces a false violated for an OPTIONAL (default) skill claim', () => {
    // The whole corpus, every distinct skill name, as an OPTIONAL claim → never violated.
    for (const cs of corpus) {
      const s = parseSession(cs.blobs, cs.harness);
      if (!s) continue;
      for (const inv of skillsInvoked(s)) {
        expect(verdictForClaim(optionalSkill(inv.skill), s).status).not.toBe('violated');
      }
      // and a never-present optional skill is likewise never violated.
      expect(verdictForClaim(optionalSkill('a-skill-this-session-never-ran'), s).status).not.toBe('violated');
    }
  });

  it('RECALL (seeded): a required skill ABSENT on the complete+observable claude-command lane → violated', () => {
    // claude-command structurally invokes `testing-standards` on a COMPLETE root lane (no boundary).
    // A `required` claim for a DIFFERENT skill it never ran is a genuine, provable skip → violated.
    const cs = corpus.find((c) => c.name === 'claude-command')!;
    const s = parseSession(cs.blobs, cs.harness)!;
    expect(laneCapture(s, { kind: 'root' })).toBe('complete');
    const present = skillsInvoked(s).map((i) => i.skill);
    expect(present).toContain('testing-standards'); // the observable structured signal exists
    expect(present).not.toContain('coding-standards'); // genuinely absent
    const v = verdictForClaim(requiredSkill('coding-standards'), s);
    expect(v).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
  });

  it('RECALL (seeded): the compaction fixture lane → unverifiable, NEVER violated', () => {
    // claude-compact-lanestart has a lane-start subagent (and no structured Skill) → a `required`
    // absence on it must resolve `unverifiable`, never a false skip (the cardinal-sin guard live
    // on a real committed fixture).
    const cs = corpus.find((c) => c.name === 'claude-compact-lanestart')!;
    const s = parseSession(cs.blobs, cs.harness)!;
    const v = verdictForClaim(requiredSkill('testing-standards'), s);
    expect(v.status).toBe('unverifiable');
    expect(v.status).not.toBe('violated');
  });
});

// ─── P4 — config + honesty surface (gate + loud-when-incomplete + surveillance guard) ───────
describe('PO P4 — required violated gates; unverifiable never gates; reason is surfaced loudly', () => {
  it('a required-skill VIOLATED maps to its check severity (default error) and GATES', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      skillUse('coding-standards', 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    const claim = requiredSkill('testing-standards');
    const v = verdictForClaim(claim, s);
    expect(v.status).toBe('violated');
    expect(severityForVerdict(v, claim)).toBe('error'); // gating headline
    const mandate: Mandate = { schemaVersion: 1, framework: 'anatomia', claims: [claim] };
    const findings = complianceFindings(mandate, [v], undefined, { violatedOnly: true });
    expect(findings).toHaveLength(1);
    expect(ciExitCode(findings, 'error')).toBe(1); // a genuine policy failure gates CI
  });

  it('a required-skill UNVERIFIABLE (incomplete lane) is info, NEVER gates, and SURFACES the reason', () => {
    const claim = requiredSkill('testing-standards');
    const v = { claimId: claim.id, status: 'unverifiable' as const, reason: 'content-unresolvable' as const, evidence: [], source: 'deterministic' as const };
    expect(severityForVerdict(v, claim)).toBe('info'); // never gates
    const mandate: Mandate = { schemaVersion: 1, framework: 'anatomia', claims: [claim] };
    // loud-when-incomplete: the reason is surfaced in the (non-gating) Finding, not hidden.
    const findings = complianceFindings(mandate, [v]); // not violated-only → unverifiable surfaces
    expect(findings.some((f) => f.message.includes('content-unresolvable'))).toBe(true);
    expect(ciExitCode(findings, 'error')).toBe(0); // unverifiable never pushes past the threshold
  });

  it('SURVEILLANCE GUARD: the new verdict carries ONLY {claimId,status,reason,evidence,source} — never a person', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      skillUse('coding-standards', 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    const v = verdictForClaim(requiredSkill('testing-standards'), s);
    expect(new Set(Object.keys(v))).toEqual(new Set(['claimId', 'status', 'reason', 'evidence', 'source']));
    // evidence pointers carry a lane ROLE (root/subagent), never an author identity.
    for (const p of v.evidence) expect(p.agent.kind === 'root' || p.agent.kind === 'subagent').toBe(true);
  });
});

// ─── lane-capture unit table (the spike-as-code, D-C / OQ-4) ─────────────────────────────────
describe('PO — laneCapture discriminator (positional, structured-marker-only)', () => {
  it('no boundary → complete', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'text', text: 'hi' }], 'a1', '2026-06-08T00:00:01.000Z'),
    ])) }])!;
    expect(laneCapture(s, { kind: 'root' })).toBe('complete');
  });
  it('boundary AFTER ≥1 message → compacted-in-place (gradeable)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      assistant([{ type: 'text', text: 'hi' }], 'a1', '2026-06-08T00:00:01.000Z'),
      compactBoundary('c', '2026-06-08T00:00:02.000Z'),
    ])) }])!;
    expect(laneCapture(s, { kind: 'root' })).toBe('compacted-in-place');
  });
  it('boundary at line 0 (zero prior messages) → lane-start (ungradeable)', () => {
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(jsonl([
      compactBoundary('c', '2026-06-08T00:00:01.000Z'),
      assistant([{ type: 'text', text: 'post' }], 'a1', '2026-06-08T00:00:02.000Z'),
    ])) }])!;
    expect(laneCapture(s, { kind: 'root' })).toBe('lane-start');
  });
});

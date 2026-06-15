import { describe, expect, it } from 'vitest';
import {
  coverageFromExpectedLaunchBoundary,
  type CaptureCoverage,
  type ExpectedLaunchBoundary,
  type MandateEvaluationContext,
} from '../src/capture-coverage.js';
import type { LineageExtraction } from '../src/lineage.js';
import type { CheckableClaim, Mandate } from '../src/mandate.js';
import type { AgentRef, NormalizedSession, SessionEvent } from '../src/session.js';
import { analyze } from '../src/analyze.js';
import { verdictForClaim } from '../src/verdict.js';

const root: AgentRef = { kind: 'root' };
const delegate: AgentRef = { kind: 'subagent', subagentId: 'a' };

function readEvent(agent: AgentRef, path: string, lineIndex: number): SessionEvent {
  return {
    type: 'tool',
    name: 'Read',
    input: { file_path: path },
    agent,
    blobName: agent.kind === 'root' ? 'parent' : 'subagents/agent-a.jsonl',
    lineIndex,
  };
}

function session(events: SessionEvent[]): NormalizedSession {
  return {
    schemaVersion: 1,
    harness: 'claude',
    sessionId: 's',
    observedVersions: [],
    subagents: [
      {
        agentId: 'a',
        agentType: 'worker',
        description: 'delegate',
      },
    ],
    events,
    counts: {
      derive_version: 1,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      turns: 0,
      tool_calls: 0,
      tool_errors: 0,
      edits: 0,
      files_touched: 0,
      duration_ms: 0,
    },
  };
}

function neverRead(subject: CheckableClaim['subject']): CheckableClaim {
  return {
    id: 'no-secret',
    says: 'never reads secret.txt',
    kind: 'human-constraint',
    subject,
    scope: { kind: 'whole-session' },
    source: { kind: 'in-blob', blob: '.anatrace.yaml', fidelity: 'verbatim' },
    predicate: {
      target: 'read-paths',
      scope: 'transcript',
      matcher: 'not_contains',
      value: 'secret.txt',
    },
  };
}

function completeCoverage(delegateCaptured = true): CaptureCoverage {
  return {
    source: 'trusted-launcher',
    lanes: [
      {
        agent: root,
        captured: true,
        delegateManifest: { status: 'complete', delegates: [delegate] },
      },
      {
        agent: delegate,
        captured: delegateCaptured,
        delegateManifest: { status: 'complete', delegates: [] },
      },
    ],
  };
}

/**
 * Coverage identical to `completeCoverage()` EXCEPT the delegate's manifest cycles back to the
 * root, making the declared dispatch graph cyclic. A trusted launcher manifest must be an acyclic
 * dispatch graph; a cycle means the manifest cannot be trusted as exhaustive, so completeness must
 * collapse (`expandDelegates` cycle arm, `verdict.ts:165-168`).
 */
function cyclicCoverage(): CaptureCoverage {
  return {
    source: 'trusted-launcher',
    lanes: [
      {
        agent: root,
        captured: true,
        delegateManifest: { status: 'complete', delegates: [delegate] },
      },
      {
        agent: delegate,
        captured: true,
        delegateManifest: { status: 'complete', delegates: [root] }, // cycle: delegate -> root
      },
    ],
  };
}

/**
 * Coverage identical to `completeCoverage()` EXCEPT the delegate lane is declared TWICE. A duplicate
 * lane means the launcher's per-lane manifest is ambiguous (which delegate set is authoritative?),
 * so completeness must collapse (`expandDelegates` duplicate-lane arm, `verdict.ts:156-157,162`).
 */
function duplicateLaneCoverage(): CaptureCoverage {
  return {
    source: 'trusted-launcher',
    lanes: [
      {
        agent: root,
        captured: true,
        delegateManifest: { status: 'complete', delegates: [delegate] },
      },
      {
        agent: delegate,
        captured: true,
        delegateManifest: { status: 'complete', delegates: [] },
      },
      {
        agent: delegate, // DUPLICATE lane for the same agent key
        captured: true,
        delegateManifest: { status: 'complete', delegates: [] },
      },
    ],
  };
}

describe('ClaimSubject + trusted launcher coverage', () => {
  const includeDelegates: CheckableClaim['subject'] = {
    kind: 'agent',
    selector: 'this',
    delegates: 'include',
  };

  it('proves a detected delegate violation even without a complete manifest', () => {
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([readEvent(delegate, '/repo/secret.txt', 4)]),
      undefined,
      undefined,
      '',
      { thisAgent: root },
    );
    expect(result).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(result.evidence[0]?.agent).toEqual(delegate);
  });

  it('does not prove an absent delegate action without a trusted manifest', () => {
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      { thisAgent: root },
    );
    expect(result).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('proves the negative when every manifest is complete and every delegate is captured', () => {
    const context: MandateEvaluationContext = {
      thisAgent: root,
      captureCoverage: completeCoverage(),
    };
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      context,
    );
    expect(result).toMatchObject({ status: 'satisfied', reason: 'predicate-matched' });
  });

  it('reconciles expected launch records with checked lineage into complete coverage', () => {
    const expected: ExpectedLaunchBoundary = {
      source: 'trusted-launcher',
      lanes: [
        { agent: root, expectedDelegates: [delegate] },
        { agent: delegate, expectedDelegates: [] },
      ],
    };
    const lineage: LineageExtraction = {
      schemaVersion: 1,
      harness: 'codex',
      sessionId: 's',
      completeness: 'observed-complete-by-harness',
      lanes: [root, delegate],
      checkedLanes: [root, delegate],
      observedDelegates: [delegate],
      fanoutCalls: [],
      hooks: [],
      gaps: [],
    };
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      {
        thisAgent: root,
        captureCoverage: coverageFromExpectedLaunchBoundary(expected, lineage),
        lineage,
      },
    );
    expect(result).toMatchObject({ status: 'satisfied', reason: 'predicate-matched' });
  });

  it('keeps expected launch coverage incomplete when reconciliation lineage has gaps', () => {
    const expected: ExpectedLaunchBoundary = {
      source: 'trusted-launcher',
      lanes: [
        { agent: root, expectedDelegates: [delegate] },
        { agent: delegate, expectedDelegates: [] },
      ],
    };
    const lineage: LineageExtraction = {
      schemaVersion: 1,
      harness: 'codex',
      sessionId: 's',
      completeness: 'observed-partial',
      lanes: [root, delegate],
      checkedLanes: [root, delegate],
      observedDelegates: [delegate],
      fanoutCalls: [],
      hooks: [],
      gaps: [
        {
          reason: 'dispatch-link-mismatch',
          agent: delegate,
          toolUseId: 'toolu-other',
        },
      ],
    };
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      {
        thisAgent: root,
        captureCoverage: coverageFromExpectedLaunchBoundary(expected, lineage),
      },
    );
    expect(result).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('still proves delegate violations when expected launch reconciliation is incomplete', () => {
    const expected: ExpectedLaunchBoundary = {
      source: 'trusted-launcher',
      lanes: [
        { agent: root, expectedDelegates: [delegate] },
        { agent: delegate, expectedDelegates: [] },
      ],
    };
    const lineage: LineageExtraction = {
      schemaVersion: 1,
      harness: 'codex',
      sessionId: 's',
      completeness: 'observed-partial',
      lanes: [root, delegate],
      checkedLanes: [root, delegate],
      observedDelegates: [delegate],
      fanoutCalls: [],
      hooks: [],
      gaps: [
        {
          reason: 'dispatch-link-mismatch',
          agent: delegate,
          toolUseId: 'toolu-other',
        },
      ],
    };
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([readEvent(delegate, '/repo/secret.txt', 4)]),
      undefined,
      undefined,
      '',
      {
        thisAgent: root,
        captureCoverage: coverageFromExpectedLaunchBoundary(expected, lineage),
      },
    );
    expect(result).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(result.evidence[0]?.agent).toEqual(delegate);
  });

  it('does not let expected launch records alone prove capture', () => {
    const expected: ExpectedLaunchBoundary = {
      source: 'trusted-launcher',
      lanes: [
        { agent: root, expectedDelegates: [delegate] },
        { agent: delegate, expectedDelegates: [] },
      ],
    };
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      {
        thisAgent: root,
        captureCoverage: coverageFromExpectedLaunchBoundary(expected),
      },
    );
    expect(result).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('does not prove a negative when lineage observes an undeclared delegate', () => {
    const lineage: LineageExtraction = {
      schemaVersion: 1,
      harness: 'claude',
      sessionId: 's',
      completeness: 'observed-partial',
      lanes: [root, delegate, { kind: 'subagent', subagentId: 'extra' }],
      checkedLanes: [root, delegate],
      observedDelegates: [delegate, { kind: 'subagent', subagentId: 'extra' }],
      fanoutCalls: [],
      hooks: [],
      gaps: [
        {
          reason: 'delegate-call-without-child-transcript',
          agent: { kind: 'subagent', subagentId: 'extra' },
        },
      ],
    };
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      { thisAgent: root, captureCoverage: completeCoverage(), lineage },
    );
    expect(result).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('does not prove a negative when lineage has unresolved delegate gaps', () => {
    const lineage: LineageExtraction = {
      schemaVersion: 1,
      harness: 'claude',
      sessionId: 's',
      completeness: 'observed-partial',
      lanes: [root, delegate],
      checkedLanes: [root, delegate],
      observedDelegates: [delegate],
      fanoutCalls: [],
      hooks: [],
      gaps: [
        {
          reason: 'dispatch-link-mismatch',
          agent: delegate,
          toolUseId: 'toolu-other',
        },
      ],
    };
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      { thisAgent: root, captureCoverage: completeCoverage(), lineage },
    );
    expect(result).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('public analyze lineage parameter participates in compliance evaluation', () => {
    const lineage: LineageExtraction = {
      schemaVersion: 1,
      harness: 'claude',
      sessionId: 's',
      completeness: 'observed-partial',
      lanes: [root, delegate],
      checkedLanes: [root],
      observedDelegates: [delegate],
      fanoutCalls: [],
      hooks: [],
      gaps: [
        {
          reason: 'delegate-call-without-child-transcript',
          agent: delegate,
        },
      ],
    };
    const mandate: Mandate = {
      schemaVersion: 1,
      framework: 'test',
      claims: [neverRead(includeDelegates)],
    };
    const report = analyze(
      session([]),
      undefined,
      undefined,
      mandate,
      '',
      { thisAgent: root, captureCoverage: completeCoverage() },
      lineage,
    );
    expect(report.compliance?.[0]).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('stays unverifiable when a declared delegate was not captured', () => {
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      { thisAgent: root, captureCoverage: completeCoverage(false) },
    );
    expect(result).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('never infers a missing role binding from transcript metadata', () => {
    const result = verdictForClaim(
      neverRead({ kind: 'role', role: 'verify', delegates: 'exclude' }),
      session([]),
    );
    expect(result).toMatchObject({ status: 'unverifiable', reason: 'subject-unresolvable' });
  });

  it('a role binding scopes evidence to its bound lane', () => {
    const result = verdictForClaim(
      neverRead({ kind: 'role', role: 'verify', delegates: 'exclude' }),
      session([readEvent(delegate, '/repo/secret.txt', 1)]),
      undefined,
      undefined,
      '',
      { roleBindings: { verify: [root] } },
    );
    expect(result).toMatchObject({ status: 'satisfied', reason: 'predicate-matched' });
  });

  // 0d — the two false-PASS-preventing arms of `expandDelegates` that were untested. Each test is a
  // DIFFERENTIAL against `completeCoverage()` (which proves the negative `satisfied`, above): the ONLY
  // change is a cycle / a duplicate lane, so a flip to `unverifiable` isolates exactly that arm. A
  // regression that let either through would false-PASS an absence verdict on an untrustworthy manifest.
  it('does not prove a negative when the delegate manifest is cyclic', () => {
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      { thisAgent: root, captureCoverage: cyclicCoverage() },
    );
    expect(result).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('does not prove a negative when a lane is declared more than once', () => {
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([]),
      undefined,
      undefined,
      '',
      { thisAgent: root, captureCoverage: duplicateLaneCoverage() },
    );
    expect(result).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('still proves a delegate violation even when the manifest is cyclic (a sighting needs no manifest)', () => {
    const result = verdictForClaim(
      neverRead(includeDelegates),
      session([readEvent(delegate, '/repo/secret.txt', 4)]),
      undefined,
      undefined,
      '',
      { thisAgent: root, captureCoverage: cyclicCoverage() },
    );
    expect(result).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
    expect(result.evidence[0]?.agent).toEqual(delegate);
  });

  it('does not turn a missing delegate skill into a required-obligation violation', () => {
    const claim: CheckableClaim = {
      id: 'required-skill',
      says: 'loads testing-standards',
      kind: 'skill-invoked',
      strength: 'required',
      subject: includeDelegates,
      scope: { kind: 'whole-session' },
      source: { kind: 'in-blob', blob: '.anatrace.yaml', fidelity: 'verbatim' },
      predicate: {
        target: 'skill-events',
        scope: 'transcript',
        matcher: 'contains',
        value: 'testing-standards',
      },
    };
    const skillEmitter: SessionEvent = {
      type: 'skill',
      skill: 'coding-standards',
      source: 'tool',
      agent: root,
      blobName: 'parent',
      lineIndex: 1,
    };
    const result = verdictForClaim(
      claim,
      session([skillEmitter]),
      undefined,
      undefined,
      '',
      { thisAgent: root },
    );
    expect(result).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });
});

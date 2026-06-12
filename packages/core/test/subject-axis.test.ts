import { describe, expect, it } from 'vitest';
import type { CaptureCoverage, MandateEvaluationContext } from '../src/capture-coverage.js';
import type { CheckableClaim } from '../src/mandate.js';
import type { AgentRef, NormalizedSession, SessionEvent } from '../src/session.js';
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

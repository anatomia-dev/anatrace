import { describe, it, expect } from 'vitest';
import { validateMandate, isValidMandate } from '../src/mandate-validate.js';
import type { Mandate, MandateClaim } from '../src/mandate.js';

function wrap(claim: Partial<MandateClaim>): Mandate {
  return {
    schemaVersion: 1,
    framework: 'test',
    claims: [
      {
        id: 'c1',
        says: 's',
        scope: { kind: 'whole-session' },
        source: { kind: 'in-blob', blob: 'parent', fidelity: 'verbatim' },
        ...claim,
      } as MandateClaim,
    ],
  };
}

describe('validateMandate — message-text literalsOnly bright line', () => {
  it("rejects a 'matches' wildcard pattern (prose-grep masquerade)", () => {
    const m = wrap({
      kind: 'human-constraint',
      predicate: {
        target: 'message-text',
        role: 'assistant',
        literalsOnly: true,
        scope: 'transcript',
        matcher: 'matches',
        value: '.*I verified.*',
      },
    });
    expect(isValidMandate(m)).toBe(false);
    expect(validateMandate(m).join(' ')).toMatch(/prose-grep masquerade/);
  });

  it("rejects ANY regex metacharacter on a 'matches' message-text predicate", () => {
    for (const pattern of ['done|complete', 'verified$', 'a+b', 'test.', '(x)']) {
      const m = wrap({
        kind: 'human-constraint',
        predicate: {
          target: 'message-text',
          role: 'user',
          literalsOnly: true,
          scope: 'transcript',
          matcher: 'matches',
          value: pattern,
        },
      });
      expect(isValidMandate(m), pattern).toBe(false);
    }
  });

  it("accepts a literal 'contains' on a message-text predicate", () => {
    const m = wrap({
      kind: 'skill-announced',
      predicate: {
        target: 'message-text',
        role: 'assistant',
        literalsOnly: true,
        scope: 'transcript',
        matcher: 'contains',
        value: "I'm using the executing-plans skill",
      },
    });
    expect(validateMandate(m)).toEqual([]);
  });

  it("accepts a fully-literal 'matches' value (no metacharacters)", () => {
    const m = wrap({
      kind: 'skill-announced',
      predicate: {
        target: 'message-text',
        role: 'assistant',
        literalsOnly: true,
        scope: 'transcript',
        matcher: 'matches',
        value: 'I verified the work',
      },
    });
    expect(validateMandate(m)).toEqual([]);
  });
});

describe('validateMandate — structural checks', () => {
  it('rejects an unknown kind / target / matcher', () => {
    expect(validateMandate(wrap({ kind: 'bogus' as never })).length).toBeGreaterThan(0);
    expect(
      validateMandate(
        wrap({
          kind: 'command-run',
          predicate: { target: 'bogus' as never, scope: 'transcript', matcher: 'exists' },
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('accepts the numeric matchers gte/lte (implemented in C)', () => {
    const m = wrap({
      kind: 'command-run',
      predicate: { target: 'tool-names', scope: 'transcript', matcher: 'gte', value: 1 },
    });
    expect(validateMandate(m)).toEqual([]);
  });
});

describe('validateMandate — event-triggered-window requires agentScope (concurrency axis)', () => {
  it('rejects a windowed claim that omits agentScope', () => {
    const m = wrap({
      kind: 'skill-announced',
      scope: {
        kind: 'event-triggered-window',
        opensOn: 'skill-announced',
        closesOn: 'next-skill-announce',
      } as never, // agentScope deliberately omitted (hand-authored / future-adapter mistake)
    });
    expect(isValidMandate(m)).toBe(false);
    expect(validateMandate(m).join(' ')).toMatch(
      /event-triggered-window claim must set agentScope/,
    );
  });

  it('rejects a windowed claim with a malformed agentScope', () => {
    const m = wrap({
      kind: 'skill-announced',
      scope: {
        kind: 'event-triggered-window',
        opensOn: 'skill-announced',
        closesOn: 'next-skill-announce',
        agentScope: { kind: 'subagent' }, // missing subagentId
      } as never,
    });
    expect(isValidMandate(m)).toBe(false);
    expect(validateMandate(m).join(' ')).toMatch(
      /event-triggered-window claim must set agentScope/,
    );
  });

  it('accepts a windowed claim with a root agentScope', () => {
    const m = wrap({
      kind: 'skill-announced',
      scope: {
        kind: 'event-triggered-window',
        opensOn: 'skill-announced',
        closesOn: 'next-skill-announce',
        agentScope: { kind: 'root' },
      },
    });
    expect(validateMandate(m)).toEqual([]);
  });

  it('accepts a windowed claim with a subagent agentScope', () => {
    const m = wrap({
      kind: 'dispatch',
      scope: {
        kind: 'event-triggered-window',
        opensOn: 'dispatch',
        closesOn: 'rest-of-session',
        agentScope: { kind: 'subagent', subagentId: 'sub-1' },
      },
    });
    expect(validateMandate(m)).toEqual([]);
  });
});

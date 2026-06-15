import { describe, expect, it } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { loadPolicyYaml } from '../src/policy.js';
import { verdictsForMandate } from '../src/verdict.js';

const enc = (value: string): Uint8Array => new TextEncoder().encode(value);

const POLICY = `
version: 1
rules:
  - id: no-secrets
    subject: this-agent-and-all-delegates
    never_read:
      - secrets/customer.csv
  - id: build-inputs
    subject: role:build
    delegates: include
    only_read:
      - src/input.ts
  - id: no-upload
    subject: any-agent-in-session
    never_egress:
      - external
  - id: no-destructive
    subject: this-agent
    never_run:
      - rm -rf
  - id: edit-contract
    subject: role:build
    only_edit:
      - src/output.ts
`;

describe('.anatrace.yaml policy loader', () => {
  it('compiles every Phase 0 verb into explicit-subject Mandate claims', () => {
    const result = loadPolicyYaml(POLICY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mandate.framework).toBe('anatrace-policy');
    expect(result.mandate.claims).toHaveLength(5);
    expect(result.mandate.claims.every((claim) => claim.subject !== undefined)).toBe(true);
    expect(result.mandate.claims.map((claim) => claim.predicate?.target)).toEqual([
      'read-paths',
      'read-paths',
      'egress',
      'command-content',
      'edit-paths',
    ]);
  });

  it('compiles never_edit into a file-scope / edit-paths / not_contains BLACKLIST claim (N1b)', () => {
    const result = loadPolicyYaml(`
version: 1
rules:
  - id: no-test-edits
    subject: this-agent
    never_edit: test/
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claim = result.mandate.claims[0]!;
    expect(claim.kind).toBe('file-scope');
    expect(claim.predicate).toMatchObject({ target: 'edit-paths', matcher: 'not_contains', value: 'test/' });
    // a blacklist, NOT a whitelist: never_edit must NOT carry only_edit's strict deviationHandling.
    expect(claim.deviationHandling).toBeUndefined();
  });

  it('rejects ambiguous rules with more than one verb', () => {
    const result = loadPolicyYaml(`
version: 1
rules:
  - id: ambiguous
    subject: this-agent
    never_read: secret
    never_run: rm
`);
    expect(result).toEqual({
      ok: false,
      errors: ['rules[0] must declare exactly one policy verb'],
    });
  });

  it('rejects role subjects with invalid delegate semantics', () => {
    const result = loadPolicyYaml(`
version: 1
rules:
  - id: bad-role
    subject: role:build
    delegates: maybe
    never_run: rm
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("rules[0].delegates must be 'include' or 'exclude'");
  });

  it('only_read checks the complete allowlist union for the bound role', () => {
    const loaded = loadPolicyYaml(`
version: 1
rules:
  - id: inputs
    subject: role:build
    only_read:
      - src/a.ts
      - src/b.ts
`);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const session = claudeAdapter.parse([
      {
        name: 'parent',
        bytes: enc(
          JSON.stringify({
            type: 'assistant',
            sessionId: 's',
            uuid: 'a',
            timestamp: '2026-06-12T00:00:00.000Z',
            message: {
              role: 'assistant',
              model: 'claude-opus-4-8',
              content: [
                {
                  type: 'tool_use',
                  name: 'Read',
                  input: { file_path: 'src/outside.ts' },
                },
              ],
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            },
          }),
        ),
      },
    ]);
    expect(session).not.toBeNull();
    const verdicts = verdictsForMandate(
      loaded.mandate,
      session!,
      undefined,
      undefined,
      '',
      { roleBindings: { build: [{ kind: 'root' }] } },
    );
    expect(verdicts).toHaveLength(2);
    expect(verdicts.every((verdict) => verdict.status === 'violated')).toBe(true);
  });

  it('never_egress resolves satisfied when every observed channel is known-local', () => {
    const loaded = loadPolicyYaml(`
version: 1
rules:
  - id: no-egress
    subject: this-agent
    never_egress: external
`);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const session = claudeAdapter.parse([
      {
        name: 'parent',
        bytes: enc(
          JSON.stringify({
            type: 'assistant',
            sessionId: 's',
            uuid: 'a',
            timestamp: '2026-06-12T00:00:00.000Z',
            message: {
              role: 'assistant',
              model: 'claude-opus-4-8',
              content: [],
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            },
          }),
        ),
      },
    ])!;
    const verdict = verdictsForMandate(
      loaded.mandate,
      session,
      undefined,
      undefined,
      '',
      { thisAgent: { kind: 'root' } },
    )[0];
    expect(verdict).toMatchObject({ status: 'satisfied', reason: 'predicate-matched' });
  });

  it('only_edit remains strict for a large out-of-policy spread', () => {
    const loaded = loadPolicyYaml(`
version: 1
rules:
  - id: edits
    subject: this-agent
    only_edit: src/allowed.ts
`);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const edits = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'].map((file, index) => ({
      type: 'tool_use',
      id: `e${index}`,
      name: 'Write',
      input: { file_path: file, content: 'x' },
    }));
    const session = claudeAdapter.parse([
      {
        name: 'parent',
        bytes: enc(
          JSON.stringify({
            type: 'assistant',
            sessionId: 's',
            uuid: 'a',
            timestamp: '2026-06-12T00:00:00.000Z',
            message: {
              role: 'assistant',
              model: 'claude-opus-4-8',
              content: edits,
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            },
          }),
        ),
      },
    ])!;
    const verdict = verdictsForMandate(
      loaded.mandate,
      session,
      undefined,
      undefined,
      '',
      { thisAgent: { kind: 'root' } },
    )[0];
    expect(verdict).toMatchObject({ status: 'violated', reason: 'predicate-not-matched' });
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * D-CONFIG end-to-end gate tests. Spawns the built binary (`dist/index.mjs`) so exit codes +
 * stdout are exercised exactly as a CI consumer (the Action) would. The CLI is rebuilt in
 * `beforeAll` so a stale `dist` can never give a false pass (testing-standards).
 *
 * Arbitrary inputs, not memorized exemplars: the mandate dir is the committed framework-src
 * fixtures (anatomia AND the NON-anatomia superpowers source), proving the path is not
 * anatomia-specific. Sessions are written to temp dirs at test time.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.join(here, '..');
const WORKSPACE_ROOT = path.join(CLI_ROOT, '..', '..');
const BIN = path.join(CLI_ROOT, 'dist', 'index.mjs');
const CORE_FIX = path.join(CLI_ROOT, '..', 'core', 'test', 'fixtures');
const ANATOMIA_SRC = path.join(CORE_FIX, 'framework-src', 'anatomia');
const SUPERPOWERS_SRC = path.join(CORE_FIX, 'framework-src', 'superpowers');
const CODEX_CORPUS = path.join(CORE_FIX, 'corpus', 'codex-cacheheavy', 'parent.jsonl');

beforeAll(() => {
  // Rebuild so the spawned dist reflects the current src (no stale-dist false pass).
  execFileSync('pnpm', ['run', 'build'], { cwd: WORKSPACE_ROOT, stdio: 'ignore' });
}, 120_000);

let tmp: string;
function tmpDir(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anatrace-gate-'));
  return tmp;
}

/** Spawn the binary; return {code, stdout, stderr}. Never throws on a non-zero exit. */
function run(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [BIN, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

const enc = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
function claudeAssistant(content: unknown[], uuid: string, ts: string): unknown {
  return {
    type: 'assistant', sessionId: 's', uuid, timestamp: ts,
    message: { id: `m-${uuid}`, role: 'assistant', model: 'claude-opus-4-8', content,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  };
}
/** Write a Claude transcript with the given Write-edit paths; returns its path. */
function claudeSessionEditing(dir: string, editPaths: string[]): string {
  const content = editPaths.map((p, i) => ({ type: 'tool_use', id: `e${i}`, name: 'Write', input: { file_path: p, content: 'x' } }));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, enc([claudeAssistant(content, 'a1', '2026-06-08T00:00:01.000Z')]));
  return file;
}
/** A clean Claude transcript (one in-contract edit only) — no violations. */
function claudeCleanSession(dir: string): string {
  // Edit ONLY an in-contract whitelisted source from the anatomia fixture contract.
  return claudeSessionEditing(dir, ['packages/cli/src/types/proof.ts']);
}
/** Copy the committed codex corpus rollout to a `rollout-*.jsonl` (so discover treats it as codex). */
function codexSession(dir: string): string {
  const dst = path.join(dir, 'rollout-2026-06-08.jsonl');
  fs.copyFileSync(CODEX_CORPUS, dst);
  return dst;
}

describe('D-CONFIG — the CI gate exit codes (spawned binary)', () => {
  it('--ci exits 1 on a violated@error (an out-of-contract SOURCE edit, file-scope defaults to error)', () => {
    const dir = tmpDir();
    // displayNames.ts is OUTSIDE the anatomia contract whitelist (proof.ts/proofSummary.ts) → NARROW violated.
    const session = claudeSessionEditing(dir, ['packages/cli/src/types/proof.ts', 'packages/cli/src/utils/displayNames.ts']);
    const r = run([session, '--mandate', ANATOMIA_SRC, '--ci'], dir);
    expect(r.code).toBe(1);
  });

  it('--ci exits 0 when the run is CLEAN (only in-contract edits → no violated)', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const r = run([session, '--mandate', ANATOMIA_SRC, '--ci'], dir);
    expect(r.code).toBe(0);
  });

  it('--ci exits 0 on an UNVERIFIABLE-only run (Codex + Claude-only read-paths signal → codex-blind, never gates)', () => {
    const dir = tmpDir();
    const session = codexSession(dir);
    // The anatomia mandate's read-paths verify-independence + skill-events are Claude-only →
    // codex-blind → unverifiable on a Codex session; unverifiable NEVER gates. No edits in this
    // corpus session match the file-scope whitelist as out-of-contract source → no violated.
    const r = run([session, '--mandate', ANATOMIA_SRC, '--ci'], dir);
    expect(r.code).toBe(0);
  });

  it('a usage error (invalid --fail-on) exits 2', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const r = run([session, '--mandate', ANATOMIA_SRC, '--fail-on', 'bogus'], dir);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('invalid --fail-on');
  });

  it('a usage error (no session) exits 2', () => {
    const dir = tmpDir();
    const r = run(['--ci'], dir);
    expect(r.code).toBe(2);
  });

  it('--json + --format sarif conflict exits 2', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const r = run([session, '--json', '--format', 'sarif'], dir);
    expect(r.code).toBe(2);
  });

  it('pretty output reports lineage gaps from hook capture records', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const hooks = path.join(dir, 'hooks.jsonl');
    fs.writeFileSync(hooks, enc([
      {
        hook_event_name: 'SubagentStart',
        session_id: 's',
        transcript_path: session,
        model: 'claude-sonnet-4-6',
        agent_id: 'agent-a',
        agent_type: 'Explore',
      },
      {
        hook_event_name: 'SubagentStop',
        session_id: 's',
        transcript_path: session,
        model: 'claude-sonnet-4-6',
        agent_id: 'agent-a',
        agent_type: 'Explore',
      },
    ]));
    const r = run([session, '--lineage-hooks', hooks], dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('lineage: checked root + 0 delegate lanes');
    expect(r.stdout).toContain('observed 1 delegates');
    expect(r.stdout).toContain('observed-partial');
    // P0.8 — a SubagentStart launch record with no observed transcript is now the precise
    // launch-record-expected-but-unobserved (was the generic delegate-call-without-child-transcript).
    expect(r.stdout).toContain('lineage gap: launch-record-expected-but-unobserved:subagent:agent-a');
  });
});

describe('D-CONFIG — --format sarif emits violated-ONLY (no unverifiable/note flood)', () => {
  it('a violated run → SARIF with the file-scope error result; NO note-level results', () => {
    const dir = tmpDir();
    const session = claudeSessionEditing(dir, ['packages/cli/src/types/proof.ts', 'packages/cli/src/utils/displayNames.ts']);
    const r = run([session, '--mandate', ANATOMIA_SRC, '--format', 'sarif'], dir);
    expect(r.code).toBe(0); // no --ci → emitting SARIF is not itself a gate
    const log = JSON.parse(r.stdout) as {
      runs: Array<{
        results: Array<{ level: string; ruleId: string }>;
        properties?: { verificationCoverage?: { totalClaims: number } };
      }>;
    };
    const results = log.runs[0]!.results;
    expect(results.length).toBeGreaterThan(0);
    // violated-only: every emitted result is at error/warning, NEVER a `note` (unverifiable flood).
    expect(results.every((x) => x.level !== 'note')).toBe(true);
    expect(results.some((x) => x.ruleId === 'compliance/file-scope' && x.level === 'error')).toBe(true);
    expect(log.runs[0]?.properties?.verificationCoverage?.totalClaims).toBe(7);
  });

  it('a clean run → SARIF with zero results (satisfied/unverifiable never reach the rail)', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const r = run([session, '--mandate', ANATOMIA_SRC, '--format', 'sarif'], dir);
    const log = JSON.parse(r.stdout) as { runs: Array<{ results: unknown[] }> };
    expect(log.runs[0]!.results).toHaveLength(0);
  });
});

describe('D-CONFIG — the NON-anatomia mandate path is not anatomia-specific', () => {
  it('--mandate <superpowers source> resolves + analyzes (a different framework adapter)', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    // superpowers is detected by its own adapter; the run must succeed (no usage error).
    const r = run([session, '--mandate', SUPERPOWERS_SRC, '--json'], dir);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout) as { compliance?: unknown[] };
    expect(Array.isArray(report.compliance)).toBe(true);
  });
});

describe('Phase 0 — generic .anatrace.yaml policy path', () => {
  it('auto-discovers .anatrace.yaml and emits a deterministic violation', () => {
    const dir = tmpDir();
    const session = path.join(dir, 'session.jsonl');
    fs.writeFileSync(
      session,
      enc([
        claudeAssistant(
          [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'rm -rf build' } }],
          'a1',
          '2026-06-12T00:00:01.000Z',
        ),
      ]),
    );
    fs.writeFileSync(
      path.join(dir, '.anatrace.yaml'),
      `version: 1
rules:
  - id: no-destructive
    subject: this-agent
    never_run: rm -rf
`,
    );
    const r = run([session, '--json'], dir);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout) as {
      compliance: Array<{ claimId: string; status: string; reason: string }>;
    };
    expect(report.compliance).toContainEqual(
      expect.objectContaining({
        claimId: 'no-destructive',
        status: 'violated',
        reason: 'predicate-not-matched',
      }),
    );
  });

  it('delegate-inclusive absence is unverifiable without a trusted capture manifest', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const policy = path.join(dir, 'policy.yaml');
    fs.writeFileSync(
      policy,
      `version: 1
rules:
  - id: no-secret
    subject: this-agent-and-all-delegates
    never_read: secret.txt
`,
    );
    const r = run([session, '--policy', policy, '--json'], dir);
    const report = JSON.parse(r.stdout) as {
      compliance: Array<{ status: string; reason: string }>;
      verificationCoverage: { totalClaims: number; fullyCheckedClaims: number };
    };
    expect(report.compliance[0]).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
    expect(report.verificationCoverage).toMatchObject({
      totalClaims: 1,
      fullyCheckedClaims: 0,
    });
  });

  it('the same absence is satisfied with a complete trusted launcher manifest', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const policy = path.join(dir, 'policy.yaml');
    const manifest = path.join(dir, 'capture.json');
    fs.writeFileSync(
      policy,
      `version: 1
rules:
  - id: no-secret
    subject: this-agent-and-all-delegates
    never_read: secret.txt
`,
    );
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        source: 'trusted-launcher',
        lanes: [
          {
            agent: { kind: 'root' },
            captured: true,
            delegateManifest: { status: 'complete', delegates: [] },
          },
        ],
      }),
    );
    const r = run(
      [session, '--policy', policy, '--capture-manifest', manifest, '--json'],
      dir,
    );
    const report = JSON.parse(r.stdout) as {
      compliance: Array<{ status: string; reason: string }>;
    };
    expect(report.compliance[0]).toMatchObject({
      status: 'satisfied',
      reason: 'predicate-matched',
    });
  });

  it('expected launch boundary satisfies absence only after CLI lineage reconciliation', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const policy = path.join(dir, 'policy.yaml');
    const manifest = path.join(dir, 'capture.json');
    fs.writeFileSync(
      policy,
      `version: 1
rules:
  - id: no-secret
    subject: this-agent-and-all-delegates
    never_read: secret.txt
`,
    );
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        kind: 'expected-launch-boundary',
        source: 'trusted-launcher',
        lanes: [{ agent: { kind: 'root' }, expectedDelegates: [] }],
      }),
    );
    const r = run(
      [session, '--policy', policy, '--capture-manifest', manifest, '--json'],
      dir,
    );
    const report = JSON.parse(r.stdout) as {
      compliance: Array<{ status: string; reason: string }>;
    };
    expect(report.compliance[0]).toMatchObject({
      status: 'satisfied',
      reason: 'predicate-matched',
    });
  });

  it('expected launch boundary remains incomplete when hooks observe an unchecked delegate', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const policy = path.join(dir, 'policy.yaml');
    const manifest = path.join(dir, 'capture.json');
    const hooks = path.join(dir, 'hooks.jsonl');
    fs.writeFileSync(
      policy,
      `version: 1
rules:
  - id: no-secret
    subject: this-agent-and-all-delegates
    never_read: secret.txt
`,
    );
    fs.writeFileSync(
      hooks,
      enc([
        {
          hook_event_name: 'SubagentStart',
          session_id: 's',
          transcript_path: session,
          model: 'claude-sonnet-4-6',
          agent_id: 'agent-a',
          agent_type: 'Explore',
        },
      ]),
    );
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        kind: 'expected-launch-boundary',
        source: 'trusted-launcher',
        lanes: [
          {
            agent: { kind: 'root' },
            expectedDelegates: [{ kind: 'subagent', subagentId: 'agent-a' }],
          },
          {
            agent: { kind: 'subagent', subagentId: 'agent-a' },
            expectedDelegates: [],
          },
        ],
      }),
    );
    const r = run(
      [
        session,
        '--policy',
        policy,
        '--lineage-hooks',
        hooks,
        '--capture-manifest',
        manifest,
        '--json',
      ],
      dir,
    );
    const report = JSON.parse(r.stdout) as {
      compliance: Array<{ status: string; reason: string }>;
    };
    expect(report.compliance[0]).toMatchObject({
      status: 'unverifiable',
      reason: 'delegate-coverage-incomplete',
    });
  });

  it('pretty output states coverage and the closed unverifiable reason', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const policy = path.join(dir, 'policy.yaml');
    fs.writeFileSync(
      policy,
      `version: 1
rules:
  - id: no-secret
    subject: this-agent-and-all-delegates
    never_read: secret.txt
`,
    );
    const r = run([session, '--policy', policy], dir);
    expect(r.stdout).toContain('coverage: checked 0 of 1 claims');
    expect(r.stdout).toContain(
      'no-secret: unverifiable:delegate-coverage-incomplete',
    );
  });

  it('binds role:<name> to the root lane only when --role is explicit', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const policy = path.join(dir, 'policy.yaml');
    fs.writeFileSync(
      policy,
      `version: 1
rules:
  - id: no-secret
    subject: role:build
    never_read: secret.txt
`,
    );
    const unbound = JSON.parse(run([session, '--policy', policy, '--json'], dir).stdout) as {
      compliance: Array<{ reason: string }>;
    };
    expect(unbound.compliance[0]?.reason).toBe('subject-unresolvable');
    const bound = JSON.parse(
      run([session, '--policy', policy, '--role', 'build', '--json'], dir).stdout,
    ) as { compliance: Array<{ status: string }> };
    expect(bound.compliance[0]?.status).toBe('satisfied');
  });
});

describe('R2 byte-identity — the NO-mandate run is unchanged (with vs without)', () => {
  it('stdout WITHOUT --mandate is byte-identical to the prior no-mandate behavior', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const r = run([session, '--json'], dir);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout) as Record<string, unknown>;
    expect('compliance' in report).toBe(false);
    expect('dossier' in report).toBe(false);
    expect('hookRequests' in report).toBe(false);
    expect('verificationCoverage' in report).toBe(false);
  });

  it('the same session WITH --mandate adds compliance; WITHOUT it the report body is identical sans mandate fields', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const without = JSON.parse(run([session, '--json'], dir).stdout) as Record<string, unknown>;
    const withM = JSON.parse(run([session, '--mandate', ANATOMIA_SRC, '--json'], dir).stdout) as Record<string, unknown>;
    // The mandate adds compliance/dossier; the rest of the envelope (session/findings/cost/skills) is identical.
    const strip = (o: Record<string, unknown>): Record<string, unknown> => {
      const c = { ...o };
      delete c['compliance'];
      delete c['dossier'];
      delete c['hookRequests'];
      delete c['verificationCoverage'];
      return c;
    };
    expect(strip(withM)).toEqual(strip(without));
    expect('compliance' in withM).toBe(true);
  });
});

describe('P0.6 — the version floor applies on the file-scope BATCH path too (blocker regression)', () => {
  function claudeSessionEditingAtVersion(dir: string, editPaths: string[], version: string): string {
    const content = editPaths.map((p, i) => ({ type: 'tool_use', id: `e${i}`, name: 'Write', input: { file_path: p, content: 'x' } }));
    const line = {
      type: 'assistant', version, sessionId: 's', uuid: 'a1', timestamp: '2026-06-08T00:00:01.000Z',
      message: {
        id: 'm-a1', role: 'assistant', model: 'claude-opus-4-8', content,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, enc([line]));
    return file;
  }

  it('an out-of-major harness version → file-scope claim is unverifiable, NOT a confident violated/satisfied (no gate)', () => {
    const dir = tmpDir();
    // Same out-of-contract edit as the `--ci exits 1 on violated` test, but stamped with a
    // whole-major-drifted CC version (3.x). Pre-fix the batch path bypassed the version floor → a
    // CONFIDENT `violated` (exit 1, a false-accuse) while --last said "unverifiable". The floor must
    // apply on the batch path too: the verdict is unverifiable(harness-version-unrecognized), no gate.
    const session = claudeSessionEditingAtVersion(
      dir,
      ['packages/cli/src/types/proof.ts', 'packages/cli/src/utils/displayNames.ts'],
      '3.0.0',
    );
    const r = run([session, '--mandate', ANATOMIA_SRC, '--ci'], dir);
    expect(r.code).toBe(0); // unverifiable never gates — no false exit-1 on a drifted transcript
    expect(r.stdout).toContain('harness-version-unrecognized');
  });
});

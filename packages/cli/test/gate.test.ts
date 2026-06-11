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
const BIN = path.join(CLI_ROOT, 'dist', 'index.mjs');
const CORE_FIX = path.join(CLI_ROOT, '..', 'core', 'test', 'fixtures');
const ANATOMIA_SRC = path.join(CORE_FIX, 'framework-src', 'anatomia');
const SUPERPOWERS_SRC = path.join(CORE_FIX, 'framework-src', 'superpowers');
const CODEX_CORPUS = path.join(CORE_FIX, 'corpus', 'codex-cacheheavy', 'parent.jsonl');

beforeAll(() => {
  // Rebuild so the spawned dist reflects the current src (no stale-dist false pass).
  execFileSync('pnpm', ['run', 'build'], { cwd: CLI_ROOT, stdio: 'ignore' });
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
});

describe('D-CONFIG — --format sarif emits violated-ONLY (no unverifiable/note flood)', () => {
  it('a violated run → SARIF with the file-scope error result; NO note-level results', () => {
    const dir = tmpDir();
    const session = claudeSessionEditing(dir, ['packages/cli/src/types/proof.ts', 'packages/cli/src/utils/displayNames.ts']);
    const r = run([session, '--mandate', ANATOMIA_SRC, '--format', 'sarif'], dir);
    expect(r.code).toBe(0); // no --ci → emitting SARIF is not itself a gate
    const log = JSON.parse(r.stdout) as { runs: Array<{ results: Array<{ level: string; ruleId: string }> }> };
    const results = log.runs[0]!.results;
    expect(results.length).toBeGreaterThan(0);
    // violated-only: every emitted result is at error/warning, NEVER a `note` (unverifiable flood).
    expect(results.every((x) => x.level !== 'note')).toBe(true);
    expect(results.some((x) => x.ruleId === 'compliance/file-scope' && x.level === 'error')).toBe(true);
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

describe('R2 byte-identity — the NO-mandate run is unchanged (with vs without)', () => {
  it('stdout WITHOUT --mandate is byte-identical to the prior no-mandate behavior (3 fields omitted)', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const r = run([session, '--json'], dir);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout) as Record<string, unknown>;
    expect('compliance' in report).toBe(false);
    expect('dossier' in report).toBe(false);
    expect('hookRequests' in report).toBe(false);
  });

  it('the same session WITH --mandate adds compliance; WITHOUT it the report body is identical sans the 3 fields', () => {
    const dir = tmpDir();
    const session = claudeCleanSession(dir);
    const without = JSON.parse(run([session, '--json'], dir).stdout) as Record<string, unknown>;
    const withM = JSON.parse(run([session, '--mandate', ANATOMIA_SRC, '--json'], dir).stdout) as Record<string, unknown>;
    // The mandate adds compliance/dossier; the rest of the envelope (session/findings/cost/skills) is identical.
    const strip = (o: Record<string, unknown>): Record<string, unknown> => {
      const c = { ...o };
      delete c['compliance']; delete c['dossier']; delete c['hookRequests'];
      return c;
    };
    expect(strip(withM)).toEqual(strip(without));
    expect('compliance' in withM).toBe(true);
  });
});

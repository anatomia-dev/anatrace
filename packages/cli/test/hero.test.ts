/**
 * N1b — the test-edit HERO, end-to-end against the committed curated-gappy fixture.
 *
 * The thesis in one run: an agent makes a failing test pass by EDITING the test (the diff and CI go
 * green; only the transcript shows the passing test WAS the edit) — anatrace catches it as `violated`.
 * AND, in the SAME session, a delegate-inclusive obligation it cannot prove (the spawned sub-agent's
 * transcript was never captured) resolves `unverifiable`, never a false "clean". The catch AND the
 * honest abstention, side by side. This is the demo recorded in `fixtures/hero/anatrace.cast`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.join(here, '..');
const WORKSPACE_ROOT = path.join(CLI_ROOT, '..', '..');
const BIN = path.join(CLI_ROOT, 'dist', 'index.mjs');
const SESSION = path.join(here, 'fixtures', 'hero', 'session.jsonl');
const POLICY = path.join(here, 'fixtures', 'hero', 'policy.yaml');

beforeAll(() => {
  execFileSync('pnpm', ['run', 'build'], { cwd: WORKSPACE_ROOT, stdio: 'ignore' });
}, 120_000);

function run(args: string[]): { code: number; stdout: string } {
  try {
    return { code: 0, stdout: execFileSync('node', [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? -1, stdout: err.stdout ?? '' };
  }
}

describe('N1b — the test-edit hero (end-to-end on the committed fixture)', () => {
  it('LEADS with VIOLATED and catches the test-file edit', () => {
    const { stdout } = run([SESSION, '--policy', POLICY]);
    expect(stdout.split('\n')[0]).toContain('VERDICT: ✗ VIOLATED');
    expect(stdout).toContain('✗ no-test-edits — violated (predicate-not-matched)');
  });

  it('shows the honest abstention in the SAME session (the uncaptured delegate)', () => {
    const { stdout } = run([SESSION, '--policy', POLICY]);
    // The delegate-inclusive secret-read obligation cannot be proven — a typed unverifiable, not a pass.
    expect(stdout).toMatch(/unverifiable: (channel-coverage-incomplete|delegate-coverage-incomplete) \(no-secret-reads\)/);
    expect(stdout).toContain('lineage gap: delegate-call-without-child-transcript');
  });

  it('the violation GATES CI (--ci exits 1); the unverifiable alone would not', () => {
    expect(run([SESSION, '--policy', POLICY, '--ci']).code).toBe(1);
  });

  it('JSON carries both verdicts with evidence pointers (re-runnable record)', () => {
    const report = JSON.parse(run([SESSION, '--policy', POLICY, '--json']).stdout) as {
      compliance: Array<{ claimId: string; status: string; evidence: unknown[] }>;
    };
    const edit = report.compliance.find((v) => v.claimId === 'no-test-edits');
    const secret = report.compliance.find((v) => v.claimId === 'no-secret-reads');
    expect(edit).toMatchObject({ status: 'violated' });
    expect(edit!.evidence.length).toBeGreaterThan(0); // points at the test-file edit event
    expect(secret).toMatchObject({ status: 'unverifiable' });
  });

  it('the committed asciinema .cast is well-formed v2 and leads with the verdict', () => {
    const cast = fs.readFileSync(path.join(here, 'fixtures', 'hero', 'anatrace.cast'), 'utf8').trim().split('\n');
    const header = JSON.parse(cast[0]!) as { version: number; width: number; height: number };
    expect(header.version).toBe(2);
    expect(header.width).toBeGreaterThan(0);
    const events = cast.slice(1).map((l) => JSON.parse(l) as [number, string, string]);
    for (const e of events) expect(e[1]).toBe('o'); // every event is terminal output
    // the recorded output must itself lead with the VERDICT (the .cast is a re-runnable proof).
    expect(events.map((e) => e[2]).join('')).toContain('VERDICT: ✗ VIOLATED');
  });
});

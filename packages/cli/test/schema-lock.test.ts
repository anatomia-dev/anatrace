/**
 * N4 — the schema-locked portable record. anatrace validates its OWN `--json` output against the
 * committed `report.schema.json` (the coverage record), in CI. This is the self-validation gate: if the
 * envelope shape drifts, or a verdict grows a forbidden axis, or the demoted dossier/hookRequests
 * reappear, validation fails. The schema's verdict-reason enum is held in lockstep with the frozen
 * `VerdictReason` set so the two locks can't diverge.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.join(here, '..');
const WORKSPACE_ROOT = path.join(CLI_ROOT, '..', '..');
const BIN = path.join(CLI_ROOT, 'dist', 'index.mjs');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, '..', 'core', 'src', 'report.schema.json'), 'utf8'));

// In lockstep with p04's FROZEN_VERDICT_REASONS — the schema enum must equal the frozen VerdictReason set.
const FROZEN_VERDICT_REASONS = [
  'absent-signal', 'channel-coverage-incomplete', 'codex-blind', 'command-unresolvable',
  'content-unresolvable', 'delegate-coverage-incomplete', 'harness-version-unrecognized',
  'low-confidence', 'predicate-matched', 'predicate-not-matched', 'routed-to-llm', 'runtime-scoped',
  'session-parse-suspect', 'subject-unresolvable', 'window-unresolvable',
].sort();

beforeAll(() => {
  execFileSync('pnpm', ['run', 'build'], { cwd: WORKSPACE_ROOT, stdio: 'ignore' });
}, 120_000);

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(SCHEMA);

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'anatrace-schema-'));
}
function writeSession(dir: string, command: string, version = '2.1.170'): string {
  const line = {
    type: 'assistant', sessionId: 's', version, uuid: 'a1', timestamp: '2026-06-12T00:00:01.000Z',
    message: { id: 'm1', role: 'assistant', model: 'claude-opus-4-8',
      content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command } }],
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  };
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify(line) + '\n');
  return file;
}
function policy(dir: string): string {
  const p = path.join(dir, 'p.yaml');
  fs.writeFileSync(p, 'version: 1\nrules:\n  - id: no-force\n    subject: this-agent\n    never_run: git push --force\n');
  return p;
}
function emit(args: string[]): Record<string, unknown> {
  return JSON.parse(execFileSync('node', [BIN, ...args, '--json'], { encoding: 'utf8' })) as Record<string, unknown>;
}

describe('N4 — the --json record self-validates against the committed schema', () => {
  it('a clean no-mandate run validates', () => {
    const dir = tmpDir();
    expect(validate(emit([writeSession(dir, 'git status')])), JSON.stringify(validate.errors)).toBe(true);
  });

  it('a mandate run with a violation validates (incl. the surfaced compliance verdicts)', () => {
    const dir = tmpDir();
    const rec = emit([writeSession(dir, 'git push --force-with-lease origin x'), '--policy', policy(dir)]);
    expect(validate(rec), JSON.stringify(validate.errors)).toBe(true);
    expect((rec.compliance as Array<{ status: string }>)[0]!.status).toBe('violated');
  });

  it('a degraded (out-of-version) run validates', () => {
    const dir = tmpDir();
    expect(validate(emit([writeSession(dir, 'git status', '3.0.0'), '--policy', policy(dir)])), JSON.stringify(validate.errors)).toBe(true);
  });

  it('the committed hero fixture validates', () => {
    const rec = emit([path.join(here, 'fixtures', 'hero', 'session.jsonl'), '--policy', path.join(here, 'fixtures', 'hero', 'policy.yaml')]);
    expect(validate(rec), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe('N4 — the schema is a LOCK (it rejects drift)', () => {
  it('rejects a reappearing dossier on the envelope (the demotion lock)', () => {
    const dir = tmpDir();
    const rec = emit([writeSession(dir, 'git status')]);
    expect(validate({ ...rec, dossier: { saidVsDid: [] } })).toBe(false);
  });

  it('rejects a verdict that grows a forbidden axis (rationale/severity/model — the bright line)', () => {
    const dir = tmpDir();
    const rec = emit([writeSession(dir, 'git push --force-with-lease origin x'), '--policy', policy(dir)]);
    const verdicts = rec.compliance as Array<Record<string, unknown>>;
    expect(validate({ ...rec, compliance: [{ ...verdicts[0], rationale: 'because the model said so' }] })).toBe(false);
  });

  it('the schema verdict-reason enum is in lockstep with the frozen VerdictReason set', () => {
    const enumValues = [...SCHEMA.definitions.ComplianceVerdict.properties.reason.enum].sort();
    expect(enumValues).toEqual(FROZEN_VERDICT_REASONS);
  });
});

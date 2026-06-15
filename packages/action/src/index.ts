/**
 * anatrace-action — the GitHub Action entrypoint. Runs anatrace in CI and:
 *  1. uploads SARIF (VIOLATED-only) for code-scanning (written to `sarif-file`);
 *  2. writes the JSON coverage record as a build artifact (the re-runnable staple);
 *  3. posts a STICKY PR comment that LEADS with the unverifiables-by-reason (the gate that publishes
 *     its own blind spots);
 *  4. exits non-zero ONLY on an artifact-integrity GATE violation — a forensic detection (read / egress)
 *     is surfaced, never a merge-block (blocking the merge can't un-read a secret).
 *
 * The pure comment-building lives in `comment.ts` (unit-tested); this file is the GitHub plumbing.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { loadPolicyYaml } from 'anatrace-core';
import type { Report } from 'anatrace-core';
import { buildPrComment, COMMENT_MARKER } from './comment.js';

const require = createRequire(import.meta.url);
const ANATRACE_CLI = require.resolve('anatrace/dist/index.mjs');

function input(name: string, fallback = ''): string {
  // GitHub maps an input id to an env var by replacing SPACES with `_` and uppercasing — hyphens are
  // KEPT (mirrors @actions/core), so `session-path` → `INPUT_SESSION-PATH`.
  return process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`]?.trim() || fallback;
}
function bool(name: string): boolean {
  return /^(true|1|yes)$/i.test(input(name));
}
function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

/** The session-selection + policy args common to every CLI invocation. */
function baseArgs(): string[] {
  const args: string[] = [];
  const sessionPath = input('session-path');
  if (bool('last')) args.push('--last');
  else if (sessionPath) args.push(sessionPath);
  if (input('policy')) args.push('--policy', input('policy'));
  if (input('mandate')) args.push('--mandate', input('mandate'));
  if (input('role')) args.push('--role', input('role'));
  return args;
}

function runCli(extra: string[]): string {
  return execFileSync('node', [ANATRACE_CLI, ...baseArgs(), ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/** Claim ids whose obligation is a forensic DETECTOR (reads / egress) rather than an artifact-integrity gate. */
function detectorClaims(): Set<string> {
  const policyPath = input('policy');
  if (!policyPath || !fs.existsSync(policyPath)) return new Set();
  const loaded = loadPolicyYaml(fs.readFileSync(policyPath, 'utf8'));
  if (!loaded.ok) return new Set();
  const out = new Set<string>();
  for (const claim of loaded.mandate.claims) {
    const target = claim.predicate?.target;
    if (target === 'read-paths' || target === 'egress') out.add(claim.id);
  }
  return out;
}

async function postSticky(body: string): Promise<void> {
  const token = input('github-token') || process.env['GITHUB_TOKEN'] || '';
  const repo = process.env['GITHUB_REPOSITORY'] || '';
  const eventPath = process.env['GITHUB_EVENT_PATH'] || '';
  if (!token || !repo || !eventPath || !fs.existsSync(eventPath)) {
    log('anatrace-action: no PR context (token/repo/event missing) — printing the comment instead of posting:\n');
    log(body);
    return;
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as { pull_request?: { number: number }; number?: number };
  const pr = event.pull_request?.number ?? event.number;
  if (!pr) {
    log('anatrace-action: not a pull_request event — printing the comment instead:\n');
    log(body);
    return;
  }
  const api = `https://api.github.com/repos/${repo}/issues/${pr}/comments`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  const existing = (await (await fetch(api, { headers })).json()) as Array<{ id: number; body: string }>;
  const mine = existing.find((c) => c.body.includes(COMMENT_MARKER));
  if (mine) {
    await fetch(`https://api.github.com/repos/${repo}/issues/comments/${mine.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) });
  } else {
    await fetch(api, { method: 'POST', headers, body: JSON.stringify({ body }) });
  }
  log(`anatrace-action: posted the sticky verdict comment to PR #${pr}.`);
}

async function main(): Promise<void> {
  // 1. SARIF (violated-only) for code-scanning upload.
  const sarifFile = input('sarif-file', 'anatrace.sarif');
  fs.writeFileSync(sarifFile, runCli(['--format', 'sarif']));
  log(`anatrace-action: wrote SARIF (violated-only) to ${sarifFile}.`);

  // 2. The JSON coverage record — the re-runnable staple, written as an artifact.
  const record = JSON.parse(runCli(['--json'])) as Report;
  const recordFile = input('record-file', 'anatrace-record.json');
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));

  // 3. The sticky PR comment, leading with the unverifiables.
  const detectors = detectorClaims();
  if (bool('comment') || input('comment') === '') await postSticky(buildPrComment(record, detectors));

  // 4. Gate: exit non-zero ONLY on an artifact-integrity GATE violation (detector findings never block).
  const violations = (record.compliance ?? []).filter((v) => v.status === 'violated' && !detectors.has(v.claimId));
  if (violations.length > 0) {
    log(`anatrace-action: ${violations.length} artifact-integrity violation(s) — failing the gate.`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`anatrace-action: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
});

#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import {
  parseSession,
  analyze,
  skillsInvoked,
  complianceFindings,
  toSarif,
  ciExitCode,
} from 'anatrace-core';
import type { Capabilities, Mandate, Severity } from 'anatrace-core';
import { discoverByPath, discoverLast } from './discover.js';
import { renderJson, renderPretty } from './render.js';
import { resolveConfig } from './config.js';
import { mandateShow, resolveMandate } from './mandate.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

interface RunOptions {
  json?: boolean;
  last?: boolean;
  config?: string;
  mandate?: string;
  ci?: boolean;
  failOn?: string;
  format?: string;
}

/** Usage/input-error exit code (distinct from a genuine policy failure, which is 1). */
const EXIT_USAGE = 2;

/** The valid `--fail-on <severity>` values (the gate threshold). */
const FAIL_ON_VALUES: readonly Severity[] = ['off', 'info', 'warn', 'error'];

const program = new Command();
program
  .name('anatrace')
  .description('Deterministic, local, cross-harness agent-session analysis (provenance + cost + friction)')
  .version(version)
  .argument('[path]', 'path to a session transcript (Claude <id>.jsonl or Codex rollout-*.jsonl)')
  .option('--json', 'emit the Report envelope as JSON (alias for --format json)')
  .option('--format <pretty|json|sarif>', 'output format (default: pretty)')
  .option('--last', 'analyze the most recent local session (~/.claude or ~/.codex)')
  .option('--config <path>', 'path to a JSON config (else .anatrace.json / package.json#anatrace / ~/.anatrace.json)')
  .option('--mandate <dir>', 'verify the session against the mandate extracted from a framework source dir')
  .option('--ci', 'CI gate mode: exit 1 on a violated@error (threshold defaults to error)')
  .option('--fail-on <severity>', 'gate threshold: off | info | warn | error')
  .action((pathArg: string | undefined, opts: RunOptions) => {
    // ── usage-error pre-validation (exit 2) ──────────────────────────────────────────────
    // --json is an alias for --format json; a conflicting explicit --format sarif is a usage error.
    if (opts.json && opts.format && opts.format !== 'json') {
      process.stderr.write(`anatrace: --json conflicts with --format ${opts.format}.\n`);
      process.exit(EXIT_USAGE);
    }
    const format = opts.format ?? (opts.json ? 'json' : 'pretty');
    if (format !== 'pretty' && format !== 'json' && format !== 'sarif') {
      process.stderr.write(`anatrace: unknown --format ${format} (use pretty | json | sarif).\n`);
      process.exit(EXIT_USAGE);
    }
    if (opts.failOn !== undefined && !FAIL_ON_VALUES.includes(opts.failOn as Severity)) {
      process.stderr.write(`anatrace: invalid --fail-on ${opts.failOn} (use off | info | warn | error).\n`);
      process.exit(EXIT_USAGE);
    }

    const discovered = opts.last ? discoverLast() : pathArg ? discoverByPath(pathArg) : null;
    if (!discovered) {
      process.stderr.write('anatrace: no session found. Provide a transcript path or use --last.\n');
      process.exit(EXIT_USAGE);
    }
    const session = parseSession(discovered.blobs);
    if (!session) {
      process.stderr.write(`anatrace: could not parse session at ${discovered.sourcePath}.\n`);
      process.exit(EXIT_USAGE);
    }
    let config;
    try {
      config = resolveConfig(opts.config); // CLI does disk discovery; core stays disk-free
    } catch (e) {
      process.stderr.write(`anatrace: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(EXIT_USAGE);
    }

    // ── resolve the mandate (explicit --mandate only; NO auto-discovery — that would overfit). ─
    let mandate: Mandate | undefined;
    let capabilities: Capabilities | undefined;
    if (opts.mandate !== undefined) {
      const res = resolveMandate(opts.mandate);
      if (!res.ok) {
        process.stderr.write(res.message + '\n');
        process.exit(EXIT_USAGE);
      }
      mandate = res.mandate;
      capabilities = { contentResolver: res.resolver };
    }

    // Supply the project root the CLI runs from so file-scope normalization can relativize
    // ABSOLUTE non-worktree source edits. With no mandate the compliance pass is a no-op, so the
    // no-mandate path stays byte-identical to before (R2 byte-identity).
    const report = analyze(session, config, capabilities, mandate, process.cwd());

    // ── the GATING set: violated-only compliance findings (NEVER report.findings). ──────────
    const gateSet = mandate
      ? complianceFindings(mandate, report.compliance ?? [], config, { violatedOnly: true })
      : [];

    if (format === 'sarif') {
      process.stdout.write(JSON.stringify(toSarif(gateSet), null, 2) + '\n');
    } else {
      const skills = skillsInvoked(session); // B2 — the SkillEvent consumer (render projection)
      process.stdout.write((format === 'json' ? renderJson(report, skills) : renderPretty(report, skills)) + '\n');
    }

    // ── exit code: a genuine policy failure (gate) is 1; clean is 0. ────────────────────────
    // Set `process.exitCode` (NOT process.exit) so the just-written stdout drains before the
    // event loop empties and the process exits with this code — never truncates buffered output.
    if (opts.ci || opts.failOn) {
      const failOn: Severity = (opts.failOn as Severity | undefined) ?? 'error'; // --ci defaults to error
      process.exitCode = ciExitCode(gateSet, failOn);
    }
  });

// C5 — `anatrace mandate show <mandate-dir>`: the read-only mandate renderer + coverage stat.
// Pure projection: NO verdicts, NO LLM (EXT.0-safe). Disk discovery lives in the CLI; core's
// `extract` works on the NamedBlob[] bytes only.
const mandate = program.command('mandate').description('inspect declared mandates (schema + coverage)');
mandate
  .command('show <mandate-dir>')
  .description('extract + print the Mandate (claims + predicate-coverage stat) from a framework source dir')
  .action((mandateDir: string) => {
    const res = mandateShow(mandateDir);
    if (!res.ok) {
      process.stderr.write(res.message + '\n');
      process.exit(EXIT_USAGE);
    }
    process.stdout.write(res.message + '\n');
  });

program.parse();

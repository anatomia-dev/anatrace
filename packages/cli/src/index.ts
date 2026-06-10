#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { parseSession, analyze, skillsInvoked } from 'anatrace-core';
import { discoverByPath, discoverLast } from './discover.js';
import { renderJson, renderPretty } from './render.js';
import { resolveConfig } from './config.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

interface RunOptions {
  json?: boolean;
  last?: boolean;
  config?: string;
}

const program = new Command();
program
  .name('anatrace')
  .description('Deterministic, local, cross-harness agent-session analysis (provenance + cost + friction)')
  .version(version)
  .argument('[path]', 'path to a session transcript (Claude <id>.jsonl or Codex rollout-*.jsonl)')
  .option('--json', 'emit the Report envelope as JSON')
  .option('--last', 'analyze the most recent local session (~/.claude or ~/.codex)')
  .option('--config <path>', 'path to a JSON config (else .anatrace.json / package.json#anatrace / ~/.anatrace.json)')
  .action((pathArg: string | undefined, opts: RunOptions) => {
    const discovered = opts.last ? discoverLast() : pathArg ? discoverByPath(pathArg) : null;
    if (!discovered) {
      process.stderr.write('anatrace: no session found. Provide a transcript path or use --last.\n');
      process.exit(1);
    }
    const session = parseSession(discovered.blobs);
    if (!session) {
      process.stderr.write(`anatrace: could not parse session at ${discovered.sourcePath}.\n`);
      process.exit(1);
    }
    let config;
    try {
      config = resolveConfig(opts.config); // CLI does disk discovery; core stays disk-free
    } catch (e) {
      process.stderr.write(`anatrace: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    }
    const report = analyze(session, config);
    const skills = skillsInvoked(session); // B2 — the SkillEvent consumer (render projection)
    process.stdout.write((opts.json ? renderJson(report, skills) : renderPretty(report, skills)) + '\n');
  });

program.parse();

#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();
program
  .name('anatrace')
  .description('Deterministic, local agent-session integrity — foundation skeleton')
  .version(version);

program.parse();

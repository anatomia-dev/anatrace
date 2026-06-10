import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Config } from 'anatrace-core';

/**
 * CLI-side config discovery (A3). ALL disk reads live here — `anatrace-core` stays
 * `dependencies:{}` + disk-free; `analyze` receives a resolved `Config` (data in).
 *
 * Precedence (first readable hit wins):
 *   1. `--config <path>` flag (explicit; an unreadable explicit path is a hard error)
 *   2. `<cwd>/.anatrace.json` (the repo config)
 *   3. `<cwd>/package.json` → `anatrace` key
 *   4. `~/.anatrace.json` (the user default)
 *   5. built-in `recommended` → `undefined` (analyze resolves the default pack)
 */

/** Parse a JSON file → object, or `null` (missing / unreadable / not a JSON object). */
function readJsonObject(p: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
  try {
    const o: unknown = JSON.parse(text);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Coerce a parsed object into a `Config` — default `schemaVersion` to 1; pass known keys through. */
function asConfig(o: Record<string, unknown>): Config {
  const schemaVersion = typeof o['schemaVersion'] === 'number' ? (o['schemaVersion'] as number) : 1;
  return { ...o, schemaVersion } as Config;
}

/**
 * Resolve the effective config by the A3 precedence. Returns `undefined` when nothing is
 * found (→ analyze's built-in `recommended`). Throws only when an EXPLICIT `--config` path
 * is given but unreadable/invalid (surfacing a user error beats silently ignoring intent).
 */
export function resolveConfig(flagPath?: string, cwd: string = process.cwd()): Config | undefined {
  if (flagPath) {
    const explicit = readJsonObject(path.resolve(cwd, flagPath));
    if (!explicit) throw new Error(`--config: cannot read a JSON config at ${flagPath}`);
    return asConfig(explicit);
  }
  const repo = readJsonObject(path.join(cwd, '.anatrace.json'));
  if (repo) return asConfig(repo);

  const pkg = readJsonObject(path.join(cwd, 'package.json'));
  const pkgAnatrace = pkg ? pkg['anatrace'] : undefined;
  if (pkgAnatrace && typeof pkgAnatrace === 'object' && !Array.isArray(pkgAnatrace)) {
    return asConfig(pkgAnatrace as Record<string, unknown>);
  }

  const home = readJsonObject(path.join(os.homedir(), '.anatrace.json'));
  if (home) return asConfig(home);

  return undefined;
}

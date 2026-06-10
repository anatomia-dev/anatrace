import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveConfig } from '../src/config.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anatrace-cfg-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, obj: unknown): void =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));

describe('A3 — resolveConfig precedence (CLI does disk; core stays disk-free)', () => {
  it('returns undefined when nothing is found (→ built-in recommended)', () => {
    expect(resolveConfig(undefined, dir)).toBeUndefined();
  });

  it('reads repo .anatrace.json and defaults schemaVersion to 1', () => {
    write('.anatrace.json', { rules: { interrupt: 'off' } });
    const c = resolveConfig(undefined, dir)!;
    expect(c.schemaVersion).toBe(1);
    expect(c.rules?.['interrupt']).toBe('off');
  });

  it('repo .anatrace.json beats package.json#anatrace', () => {
    write('.anatrace.json', { schemaVersion: 1, rules: { a: 'error' } });
    write('package.json', { name: 'x', anatrace: { rules: { a: 'off' } } });
    expect(resolveConfig(undefined, dir)!.rules?.['a']).toBe('error');
  });

  it('falls back to package.json#anatrace when no .anatrace.json', () => {
    write('package.json', { name: 'x', anatrace: { rules: { b: 'warn' } } });
    expect(resolveConfig(undefined, dir)!.rules?.['b']).toBe('warn');
  });

  it('an explicit --config path wins over repo files', () => {
    write('.anatrace.json', { rules: { a: 'off' } });
    const explicit = path.join(dir, 'custom.json');
    fs.writeFileSync(explicit, JSON.stringify({ rules: { a: 'error' } }));
    expect(resolveConfig(explicit, dir)!.rules?.['a']).toBe('error');
  });

  it('throws on an explicit --config path that is unreadable', () => {
    expect(() => resolveConfig(path.join(dir, 'nope.json'), dir)).toThrow(/cannot read/);
  });

  it('ignores a malformed .anatrace.json (not an object) → undefined', () => {
    fs.writeFileSync(path.join(dir, '.anatrace.json'), '[1,2,3]');
    expect(resolveConfig(undefined, dir)).toBeUndefined();
  });
});

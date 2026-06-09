import { describe, it, expect } from 'vitest';
import { readJsonlLines } from '../src/adapter.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('readJsonlLines (A2 — BOM-strip, skip-malformed, never-throw)', () => {
  it('strips a leading BOM and parses the one object line', () => {
    const bom = '﻿';
    const out = readJsonlLines(enc(`${bom}{"a":1}`));
    expect(out.length).toBe(1);
    expect(out[0]).toEqual({ a: 1 });
  });

  it('skips truncated/malformed and non-object lines, keeps only valid objects', () => {
    const input = ['{"a":1}', '{"b":2', '42', '"str"', 'null', '', '   ', '{"c":3}'].join('\n');
    const out = readJsonlLines(enc(input));
    expect(out.length).toBe(2);
    expect(out).toEqual([{ a: 1 }, { c: 3 }]);
  });

  it('never throws on empty or all-garbage input', () => {
    expect(readJsonlLines(enc('')).length).toBe(0);
    expect(readJsonlLines(enc('not json\n{oops')).length).toBe(0);
  });
});

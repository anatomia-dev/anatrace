/**
 * P0.4 (Phase 0, Step 9) — the package boundary lock. Honesty-as-types applied to the API:
 *  1. EXPORT SNAPSHOT — the public `index.ts` surface is frozen; any add/remove fails here, forcing
 *     a deliberate change + a changeset (embedders pin this surface).
 *  2. ENUM VALUE-LOCK — the `VerdictReason` and `LineageGapReason` string sets are frozen (anatomia
 *     keys off these reason strings; a silent rename/removal would break a downstream consumer).
 *  3. REACHABILITY — every enum member has a live emitter, so the frozen vocabulary is the final,
 *     post-trim one and no member can freeze DEAD (the LineageGapReason dead-member class).
 *  4. MATCHER TOTALITY — the FI-17 wall: comparable matchers are mechanically evaluated; everything
 *     else degrades to `unverifiable`, never a silent verdict.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictForClaim } from '../src/verdict.js';
import type { CheckableClaim, Matcher } from '../src/mandate.js';
import { claudeAdapter } from '../src/adapters/claude.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Extract exported identifiers (value + type, alias-resolved to the exported name) from a module. */
function exportedNames(source: string): string[] {
  const names = new Set<string>();
  const re = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    for (const raw of m[1]!.split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const as = part.split(/\s+as\s+/);
      names.add((as[1] ?? as[0]!).trim());
    }
  }
  return [...names].filter(Boolean).sort();
}

/** Extract a `export type X = | 'a' | 'b' ...;` union's string members (comments ignored). */
function unionMembers(source: string, typeName: string): string[] {
  const re = new RegExp(`export type ${typeName} =([\\s\\S]*?);`, 'm');
  const block = re.exec(source)?.[1] ?? '';
  const out = new Set<string>();
  for (const line of block.split('\n')) {
    const code = line.replace(/\/\/.*$/, ''); // drop trailing comments so inline notes don't leak
    for (const lit of code.matchAll(/'([a-z][a-z-]+)'/g)) out.add(lit[1]!);
  }
  return [...out].sort();
}

// The frozen public surface lives in a committed snapshot file. Update it DELIBERATELY (regenerate
// + ship a changeset) — that is the whole point of the lock.
const FROZEN_EXPORTS = fs
  .readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'public-api.snapshot'), 'utf8')
  .trim()
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  .sort();

const FROZEN_VERDICT_REASONS = [
  'absent-signal','channel-coverage-incomplete','codex-blind','content-unresolvable','delegate-coverage-incomplete','harness-version-unrecognized','low-confidence','predicate-matched','predicate-not-matched','routed-to-llm','runtime-scoped','session-parse-suspect','subject-unresolvable','window-unresolvable',
].sort();

const FROZEN_LINEAGE_GAP_REASONS = [
  'child-transcript-metadata-mismatch','child-transcript-without-metadata','codex-subagent-storage-unknown','delegate-call-without-child-transcript','delegate-transcript-unreadable','dispatch-link-mismatch','dispatch-link-missing','duplicate-child-session-id','harness-lineage-unsupported','launch-record-expected-but-unobserved','metadata-without-child-transcript',
].sort();

describe('P0.4 — public API export snapshot is frozen', () => {
  it('index.ts exports exactly the frozen surface (add/remove ⇒ deliberate change + changeset)', () => {
    expect(exportedNames(read('index.ts'))).toEqual(FROZEN_EXPORTS);
  });
});

describe('P0.4 — reason enums are value-locked', () => {
  it('VerdictReason members are frozen', () => {
    expect(unionMembers(read('verdict.ts'), 'VerdictReason')).toEqual(FROZEN_VERDICT_REASONS);
  });
  it('LineageGapReason members are frozen', () => {
    expect(unionMembers(read('lineage.ts'), 'LineageGapReason')).toEqual(FROZEN_LINEAGE_GAP_REASONS);
  });
});

describe('P0.4 — every reason is REACHABLE (no member freezes dead)', () => {
  // All src, MINUS the two enum declaration blocks, MINUS comment lines: a member that survives this
  // strip still appears as an emitted literal somewhere → reachable. A member only in its declaration
  // (or only in a comment) → absent → dead → fails. This is what stops a member freezing dead.
  function allTs(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) allTs(p, acc);
      else if (e.name.endsWith('.ts')) acc.push(fs.readFileSync(p, 'utf8'));
    }
    return acc;
  }
  let src = allTs(SRC).join('\n');
  for (const [file, type] of [['verdict.ts', 'VerdictReason'], ['lineage.ts', 'LineageGapReason']] as const) {
    const block = new RegExp(`export type ${type} =[\\s\\S]*?;`).exec(read(file))?.[0];
    if (block) src = src.replace(block, '');
  }
  const emittedCode = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  for (const reason of [...FROZEN_VERDICT_REASONS, ...FROZEN_LINEAGE_GAP_REASONS]) {
    it(`'${reason}' has a live emitter (not declaration-only)`, () => {
      expect(emittedCode).toContain(`'${reason}'`);
    });
  }
});

describe('P0.4 — FI-17 matcher totality (single-source) value-lock', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  const jsonl = (o: unknown[]): string => o.map((x) => JSON.stringify(x)).join('\n');
  // a session that actually wrote a file, so file-content resolves (isolates the matcher gate)
  const session = claudeAdapter.parse([
    {
      name: 'parent',
      bytes: enc(
        jsonl([
          {
            type: 'assistant',
            uuid: 'a1',
            timestamp: '2026-06-08T00:00:01.000Z',
            message: {
              id: 'm1', role: 'assistant', model: 'claude-opus-4-8',
              content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/r/x.ts', content: 'hello' } }],
              usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          },
        ]),
      ),
    },
  ])!;
  const resolver = (p: string): Uint8Array | null => (p === '/r/x.ts' ? enc('hello') : null);
  const fcClaim = (matcher: Matcher): CheckableClaim => ({
    id: 'fc', says: '', kind: 'contract-matcher', scope: { kind: 'whole-session' },
    source: { kind: 'cross-artifact', workItemSlug: 'p', path: '/r/x.ts', fidelity: 'verbatim' },
    predicate: { target: 'file-content', matcher, scope: 'transcript', value: 'hello' },
  });

  for (const m of ['contains', 'not_contains', 'equals', 'not_equals', 'exists'] as Matcher[]) {
    it(`comparable matcher '${m}' is mechanically evaluated (never content-unresolvable)`, () => {
      expect(verdictForClaim(fcClaim(m), session, resolver).reason).not.toBe('content-unresolvable');
    });
  }
  for (const m of ['matches', 'gte', 'lte'] as Matcher[]) {
    it(`non-comparable matcher '${m}' → unverifiable(content-unresolvable)`, () => {
      expect(verdictForClaim(fcClaim(m), session, resolver)).toMatchObject({
        status: 'unverifiable', reason: 'content-unresolvable',
      });
    });
  }
});

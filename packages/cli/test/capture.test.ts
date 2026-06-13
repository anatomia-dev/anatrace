import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveCaptureCoverage } from '../src/capture.js';
import type { LineageExtraction } from 'anatrace-core';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function write(value: unknown): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anatrace-capture-'));
  const file = path.join(dir, 'capture.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

describe('trusted capture manifest loader', () => {
  it('accepts a complete recursive launcher manifest', () => {
    const result = resolveCaptureCoverage(
      write({
        source: 'trusted-launcher',
        lanes: [
          {
            agent: { kind: 'root' },
            captured: true,
            delegateManifest: {
              status: 'complete',
              delegates: [{ kind: 'subagent', subagentId: 'a' }],
            },
          },
          {
            agent: { kind: 'subagent', subagentId: 'a' },
            captured: true,
            delegateManifest: { status: 'complete', delegates: [] },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverage.lanes).toHaveLength(2);
  });

  it('accepts expected launch boundary records and reconciles checked lanes from lineage', () => {
    const lineage: LineageExtraction = {
      schemaVersion: 1,
      harness: 'codex',
      sessionId: 's',
      completeness: 'observed-partial',
      lanes: [{ kind: 'root' }, { kind: 'subagent', subagentId: 'a' }],
      checkedLanes: [{ kind: 'root' }, { kind: 'subagent', subagentId: 'a' }],
      observedDelegates: [{ kind: 'subagent', subagentId: 'a' }],
      fanoutCalls: [],
      hooks: [],
      gaps: [],
    };
    const result = resolveCaptureCoverage(
      write({
        kind: 'expected-launch-boundary',
        source: 'trusted-launcher',
        lanes: [
          {
            agent: { kind: 'root' },
            expectedDelegates: [{ kind: 'subagent', subagentId: 'a' }],
          },
          {
            agent: { kind: 'subagent', subagentId: 'a' },
            expectedDelegates: [],
          },
        ],
      }),
      lineage,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverage.lanes).toEqual([
      {
        agent: { kind: 'root' },
        captured: true,
        delegateManifest: {
          status: 'complete',
          delegates: [{ kind: 'subagent', subagentId: 'a' }],
        },
      },
      {
        agent: { kind: 'subagent', subagentId: 'a' },
        captured: true,
        delegateManifest: { status: 'complete', delegates: [] },
      },
    ]);
    expect(result.coverage.completeness).toBe('incomplete');
  });

  it('marks expected launch boundary coverage complete only with complete lineage', () => {
    const lineage: LineageExtraction = {
      schemaVersion: 1,
      harness: 'codex',
      sessionId: 's',
      completeness: 'observed-complete-by-harness',
      lanes: [{ kind: 'root' }, { kind: 'subagent', subagentId: 'a' }],
      checkedLanes: [{ kind: 'root' }, { kind: 'subagent', subagentId: 'a' }],
      observedDelegates: [{ kind: 'subagent', subagentId: 'a' }],
      fanoutCalls: [],
      hooks: [],
      gaps: [],
    };
    const result = resolveCaptureCoverage(
      write({
        kind: 'expected-launch-boundary',
        source: 'trusted-launcher',
        lanes: [
          {
            agent: { kind: 'root' },
            expectedDelegates: [{ kind: 'subagent', subagentId: 'a' }],
          },
          {
            agent: { kind: 'subagent', subagentId: 'a' },
            expectedDelegates: [],
          },
        ],
      }),
      lineage,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverage).toMatchObject({
      completeness: 'complete',
      lanes: [
        {
          agent: { kind: 'root' },
          captured: true,
          delegateManifest: {
            status: 'complete',
            delegates: [{ kind: 'subagent', subagentId: 'a' }],
          },
        },
        {
          agent: { kind: 'subagent', subagentId: 'a' },
          captured: true,
          delegateManifest: { status: 'complete', delegates: [] },
        },
      ],
    });
  });

  it('rejects unknown capture manifest kind', () => {
    const result = resolveCaptureCoverage(
      write({
        kind: 'expected-launch-boudnary',
        source: 'trusted-launcher',
        lanes: [],
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'anatrace: unknown capture manifest kind expected-launch-boudnary.',
    });
  });

  it('rejects ambiguous agent identity fields', () => {
    const result = resolveCaptureCoverage(
      write({
        kind: 'expected-launch-boundary',
        source: 'trusted-launcher',
        lanes: [
          {
            agent: { kind: 'root', subagentId: 'a' },
            expectedDelegates: [],
          },
        ],
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'anatrace: invalid expected launch boundary lane at index 0.',
    });
  });

  it('rejects ambiguous delegate identity fields', () => {
    const result = resolveCaptureCoverage(
      write({
        kind: 'expected-launch-boundary',
        source: 'trusted-launcher',
        lanes: [
          {
            agent: { kind: 'root' },
            expectedDelegates: [{ kind: 'subagent', subagentId: 'a', label: 'extra' }],
          },
        ],
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'anatrace: invalid expected launch boundary lane at index 0.',
    });
  });

  it('keeps expected launch boundary lanes uncaptured without lineage', () => {
    const result = resolveCaptureCoverage(
      write({
        kind: 'expected-launch-boundary',
        source: 'trusted-launcher',
        lanes: [{ agent: { kind: 'root' }, expectedDelegates: [] }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverage.lanes[0]).toMatchObject({
      agent: { kind: 'root' },
      captured: false,
      delegateManifest: { status: 'complete', delegates: [] },
    });
    expect(result.coverage.completeness).toBe('incomplete');
  });

  it('rejects malformed lane coverage instead of trusting a cast', () => {
    const result = resolveCaptureCoverage(
      write({
        source: 'trusted-launcher',
        lanes: [
          {
            agent: { kind: 'root' },
            captured: 'yes',
            delegateManifest: { status: 'complete', delegates: [] },
          },
        ],
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'anatrace: invalid capture manifest lane at index 0.',
    });
  });

  it('rejects duplicate lanes', () => {
    const result = resolveCaptureCoverage(
      write({
        source: 'trusted-launcher',
        lanes: [
          {
            agent: { kind: 'root' },
            captured: true,
            delegateManifest: { status: 'complete', delegates: [] },
          },
          {
            agent: { kind: 'root' },
            captured: true,
            delegateManifest: { status: 'complete', delegates: [] },
          },
        ],
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'anatrace: duplicate capture manifest lane root.',
    });
  });
});

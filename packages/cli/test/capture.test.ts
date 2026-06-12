import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveCaptureCoverage } from '../src/capture.js';

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

  it('rejects malformed lane coverage instead of trusting a cast', () => {
    const result = resolveCaptureCoverage(
      write({
        source: 'trusted-launcher',
        lanes: [{ agent: { kind: 'root' }, captured: 'yes' }],
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'anatrace: invalid capture manifest lane at index 0.',
    });
  });
});

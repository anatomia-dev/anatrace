import { describe, it, expect } from 'vitest';
import { parseSession } from '../src/parse.js';
import { loadCorpus, type CorpusSession } from './_corpus.js';

/**
 * Determinism harness (REQ Item 9 / A10): parse each corpus fixture TWICE into
 * separately-constructed objects and assert `JSON.stringify`-identity — Claude AND Codex,
 * including the compaction-under-fan-out fixture. Authored at A10; exercised over the
 * SYNTHETIC corpus once A11/A15 land. (No fixtures yet ⇒ a single guard test.)
 */
function freshBlobs(s: CorpusSession) {
  return s.blobs.map((b) => ({ name: b.name, bytes: new Uint8Array(b.bytes) }));
}

const corpus = loadCorpus();

describe('determinism — parse-twice byte-identity', () => {
  if (corpus.length === 0) {
    it('corpus not yet built (A11) — harness authored, exercised at A16', () => {
      expect(corpus).toEqual([]);
    });
  }

  for (const s of corpus) {
    it(`${s.name}: parses byte-identically twice`, () => {
      const a = parseSession(freshBlobs(s), s.harness);
      const b = parseSession(freshBlobs(s), s.harness);
      expect(a).not.toBeNull();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  }
});

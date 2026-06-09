import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NamedBlob } from '../src/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(here, 'fixtures', 'corpus');

export interface CorpusSession {
  name: string;
  harness: 'claude' | 'codex';
  blobs: NamedBlob[];
}

function readBlob(p: string, name: string): NamedBlob {
  return { name, bytes: new Uint8Array(fs.readFileSync(p)) };
}

/**
 * Load the SYNTHETIC fixture corpus (A11). Layout:
 *   fixtures/corpus/<harness>-<name>/parent.jsonl
 *   fixtures/corpus/<harness>-<name>/subagents/agent-*.jsonl + agent-*.meta.json   (Claude only)
 * Blob names are canonical (parent first, then lexically-sorted subagents/...).
 * Returns `[]` when the corpus dir does not exist yet.
 */
export function loadCorpus(): CorpusSession[] {
  let dirs: string[];
  try {
    dirs = fs
      .readdirSync(CORPUS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }

  const sessions: CorpusSession[] = [];
  for (const name of dirs) {
    const harness: 'claude' | 'codex' = name.startsWith('codex-') ? 'codex' : 'claude';
    const dir = path.join(CORPUS_DIR, name);
    const parentPath = path.join(dir, 'parent.jsonl');
    if (!fs.existsSync(parentPath)) continue;
    const blobs: NamedBlob[] = [readBlob(parentPath, 'parent')];
    const subDir = path.join(dir, 'subagents');
    if (fs.existsSync(subDir)) {
      const subs = fs
        .readdirSync(subDir)
        .filter((f) => f.startsWith('agent-') && (f.endsWith('.jsonl') || f.endsWith('.meta.json')))
        .sort();
      for (const f of subs) blobs.push(readBlob(path.join(subDir, f), `subagents/${f}`));
    }
    sessions.push({ name, harness, blobs });
  }
  return sessions;
}

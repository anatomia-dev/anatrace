import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { NamedBlob } from 'anatrace-core';

export interface DiscoveredSession {
  harness: 'claude' | 'codex';
  blobs: NamedBlob[];
  sourcePath: string;
}

function readBlob(filePath: string, name: string): NamedBlob {
  return { name, bytes: new Uint8Array(fs.readFileSync(filePath)) };
}

function isCodexRollout(p: string): boolean {
  return path.basename(p).startsWith('rollout-');
}

/** Build a Codex session group: the single rollout blob. */
function buildCodexGroup(rolloutPath: string): DiscoveredSession {
  return { harness: 'codex', sourcePath: rolloutPath, blobs: [readBlob(rolloutPath, 'parent')] };
}

/**
 * Build a Claude session group: the parent `<id>.jsonl` + every `<id>/subagents/agent-*.jsonl`
 * and `agent-*.meta.json`. Blob names are canonical (parent first, then lexically-sorted
 * `subagents/...`) so filesystem discovery order never reaches core.
 */
function buildClaudeGroup(parentPath: string): DiscoveredSession {
  const blobs: NamedBlob[] = [readBlob(parentPath, 'parent')];
  const id = path.basename(parentPath, '.jsonl');
  const subDir = path.join(path.dirname(parentPath), id, 'subagents');
  if (fs.existsSync(subDir)) {
    const names = fs
      .readdirSync(subDir)
      .filter((f) => f.startsWith('agent-') && (f.endsWith('.jsonl') || f.endsWith('.meta.json')))
      .sort();
    for (const f of names) blobs.push(readBlob(path.join(subDir, f), `subagents/${f}`));
  }
  return { harness: 'claude', sourcePath: parentPath, blobs };
}

/** Discover a session group from an explicit transcript path. `null` if the path is unusable. */
export function discoverByPath(p: string): DiscoveredSession | null {
  try {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
    return isCodexRollout(p) ? buildCodexGroup(p) : buildClaudeGroup(p);
  } catch {
    return null;
  }
}

interface Candidate {
  path: string;
  mtimeMs: number;
  harness: 'claude' | 'codex';
}

function claudeParents(): Candidate[] {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const out: Candidate[] = [];
  let projects: string[];
  try {
    projects = fs.readdirSync(root);
  } catch {
    return out;
  }
  for (const proj of projects) {
    const dir = path.join(root, proj);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      // Parent transcripts are .jsonl files directly under the project dir.
      // Subagent files live deeper (<id>/subagents/) and are excluded here.
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        const fp = path.join(dir, e.name);
        try {
          out.push({ path: fp, mtimeMs: fs.statSync(fp).mtimeMs, harness: 'claude' });
        } catch {
          /* skip racing/unreadable */
        }
      }
    }
  }
  return out;
}

function codexRollouts(): Candidate[] {
  const codexHome =
    process.env['CODEX_HOME'] && process.env['CODEX_HOME'].length > 0
      ? process.env['CODEX_HOME']
      : path.join(os.homedir(), '.codex');
  const root = path.join(codexHome, 'sessions');
  const out: Candidate[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        try {
          out.push({ path: fp, mtimeMs: fs.statSync(fp).mtimeMs, harness: 'codex' });
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(root);
  return out;
}

/** Discover the most recently-modified local session across Claude + Codex. `null` if none. */
export function discoverLast(): DiscoveredSession | null {
  const all = [...claudeParents(), ...codexRollouts()];
  if (!all.length) return null;
  let best = all[0]!;
  for (const c of all) if (c.mtimeMs > best.mtimeMs) best = c;
  return best.harness === 'codex' ? buildCodexGroup(best.path) : buildClaudeGroup(best.path);
}

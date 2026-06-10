import type { NamedBlob } from '../adapter.js';
import type { MandateAdapter } from '../types.js';
import type { Mandate, MandateClaim, ClaimSource } from '../mandate.js';
import { decodeBlob } from './mandate-shared.js';

/**
 * The `anatomia` reference `MandateAdapter` (C3). Maps Anatomia's PROCESS layer — agent-def
 * `skills:`/imperatives + `contract.yaml` `file_changes`/`assertions` — to `MandateClaim`s.
 *
 * AIM (the single most important authoring rule): the transcript-checkable MOAT is the
 * PROCESS kinds — `skill-invoked` (agent-def frontmatter), verify-independence
 * (`human-constraint`/`message-text`, `scope:'transcript'`, Track-P-validated 14/14),
 * `file-scope` (`file_changes`, `scope:'transcript'`). The `contract.yaml` `assertions` are
 * ~90%+ RUNTIME (`result.*`/`output.*`/`stdout`/`exitCode` namespaces) → extracted HONESTLY
 * as `contract-matcher` with `predicate.scope:'runtime'` (→ `unverifiable` at D), NEVER faked
 * as transcript checks. (The verify-independence claim is ENABLED by this schema; it is NOT
 * an existing contract assertion — the corpus has 0 transcript-read assertions.)
 *
 * `extract` is PURE: it reads only the bytes in `group` (agent-def `.md` blobs + a
 * `contract.yaml` blob). It NEVER throws and degrades to `null` when nothing is recognizable.
 */

/** "You never read the build report" (ana-verify) / "it never reads your report" (ana-build). */
const INDEPENDENCE_RE = /\b(?:never reads?|do(?:es)? not read|don't read)\b[^.\n]*\breport\b/i;

/** Pull the `skills: [a, b]` inline list out of a `---`-fenced markdown frontmatter block. */
function frontmatterSkills(text: string): string[] {
  const fm = /^---\n([\s\S]*?)\n---/m.exec(text);
  if (!fm) return [];
  const m = /^skills:\s*\[([^\]]*)\]/m.exec(fm[1] ?? '');
  if (!m) return [];
  return (m[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Agent name from `name:` frontmatter, else the blob's base filename. */
function agentName(text: string, blobName: string): string {
  const fm = /^---\n([\s\S]*?)\n---/m.exec(text);
  const m = fm ? /^name:\s*(\S+)/m.exec(fm[1] ?? '') : null;
  if (m && m[1]) return m[1];
  const base = blobName.split('/').pop() ?? blobName;
  return base.replace(/\.md$/, '');
}

/**
 * Extract `file_changes:` `- path: "…"` entries from a contract.yaml body (structural, not
 * full YAML). Walk lines: collect `- path:` entries inside the indented `file_changes:` block,
 * stop at the next top-level (column-0) key.
 */
function contractFileChanges(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^file_changes:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^\S/.test(line)) break; // next top-level key ends the block
    if (!inBlock) continue;
    const m = /^\s*-\s*path:\s*"?([^"\n]+?)"?\s*$/.exec(line);
    if (m && m[1]) out.push(m[1].trim());
  }
  return out;
}

/** Extract contract `assertions:` (id + says) — these are the ~90%+ runtime obligations. */
function contractAssertions(text: string): { id: string; says: string }[] {
  const block = /^assertions:\s*\n([\s\S]*)$/m.exec(text);
  if (!block) return [];
  const out: { id: string; says: string }[] = [];
  let curId = '';
  for (const line of (block[1] ?? '').split('\n')) {
    const idM = /^\s*-\s*id:\s*"?([A-Za-z0-9_]+)"?\s*$/.exec(line);
    if (idM && idM[1]) {
      curId = idM[1];
      continue;
    }
    const saysM = /^\s*says:\s*"([^"]*)"\s*$/.exec(line);
    if (saysM && curId) {
      out.push({ id: curId, says: saysM[1] ?? '' });
      curId = '';
    }
  }
  return out;
}

function isAgentDef(name: string): boolean {
  return /(?:^|\/)(?:agents\/)?ana[\w-]*\.md$/i.test(name) || /agents\/.+\.md$/i.test(name);
}
function isContract(name: string): boolean {
  return /(?:^|\/)contract\.ya?ml$/i.test(name);
}

function detect(group: NamedBlob[]): boolean {
  for (const b of group) {
    if (isContract(b.name)) return true;
    if (isAgentDef(b.name)) {
      const t = decodeBlob(b.bytes);
      if (frontmatterSkills(t).length || /^name:\s*ana/m.test(t)) return true;
    }
  }
  return false;
}

function extract(group: NamedBlob[]): Mandate | null {
  const claims: MandateClaim[] = [];

  for (const b of group) {
    const text = decodeBlob(b.bytes);

    if (isAgentDef(b.name)) {
      const agent = agentName(text, b.name);
      // skill-invoked — one per frontmatter `skills:` entry.
      for (const skill of frontmatterSkills(text)) {
        const src: ClaimSource = { kind: 'in-blob', blob: b.name, fidelity: 'verbatim' };
        claims.push({
          id: `${agent}:skill:${skill}`,
          says: `${agent} loads the ${skill} skill`,
          kind: 'skill-invoked',
          scope: { kind: 'whole-session' },
          source: src,
          predicate: {
            target: 'skill-events',
            scope: 'transcript',
            matcher: 'contains',
            value: skill,
          },
        });
      }
      // verify-independence — the ENABLED, transcript-checkable human-constraint (Track-P 14/14).
      if (INDEPENDENCE_RE.test(text)) {
        const src: ClaimSource = { kind: 'in-blob', blob: b.name, fidelity: 'verbatim' };
        claims.push({
          id: `${agent}:verify-independence`,
          says: `${agent} never reads the build report`,
          kind: 'human-constraint',
          scope: { kind: 'whole-session' },
          source: src,
          predicate: {
            target: 'read-paths',
            scope: 'transcript',
            matcher: 'not_contains',
            value: 'build_report',
          },
        });
      }
    }

    if (isContract(b.name)) {
      // file-scope — `file_changes[].path`, transcript-checkable (edit-paths).
      for (const path of contractFileChanges(text)) {
        const src: ClaimSource = { kind: 'cross-artifact', workItemSlug: '', path: b.name, fidelity: 'verbatim' };
        claims.push({
          id: `contract:file-scope:${path}`,
          says: `edits stay within ${path}`,
          kind: 'file-scope',
          scope: { kind: 'whole-session' },
          source: src,
          predicate: {
            target: 'edit-paths',
            scope: 'transcript',
            matcher: 'contains',
            value: path,
          },
        });
      }
      // contract-matcher — the ~90%+ RUNTIME assertions, HONESTLY scope:'runtime' (→ unverifiable).
      for (const a of contractAssertions(text)) {
        const src: ClaimSource = { kind: 'cross-artifact', workItemSlug: '', path: b.name, fidelity: 'verbatim' };
        claims.push({
          id: `contract:${a.id}`,
          says: a.says,
          kind: 'contract-matcher',
          scope: { kind: 'whole-session' },
          source: src,
          predicate: {
            target: 'file-content',
            scope: 'runtime',
            matcher: 'exists',
          },
        });
      }
    }
  }

  if (!claims.length) return null;
  return { schemaVersion: 1, framework: 'anatomia', claims };
}

export const anatomiaAdapter: MandateAdapter = { framework: 'anatomia', detect, extract };

import type { NamedBlob } from '../adapter.js';
import type { MandateAdapter } from '../types.js';
import type { Mandate, MandateClaim, ClaimSource, ClaimStrength } from '../mandate.js';
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

/**
 * AnaVerify's "read-only on the codebase" rule (D-NONOBVIOUS). The agent def states AnaVerify
 * "do[es] NOT fix code … do NOT merge" and is "read-only on the codebase. The only file you
 * write is verify_report.md"; its sole sanctioned git is `ana artifact save` (commits/pushes the
 * REPORT) + `ana pr create`. A `git rebase` or `git push --force*` REWRITES the code branch —
 * forbidden. We recognize the rule by the verbatim "read-only on the codebase" imperative, then
 * emit FORBIDDEN-command (`command-run` / `command-content` / `not_contains`) claims for each
 * code-branch-mutating git op. Substring values chosen to be present verbatim in real commands
 * (`git push --force` is a contiguous substring of `git push --force-with-lease …`).
 */
const VERIFY_READONLY_RE = /read-only on the codebase|do\s+NOT\s+(?:fix code|merge)/i;

/** Code-branch-rewriting git ops AnaVerify must never run (verbatim substrings of real commands). */
const VERIFY_FORBIDDEN_COMMANDS = ['git rebase', 'git push --force'] as const;

/** True for the AnaVerify agent def (the only role under the read-only-codebase rule). */
function isVerifyAgent(agent: string): boolean {
  return /(?:^|[-/])ana-?verify$/i.test(agent);
}

/**
 * The three Anatomia PROCESS roles. `null` ⇒ an agent def we don't recognize as a known role
 * (e.g. a custom subagent) → no DECLARED strength → the skill claim stays `optional` (the
 * brand-safe default — never `violated` from an unrecognized role).
 */
type AnatomiaRole = 'plan' | 'build' | 'verify';

/** Classify an agent-def name → its Anatomia role (or `null` for an unrecognized def). */
function roleOf(agent: string): AnatomiaRole | null {
  if (/(?:^|[-/])ana-?verify$/i.test(agent)) return 'verify';
  if (/(?:^|[-/])ana-?build$/i.test(agent)) return 'build';
  if (/(?:^|[-/])ana-?plan$/i.test(agent)) return 'plan';
  return null;
}

/**
 * The DECLARED per-(role × skill) strength map (D-D — strength is DECLARED, never parsed from
 * prose). Authored from KNOWN Anatomia framework knowledge; this is the contract anatrace CHECKS.
 *
 * The exact declarations the REQ/runbook pin (done-state #5, the phantom guard):
 *  - `coding-standards`:  optional/Build,  required/Plan & Verify.
 *  - `git-workflow`:      required/Build,  forbidden/Verify   (the sole true `forbidden` in corpus;
 *                         Verify is read-only on the codebase — `ana-verify.md:147`).
 *  - `testing-standards`: required/Verify, optional/Plan & Build  (`ana-plan testing-standards`
 *                         MUST be `optional` — the phantom-obligation guard; Build's "do not load
 *                         by default, available on demand" → `optional`, NOT `forbidden`).
 *
 * A (role × skill) pair NOT in this map ⇒ `optional` (the default — absence can never `violate`).
 * An unrecognized role (`roleOf` → null) ⇒ `optional` for ALL its skills.
 */
const SKILL_STRENGTH: Record<string, Partial<Record<AnatomiaRole, ClaimStrength>>> = {
  'coding-standards': { plan: 'required', build: 'optional', verify: 'required' },
  'git-workflow': { plan: 'optional', build: 'required', verify: 'forbidden' },
  'testing-standards': { plan: 'optional', build: 'optional', verify: 'required' },
};

/** Resolve the DECLARED strength for a (role, skill) pair; default `optional` when undeclared. */
function strengthFor(role: AnatomiaRole | null, skill: string): ClaimStrength {
  if (!role) return 'optional';
  return SKILL_STRENGTH[skill]?.[role] ?? 'optional';
}

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
      const role = roleOf(agent);
      // skill-invoked — one per frontmatter `skills:` entry. The DECLARED strength (D-D) is
      // resolved from the explicit per-(role × skill) map; absent declaration ⇒ `optional`
      // (byte-identical to the pre-positive-obligations claim — the `strength` key is simply
      // omitted, so an `optional` skill claim is a no-op on the absence/presence arms).
      for (const skill of frontmatterSkills(text)) {
        const src: ClaimSource = { kind: 'in-blob', blob: b.name, fidelity: 'verbatim' };
        const strength = strengthFor(role, skill);
        const saysVerb =
          strength === 'required'
            ? `must load the ${skill} skill`
            : strength === 'forbidden'
              ? `must NOT load the ${skill} skill`
              : `loads the ${skill} skill`;
        claims.push({
          id: `${agent}:skill:${skill}`,
          says: `${agent} ${saysVerb}`,
          kind: 'skill-invoked',
          scope: { kind: 'whole-session' },
          source: src,
          // OMIT `strength` when `optional` (the default) → byte-identical to the prior claim.
          ...(strength !== 'optional' ? { strength } : {}),
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
      // verify read-only-codebase — FORBIDDEN code-branch-rewriting git commands (command-run).
      // ONLY for the AnaVerify role, and ONLY when its def carries the read-only imperative.
      if (isVerifyAgent(agent) && VERIFY_READONLY_RE.test(text)) {
        for (const cmd of VERIFY_FORBIDDEN_COMMANDS) {
          const src: ClaimSource = { kind: 'in-blob', blob: b.name, fidelity: 'verbatim' };
          claims.push({
            id: `${agent}:no-code-branch-mutation:${cmd.replace(/\s+/g, '-')}`,
            says: `${agent} is read-only on the codebase and must not run \`${cmd}\` (rewrites the code branch)`,
            kind: 'command-run',
            scope: { kind: 'whole-session' },
            source: src,
            predicate: {
              target: 'command-content',
              scope: 'transcript',
              matcher: 'not_contains',
              value: cmd,
            },
          });
        }
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

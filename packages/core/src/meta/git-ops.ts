import type { SessionEvent } from '../session.js';
import { commandStringOf } from '../derive.js';

/**
 * M2 — a SEGMENT-AWARE git-operation classifier over the command stream (meta-facts P2).
 *
 * Counts of MUTATING git subcommands a session performed over time. Cross-harness — reads
 * the SHARED `commandStringOf` extractor (S3) over `Bash` (Claude) + `exec_command` (Codex)
 * tool events, so the projection is identical on both harnesses.
 *
 * WHY SEGMENT-AWARE (the freeze-blocker fix): a naive `^git` match misses the dominant
 * `cd <worktree> && git …` idiom (byte-verified: a large fraction of git commands run
 * mid-chain — the worktree-rebase pattern). So each command is SPLIT on `&&` / `;` / `|`
 * and each SEGMENT is classified independently; `git -C <path>` / `git -c <cfg>` global
 * flags are skipped before the subcommand is read.
 *
 * Read-only subcommands (`log` / `show` / `status` / `clone` / `diff` / `fetch`-as-read…)
 * are DELIBERATELY excluded — this is a MUTATING-operation projection (the artifact-branch
 * mandate cares whether the work was committed/branched/pushed, not whether it was inspected).
 * `fetch`/`pull` are kept (they mutate refs/working tree). Force-push = `--force` / `-f` /
 * `--force-with-lease`.
 *
 * LANE PRINCIPLE (ADD-1): the root-vs-subagent split is wired INTO the shape ({@link GitOpsSummary}
 * carries `root` + `subagents` sub-counts), not a trailing clause — git volume is gameable by
 * subagent churn, so the human-driven (root) signal is kept distinct.
 */

/** Per-lane mutating-git counts (read-only subcommands deliberately excluded). */
export interface GitOpCounts {
  commits: number;
  branchesCreated: number;
  pushes: number;
  forcePushes: number;
  merges: number;
  rebases: number;
  checkouts: number;
  adds: number;
  pulls: number;
  fetches: number;
  stashes: number;
  resets: number;
  tags: number;
}

/**
 * The git-ops projection: a total plus the root-vs-subagent split (the lane principle wired
 * into the shape). `total` = `root` + `subagents` field-for-field. A no-git session → all zeros
 * (not absent-as-error). NO author/identity field (the bright line).
 */
export interface GitOpsSummary {
  total: GitOpCounts;
  root: GitOpCounts;
  subagents: GitOpCounts;
}

function zero(): GitOpCounts {
  return {
    commits: 0,
    branchesCreated: 0,
    pushes: 0,
    forcePushes: 0,
    merges: 0,
    rebases: 0,
    checkouts: 0,
    adds: 0,
    pulls: 0,
    fetches: 0,
    stashes: 0,
    resets: 0,
    tags: 0,
  };
}

/**
 * Tokenize a single command SEGMENT into words, then — if it is a `git` invocation — return
 * its subcommand (skipping `git -C <path>` / `-c <cfg>` global flags) plus the remaining args.
 * Returns `null` when the segment is not a git invocation. Pure string work, no shell exec.
 */
function gitSegment(segment: string): { sub: string; args: string[] } | null {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words[0] !== 'git') return null;
  let i = 1;
  // Skip git GLOBAL flags before the subcommand: `-C <path>` / `-c <cfg>` take a value;
  // other leading `-…` global flags (e.g. `--no-pager`) are valueless. Stop at the first
  // non-flag word — that's the subcommand.
  while (i < words.length) {
    const w = words[i];
    if (w === undefined) break;
    if (w === '-C' || w === '-c') {
      i += 2; // flag + its value
      continue;
    }
    if (w.startsWith('-')) {
      i += 1; // a valueless global flag
      continue;
    }
    break;
  }
  const sub = words[i];
  if (sub === undefined) return null;
  return { sub, args: words.slice(i + 1) };
}

function isForcePush(args: string[]): boolean {
  return args.some((a) => a === '--force' || a === '-f' || a === '--force-with-lease' || a.startsWith('--force-with-lease='));
}

/** Classify ONE mutating git segment into the accumulator (no-op for read-only/unknown subs). */
function classifySegment(segment: string, acc: GitOpCounts): void {
  const g = gitSegment(segment);
  if (!g) return;
  switch (g.sub) {
    case 'commit':
      acc.commits += 1;
      break;
    case 'push':
      acc.pushes += 1;
      if (isForcePush(g.args)) acc.forcePushes += 1;
      break;
    case 'branch':
      // A mutating `branch` is a CREATE (`git branch <name>` / `-b`/`-c`/`-m` with a name);
      // a bare `git branch` / `-l`/`--list`/`-a`/`-r` is a read → not counted.
      if (
        g.args.length > 0 &&
        g.args.some((a) => !a.startsWith('-') || a === '-c' || a === '-C' || a === '-m' || a === '-M')
      ) {
        acc.branchesCreated += 1;
      }
      break;
    case 'checkout':
      acc.checkouts += 1;
      // `git checkout -b <name>` also creates a branch.
      if (g.args.includes('-b') || g.args.includes('-B')) acc.branchesCreated += 1;
      break;
    case 'switch':
      // `git switch -c <name>` creates a branch (modern checkout alias for branch creation).
      acc.checkouts += 1;
      if (g.args.includes('-c') || g.args.includes('-C')) acc.branchesCreated += 1;
      break;
    case 'merge':
      acc.merges += 1;
      break;
    case 'rebase':
      acc.rebases += 1;
      break;
    case 'add':
      acc.adds += 1;
      break;
    case 'pull':
      acc.pulls += 1;
      break;
    case 'fetch':
      acc.fetches += 1;
      break;
    case 'stash':
      acc.stashes += 1;
      break;
    case 'reset':
      acc.resets += 1;
      break;
    case 'tag':
      // A mutating `tag` creates/deletes; a bare `git tag` / `-l` is a read → not counted.
      if (g.args.length > 0 && g.args.some((a) => !a.startsWith('-') || a === '-d' || a === '-a' || a === '-f')) {
        acc.tags += 1;
      }
      break;
    default:
      // log / show / status / clone / diff / config / … — read-only or non-mutating → skip.
      break;
  }
}

/** Split one command string into segments on `&&`, `;`, `|` (the chain operators). */
function segmentsOf(command: string): string[] {
  return command.split(/&&|\|\||[;|]/g);
}

/** Classify every command in `events` into `acc` (segment-aware). */
function classifyEvents(events: SessionEvent[], acc: GitOpCounts): void {
  for (const e of events) {
    const command = commandStringOf(e);
    if (!command) continue;
    for (const seg of segmentsOf(command)) classifySegment(seg, acc);
  }
}

function addInto(acc: GitOpCounts, other: GitOpCounts): void {
  acc.commits += other.commits;
  acc.branchesCreated += other.branchesCreated;
  acc.pushes += other.pushes;
  acc.forcePushes += other.forcePushes;
  acc.merges += other.merges;
  acc.rebases += other.rebases;
  acc.checkouts += other.checkouts;
  acc.adds += other.adds;
  acc.pulls += other.pulls;
  acc.fetches += other.fetches;
  acc.stashes += other.stashes;
  acc.resets += other.resets;
  acc.tags += other.tags;
}

/**
 * Build the {@link GitOpsSummary} from a root-vs-subagent lane split. `total` is the
 * field-wise sum of `root` + `subagents`. Pure projection of the command stream.
 */
export function gitOpsOf(root: SessionEvent[], subagents: SessionEvent[]): GitOpsSummary {
  const rootC = zero();
  const subC = zero();
  classifyEvents(root, rootC);
  classifyEvents(subagents, subC);
  const total = zero();
  addInto(total, rootC);
  addInto(total, subC);
  return { total, root: rootC, subagents: subC };
}

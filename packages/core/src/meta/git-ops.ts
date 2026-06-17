import type { SessionEvent, AgentRef } from '../session.js';
import { commandStringOf } from '../derive.js';
import { commandSegments } from '../command-match.js';

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
 * Given ONE top-level segment's quote-aware WORD SURFACES (from {@link commandSegments}), return its
 * git subcommand (skipping `git -C <path>` / `-c <cfg>` global flags) plus the remaining args, or
 * `null` when the segment is not a `git` invocation. Pure — the quote-aware tokenization happened in
 * the shared lexer, so a `git` token sitting inside quoted data never reaches here as `words[0]`.
 */
function gitOpFromWords(words: string[]): { sub: string; args: string[] } | null {
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

/**
 * A `branch` segment is MUTATING (a create/rename/copy) when it names a branch or uses a
 * create/rename/copy flag; a bare `git branch` / `-l`/`--list`/`-a`/`-r` is a read → not mutating.
 * Extracted so the aggregate counter AND the positioned-timeline projection share ONE decision.
 */
function branchIsCreate(args: string[]): boolean {
  return (
    args.length > 0 &&
    args.some((a) => !a.startsWith('-') || a === '-c' || a === '-C' || a === '-m' || a === '-M')
  );
}

/**
 * A `tag` segment is MUTATING (create/delete/force); a bare `git tag` / `-l` is a read → not
 * mutating. Shared by the counter and the timeline projection (no drift).
 */
function tagIsMutating(args: string[]): boolean {
  return (
    args.length > 0 &&
    args.some((a) => !a.startsWith('-') || a === '-d' || a === '-a' || a === '-f')
  );
}

/**
 * The git subcommands that are ALWAYS mutating (the artifact-branch projection's scope; read-only
 * subs like `log`/`show`/`status`/`diff` are excluded by absence). `branch`/`tag` are CONDITIONALLY
 * mutating (see the predicates above), so they are not in this set. Mirrors the arms of
 * {@link classifySegment} exactly — both reference this single source.
 */
const ALWAYS_MUTATING_GIT_SUBS = new Set([
  'commit', 'push', 'checkout', 'switch', 'merge', 'rebase', 'add', 'pull', 'fetch', 'stash', 'reset',
]);

/** Whether a parsed git segment is a MUTATING operation (worth counting / positioning on the timeline). */
function isMutatingGitOp(sub: string, args: string[]): boolean {
  if (ALWAYS_MUTATING_GIT_SUBS.has(sub)) return true;
  if (sub === 'branch') return branchIsCreate(args);
  if (sub === 'tag') return tagIsMutating(args);
  return false;
}

/** Classify ONE segment's words into the accumulator (no-op for non-git / read-only / unknown subs). */
function classifySegment(words: string[], acc: GitOpCounts): void {
  const g = gitOpFromWords(words);
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
      if (branchIsCreate(g.args)) acc.branchesCreated += 1;
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
      if (tagIsMutating(g.args)) acc.tags += 1;
      break;
    default:
      // log / show / status / clone / diff / config / … — read-only or non-mutating → skip.
      break;
  }
}

/** Classify every command in `events` into `acc` (quote-aware, segment-aware). */
function classifyEvents(events: SessionEvent[], acc: GitOpCounts): void {
  for (const e of events) {
    const command = commandStringOf(e);
    if (!command) continue;
    for (const words of commandSegments(command)) classifySegment(words, acc);
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

// ─── A2.2 — the POSITIONED git-ops projection (crack3d's recovery-episode substrate) ──────────
/**
 * ONE mutating git operation, placed ON the ordered timeline. The aggregate {@link GitOpsSummary}
 * answers "how many"; this answers "WHEN, in what order, on which lane" — the substrate a
 * recovery/"cracked" episode join walks (failure run → … → a later commit) and the "is the commit
 * real or a no-op" gate. A FACT, never a verdict: anatrace places + parses the op; the
 * real-vs-no-op / commit-matches-the-work JUDGMENT is the consumer's.
 *
 * No author/identity field, no score — the same bright line as the rest of the meta-facts layer.
 */
export interface GitOpEvent {
  /** The git subcommand as executed (`commit`/`push`/`rebase`/`checkout`/…), after skipping `git -C`/`-c` globals. */
  subcommand: string;
  /**
   * The args AFTER the subcommand — quote-aware shell tokens (a quoted `-m "msg with spaces"` stays
   * ONE token; an unresolved `$VAR`/`$(…)` renders as a sentinel) — so a consumer can tell a REAL
   * commit from an empty / no-op / amend one itself (`--allow-empty`, `--amend`), see a branch name,
   * or read any flag. anatrace exposes the surface; it does not adjudicate "real vs no-op" (the
   * consumer's gate).
   */
  argv: string[];
  /** Convenience: a `push` carrying `--force`/`-f`/`--force-with-lease[=…]`. Always `false` for non-push ops. */
  forcePush: boolean;
  /** 0-based line index within {@link blobName} — with {@link ts}, the op's position on the canonical timeline. */
  lineIndex: number;
  /** Epoch-ms when the source event carried one; omitted when absent (the sort-last convention). */
  ts?: number;
  /** The lane that ran it (root vs a subagent). Git volume is gameable by subagent churn → keep the lane. */
  agent: AgentRef;
  /** Stable blob path (discovery-order-independent). */
  blobName: string;
}

/**
 * Project the ordered event timeline into the POSITIONED mutating-git-op stream (A2.2). Pure, no
 * clock/fs. Reads the SHARED {@link commandStringOf} extractor (so it is identical across Claude
 * `Bash` and Codex `exec_command`) and the SAME quote-aware segmentation + classifier as
 * {@link gitOpsOf} — a `cd <wt> && git commit` chain yields a positioned `commit` op, `git add x &&
 * git commit` yields TWO ops (in chain order) at the one event's position, and a `git` token inside
 * `echo "…; git push …"` data yields NONE (no phantom op). Read-only subs (`log`/`status`/`diff`/…)
 * are excluded — this is the mutating projection, byte-for-byte the aggregate's scope.
 *
 * Pass `session.events` (already canonically ordered) — emission preserves that order, and within
 * one command, left-to-right segment order. Filter by `agent` for a lane-scoped view.
 */
export function gitOpsTimeline(events: SessionEvent[]): GitOpEvent[] {
  const out: GitOpEvent[] = [];
  for (const e of events) {
    const command = commandStringOf(e);
    if (!command) continue;
    for (const words of commandSegments(command)) {
      const g = gitOpFromWords(words);
      if (!g || !isMutatingGitOp(g.sub, g.args)) continue;
      out.push({
        subcommand: g.sub,
        argv: g.args,
        forcePush: g.sub === 'push' && isForcePush(g.args),
        lineIndex: e.lineIndex,
        agent: e.agent,
        blobName: e.blobName,
        ...(e.ts !== undefined ? { ts: e.ts } : {}),
      });
    }
  }
  return out;
}

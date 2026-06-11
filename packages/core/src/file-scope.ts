/**
 * The file-scope SET rule's PINNED, deterministic source/test/collateral classifier +
 * path normalization (D1-FILESCOPE, DECISIONS A+B; Spike A). Without a pinned classifier the
 * `violated` verdict is non-reproducible — so the AXIS (source vs test vs collateral) is a
 * golden-tested core constant. The exact globs are refinable against the corpus; the AXIS is fixed.
 */

/** The three classes the SET rule partitions every edited path into. */
export type PathClass = 'source' | 'test' | 'collateral';

/**
 * COLLATERAL (always ignored): plan artifacts, vitest snapshots, lockfiles, generated site
 * artifacts. These never count toward a file-scope deviation.
 */
function isCollateral(p: string): boolean {
  if (p.startsWith('.ana/') || p.includes('/.ana/')) return true;
  if (p.includes('__snapshots__/') || p.endsWith('.snap')) return true;
  if (
    p.endsWith('package-lock.json') ||
    p.endsWith('pnpm-lock.yaml') ||
    p.endsWith('yarn.lock') ||
    p.endsWith('bun.lockb') ||
    p.endsWith('.lock')
  ) {
    return true;
  }
  // Generated site artifacts.
  const base = p.split('/').pop() ?? p;
  if (base === 'llms.txt' || base === 'llms-full.txt' || base === 'search-index.json') return true;
  return false;
}

/**
 * TEST / licensed-sibling (not a violation when its source is in-contract): test files, docs,
 * and agent-def templates — the corpus convention is that the contract lists the source and the
 * sibling test/doc/agent-def is implicitly licensed (DECISION A).
 */
function isTest(p: string): boolean {
  const base = p.split('/').pop() ?? p;
  if (/\.test\.[cm]?[jt]sx?$/.test(base) || /\.spec\.[cm]?[jt]sx?$/.test(base)) return true;
  if (p.includes('tests/') || p.startsWith('tests/')) return true;
  if (base.endsWith('.md') || base.endsWith('.mdx')) return true;
  if (p.includes('templates/.claude/agents/') || p.includes('.claude/agents/')) return true;
  return false;
}

/** Classify an already-normalized (repo-relative) edit path. Everything not collateral/test = source. */
export function classifyEditPath(normalizedPath: string): PathClass {
  if (isCollateral(normalizedPath)) return 'collateral';
  if (isTest(normalizedPath)) return 'test';
  return 'source';
}

/**
 * Two-step normalization (Spike A, PINNED): (1) relativize an absolute path against the repo
 * root, THEN (2) strip a leading `.ana/worktrees/<slug>/` segment (~22% of source edits carry
 * it). Bare suffix-match is SPOOFABLE → rejected (relativize against the known root instead).
 * Contract paths are already repo-relative → consumed as-is.
 */
export function normalizeEditPath(absOrRel: string, repoRoot: string): string {
  let p = absOrRel;
  // 1. de-absolutize against the repo root (when known).
  if (repoRoot && p.startsWith(repoRoot.endsWith('/') ? repoRoot : `${repoRoot}/`)) {
    p = p.slice(repoRoot.endsWith('/') ? repoRoot.length : repoRoot.length + 1);
  } else if (repoRoot && p === repoRoot) {
    p = '';
  }
  // 2. de-worktree: strip a leading `.ana/worktrees/<slug>/`.
  p = p.replace(/^\.ana\/worktrees\/[^/]+\//, '');
  // Defensive: also strip an EMBEDDED worktree segment that survived an unknown root, so an
  // absolute worktree path still normalizes when the root wasn't supplied.
  p = p.replace(/^.*\/\.ana\/worktrees\/[^/]+\//, '');
  // Strip a leading absolute marker if the root was unknown and the path is still absolute,
  // keeping the longest repo-relative-looking suffix is UNSAFE (spoofable) — so we do NOT
  // suffix-strip an unknown-root absolute path; it stays absolute and won't match the whitelist.
  return p;
}

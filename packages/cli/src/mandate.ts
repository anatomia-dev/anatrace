import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  detectMandateAdapter,
  validateMandate,
  coverageStat,
  renderCoverageLine,
  loadPolicyYaml,
} from 'anatrace-core';
import type { NamedBlob, Mandate, MandateClaim, ContentResolver } from 'anatrace-core';

/**
 * `anatrace mandate show` — the C5 read-only renderer. PURE PROJECTION: it extracts a Mandate
 * from the framework source files and prints the claims + the predicate-coverage stat. NO
 * verdicts, NO LLM (EXT.0-safe). Disk discovery lives HERE (the CLI), never in core; core
 * `extract` works on the `NamedBlob[]` bytes only.
 *
 * `cross-artifact` claim sources (e.g. a `contract.yaml` referenced by slug) are resolved
 * slug→bytes via the injected `ContentResolver` (OQ-C4) — core never touches disk.
 */

/** Recursively read the mandate-source files under a directory as canonical NamedBlobs. */
function readMandateDir(dir: string): NamedBlob[] {
  const blobs: NamedBlob[] = [];
  const walk = (d: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile() && (e.name.endsWith('.md') || /\.ya?ml$/.test(e.name))) {
        try {
          blobs.push({ name: r, bytes: new Uint8Array(fs.readFileSync(abs)) });
        } catch {
          /* skip unreadable */
        }
      }
    }
  };
  walk(dir, '');
  return blobs;
}

/** A disk-backed ContentResolver for the CLI (cross-artifact slug→bytes). Core never calls this inline. */
export function fsContentResolver(root: string): ContentResolver {
  return (p: string): Uint8Array | null => {
    try {
      const abs = path.isAbsolute(p) ? p : path.join(root, p);
      return new Uint8Array(fs.readFileSync(abs));
    } catch {
      return null;
    }
  };
}

function predicateLabel(c: MandateClaim): string {
  if (!c.predicate) return c.kind === 'intent' ? 'intent' : 'intent (→ your model)';
  const p = c.predicate;
  const v = p.value !== undefined ? ` ${JSON.stringify(p.value)}` : '';
  const conf = c.confidence ? ` {${c.confidence}}` : '';
  return `${p.target} ${p.matcher}${v} [${p.scope}]${conf}`;
}

/** Render the extracted mandate: claims + the honest per-claim coverage stat. */
export function renderMandate(mandate: Mandate): string {
  const lines: string[] = [];
  lines.push(`mandate — ${mandate.framework} (${mandate.claims.length} claim(s))`);
  for (const c of mandate.claims) {
    const scopeLabel =
      c.scope.kind === 'event-triggered-window'
        ? `window:${c.scope.opensOn}→${c.scope.closesOn}`
        : c.scope.kind;
    lines.push(`  • [${c.kind}] ${c.id}`);
    lines.push(`      says: ${c.says}`);
    lines.push(`      scope: ${scopeLabel} · ${predicateLabel(c)} · source:${c.source.fidelity}`);
  }
  const stat = coverageStat(mandate);
  lines.push('');
  lines.push(`  ${renderCoverageLine(stat)}`);
  // P0.3 — extraction-honesty gaps: obligation markers we RECOGNIZED but could not mechanically
  // extract. Surfaced loudly so under-extraction is a visible limitation, not a silent omission.
  if (mandate.diagnostics?.length) {
    lines.push('');
    lines.push(`  ⚠ extraction gaps (${mandate.diagnostics.length}) — recognized but NOT mechanically checked:`);
    for (const d of mandate.diagnostics) {
      const tag = d.marker ? `${d.kind}:${d.marker}` : d.kind;
      lines.push(`      • [${tag}] ${d.detail}`);
    }
  }
  return lines.join('\n');
}

export interface MandateShowResult {
  ok: boolean;
  message: string;
}

/**
 * The resolved mandate + its disk-backed `ContentResolver` (for cross-artifact slug→bytes), or
 * a failure with a user-facing message. The `resolver` is `fsContentResolver(dir)` so a verdict
 * pass over `cross-artifact` sources can read them from the same source dir.
 */
export type ResolveMandateResult =
  | { ok: true; mandate: Mandate; resolver: ContentResolver }
  | { ok: false; message: string };

/**
 * Resolve a generic `.anatrace.yaml` file without any framework adapter.
 *
 * @param file - Policy file path.
 * @returns The compiled Mandate and a resolver rooted beside the policy.
 */
export function resolvePolicy(file: string): ResolveMandateResult {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, message: `anatrace: policy not found: ${file}` };
  }
  const loaded = loadPolicyYaml(text, path.basename(file));
  if (!loaded.ok) {
    return {
      ok: false,
      message: `anatrace: invalid policy:\n  ${loaded.errors.join('\n  ')}`,
    };
  }
  return {
    ok: true,
    mandate: loaded.mandate,
    resolver: fsContentResolver(path.dirname(file)),
  };
}

/**
 * Resolve a mandate source dir → detected adapter → extracted + validated `Mandate`, plus a
 * disk-backed `ContentResolver` rooted at the dir. Framework-agnostic via `detectMandateAdapter`
 * (no adapter is hardcoded). Shared by `mandate show` (renders it) and the root `--mandate` flag
 * (verifies against it).
 *
 * @param dir - The framework mandate-source directory to resolve.
 * @returns `{ok:true, mandate, resolver}` on success, else `{ok:false, message}`.
 */
export function resolveMandate(dir: string): ResolveMandateResult {
  if (!fs.existsSync(dir)) {
    return { ok: false, message: `anatrace: mandate source not found: ${dir}` };
  }
  const group = readMandateDir(dir);
  if (!group.length) {
    return { ok: false, message: `anatrace: no mandate source files under ${dir}` };
  }
  const adapter = detectMandateAdapter(group);
  if (!adapter) {
    return { ok: false, message: 'anatrace: no mandate framework detected in the source files.' };
  }
  const mandate = adapter.extract(group);
  if (!mandate) {
    return { ok: false, message: `anatrace: ${adapter.framework} adapter extracted no claims.` };
  }
  if (!mandate.claims.length) {
    // P0.3 — recognized-but-empty: the framework was detected but ZERO obligations were extractable.
    // Surface the gap LOUDLY instead of verifying nothing / failing as if no framework was present.
    const gaps = (mandate.diagnostics ?? []).map((d) => `  - ${d.detail}`).join('\n');
    return {
      ok: false,
      message: `anatrace: ${adapter.framework} framework detected but no obligations were extractable — verification would be vacuous.${gaps ? `\n${gaps}` : ''}`,
    };
  }
  const errs = validateMandate(mandate);
  if (errs.length) {
    return { ok: false, message: `anatrace: invalid mandate:\n  ${errs.join('\n  ')}` };
  }
  return { ok: true, mandate, resolver: fsContentResolver(dir) };
}

/**
 * `anatrace mandate show <dir>` — resolve then render. Behavior is byte-identical to before:
 * it delegates resolution to {@link resolveMandate} and renders the extracted mandate.
 *
 * @param mandateDir - The framework mandate-source directory.
 * @returns `{ok, message}` — the rendered mandate, or the failure message.
 */
export function mandateShow(mandateDir: string): MandateShowResult {
  const res = resolveMandate(mandateDir);
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, message: renderMandate(res.mandate) };
}

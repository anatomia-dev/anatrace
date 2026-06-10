import type { NormalizedSession, UsageEvent } from './session.js';
import type { ProvenanceCounts, TokenCounts } from './provenance.js';
import { PRICE_TABLE_VERSION } from './pricing.js';

/**
 * Derive version (REQ Item 4). Bump when a value the derive produces moves for identical
 * bytes. `'2'` (B1): emitting human `MessageEvent`s carries user-line timestamps into the
 * `minTs`/`maxTs` window, so `duration_ms` can widen for identical bytes.
 *
 * `'3'` (D-DERIVE / FI-2): `parseTestCounts` is now GATED to RUNNER results (`COMMAND_TOOLS`
 * via the new `ToolResultEvent.forTool`), so a `Read`/`Grep` result echoing "N passed" no
 * longer inflates `tests_executed` (the phantom-test vector). This moves ONLY the demoted,
 * best-effort `tests_executed`/`failures_encountered` counts on a fixture with a non-runner
 * "N passed" echo — the bit-frozen tier (`tokens`/`model`/`price_table_version`/`derive_version`)
 * is UNTOUCHED (`foldTokens` reads only `usage`). The bump gates exactly that demoted move.
 */
export const DERIVE_VERSION = '3';

/** Tool names that count as a shell command (REQ Item 3). `write_stdin` is excluded upstream. */
const COMMAND_TOOLS = new Set(['Bash', 'exec_command']);

function emptyTokens(): TokenCounts {
  return { input: 0, output: 0, cache_create: 0, cache_read: 0 };
}

function tokenTotal(t: TokenCounts): number {
  return t.input + t.output + t.cache_create + t.cache_read;
}

function addInto(acc: TokenCounts, t: TokenCounts): void {
  acc.input += t.input;
  acc.output += t.output;
  acc.cache_create += t.cache_create;
  acc.cache_read += t.cache_read;
}

/**
 * ccusage `should_replace_deduped_daily_entry` (daily.rs:416-425), mirrored exactly:
 * (1) differ on sidechain ⇒ keep the NON-sidechain copy (regardless of total);
 * (2) else keep the GREATER summed total. Stable on a tie (no replace).
 */
function shouldReplace(candidate: UsageEvent, existing: UsageEvent): boolean {
  const candSide = candidate.isSidechain === true;
  const exSide = existing.isSidechain === true;
  if (candSide !== exSide) return exSide; // replace existing only if existing is the sidechain copy
  return tokenTotal(candidate.usage) > tokenTotal(existing.usage);
}

/**
 * The token fold (REQ Item 3). Claude: dedup by `message.id`, sidechain-first then
 * MAX-total; samples without a messageId are always included. Codex: the LAST cumulative
 * sample wins (already cache-subtracted by the adapter). Pure projection of UsageEvents.
 */
function foldTokens(session: NormalizedSession): TokenCounts {
  if (session.harness === 'codex') {
    let last: TokenCounts | null = null;
    for (const e of session.events) {
      if (e.type === 'usage' && e.cumulative) last = e.usage;
    }
    return last ? { ...last } : emptyTokens();
  }
  // claude
  const best = new Map<string, UsageEvent>();
  const loose: TokenCounts[] = [];
  for (const e of session.events) {
    if (e.type !== 'usage') continue;
    if (e.messageId === undefined) {
      loose.push(e.usage);
      continue;
    }
    const existing = best.get(e.messageId);
    if (!existing || shouldReplace(e, existing)) best.set(e.messageId, e);
  }
  const acc = emptyTokens();
  for (const u of best.values()) addInto(acc, u.usage);
  for (const t of loose) addInto(acc, t);
  return acc;
}

/**
 * Best-effort "N passed"/"N failed" parse (ported from anatomia forensics.ts). A missed
 * count is `0`, never an inferred judgement.
 */
function parseTestCounts(text: string): { tests: number; failures: number } {
  let tests = 0;
  let failures = 0;
  const passed = text.match(/(\d+)\s+passed/);
  if (passed) tests += Number(passed[1]);
  const failed = text.match(/(\d+)\s+failed/);
  if (failed) {
    const n = Number(failed[1]);
    tests += n;
    failures += n;
  }
  return { tests, failures };
}

/**
 * Derive {@link ProvenanceCounts} as a PURE PROJECTION of a session's event timeline
 * (REQ Item 4) — never a parallel computation. Deterministic: no clock, no randomness,
 * no network. Same session → `JSON.stringify`-identical counts. The token fold is the
 * sole token computer; structural counts fold the timeline; duration comes from the
 * events' own timestamps.
 *
 * @param session - The normalized session (its `events` are the only input read)
 * @returns The derived counts, frozen tier = tokens/model/price_table_version/derive_version
 */
export function deriveCounts(session: NormalizedSession): ProvenanceCounts {
  const tokens = foldTokens(session);

  let turns = 0;
  let toolCalls = 0;
  let commandsRun = 0;
  let testsExecuted = 0;
  let failuresEncountered = 0;
  let model = '';
  const filesTouched = new Set<string>();
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const e of session.events) {
    if (e.ts !== undefined) {
      if (e.ts < minTs) minTs = e.ts;
      if (e.ts > maxTs) maxTs = e.ts;
    }
    switch (e.type) {
      case 'message':
        if (e.role === 'assistant') {
          turns += 1;
          if (!model && e.model) model = e.model;
        }
        break;
      case 'tool':
        toolCalls += 1;
        if (COMMAND_TOOLS.has(e.name)) commandsRun += 1;
        break;
      case 'edit':
        toolCalls += 1;
        for (const p of e.paths) filesTouched.add(p);
        break;
      case 'toolResult': {
        // FI-2 runner-gate: only parse "N passed"/"N failed" from a RUNNER result (a
        // COMMAND_TOOL via `forTool`). A `Read`/`Grep` result echoing "N passed" (the
        // phantom-test vector) is NOT a test run → never inflates `tests_executed`. When
        // `forTool` is absent (older bytes / no join), we conservatively DO NOT count — "0
        // tests" gates on no runner-evidence, never an accusation (Cracked's runner-gate spec).
        if (e.forTool && COMMAND_TOOLS.has(e.forTool)) {
          const c = parseTestCounts(e.text ?? '');
          testsExecuted += c.tests;
          failuresEncountered += c.failures;
        }
        break;
      }
      default:
        break;
    }
  }

  const durationMs =
    Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs >= minTs ? maxTs - minTs : 0;

  return {
    tokens,
    price_table_version: PRICE_TABLE_VERSION,
    derive_version: DERIVE_VERSION,
    duration_ms: durationMs,
    turns,
    tool_calls: toolCalls,
    commands_run: commandsRun,
    tests_executed: testsExecuted,
    failures_encountered: failuresEncountered,
    files_touched: filesTouched.size,
    model,
  };
}

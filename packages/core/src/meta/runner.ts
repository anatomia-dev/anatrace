import type { SessionEvent, AgentRef } from '../session.js';
import { isCommandToolName } from '../derive.js';

/**
 * A2.3 — the STRUCTURED test-runner OUTCOME projection (crack3d's recovery-detector substrate).
 *
 * crack3d's recovery/"cracked" join needs to know a failure run TURNED INTO a later verified
 * success. Its prior detector keyed on text that merely *mentions* tests, so it terminated on a
 * result that said "passed" without it being a real PASS (a definitional false-positive). This
 * projection removes that FP at the source: a typed `{ runner, outcome: pass|fail|unknown, counts }`
 * per result, with two honesty gates baked in —
 *
 *  1. RUNNER-GATED. A result is only considered when its originating tool is a shell-command tool
 *     (`forTool ∈ {Bash, exec_command}`, the FI-2 join). A `Read`/`Grep` result echoing "N passed"
 *     (the phantom-test vector) is NEVER a runner outcome — the same gate `deriveCounts` uses for
 *     `tests_executed`.
 *  2. ABSTAIN, NEVER GUESS. Runner evidence present but the pass/fail summary unreadable (truncated
 *     output, e.g. `vitest 2>&1 | tail -3`) → `outcome: 'unknown'`, never a fabricated PASS. A
 *     consumer must not read `'unknown'` as a verified success — that is the whole point.
 *
 * A FACT, not a verdict: ZERO LLM, pure string projection, no clock/fs. NO author/identity field.
 *
 * SCOPE (the same discipline as `COMMAND_TOOLS`: model only what a real transcript emits, and never
 * classify on a signal that isn't UNAMBIGUOUSLY a test runner). Only two detectors ship, both keyed
 * on a runner-SPECIFIC banner that ordinary command output does not produce:
 *  - `vitest`/`jest` — the `Test Files` / `Tests` summary block (the dominant corpus shape);
 *  - `ana` — the ana-internal `… (verdict: pass|fail)` line (an explicit verdict).
 *
 * Everything else — a bare `N passed`/`N failed`, a `… in <n>s` timing line, a `test result:` line,
 * `go test`'s `ok`/`FAIL` banner — is DELIBERATELY NOT classified (the projection returns no outcome,
 * never a guessed PASS). Those phrasings are NOT runner-specific: a deploy log, a health check, a k6
 * load test, `npm audit`, a build summary all routinely emit "N passed [in <n>s]" or "test result: …",
 * so classifying on them is a false-PASS vector (the cardinal sin). pytest/cargo/go are a KNOWN,
 * documented blind spot — UNDER-detection (a real run we can't recognize) is an honest gap; a false
 * PASS is not. They will be added only when a real transcript supplies a tell we can pin without
 * over-reaching. A bare npm/pnpm `ELIFECYCLE` is likewise not a runner signal on its own (it marks a
 * failed script of ANY kind); when it accompanies a real vitest summary the vitest detector fires.
 */

/** One classified test-runner result, placed on the ordered timeline. */
export interface RunnerOutcome {
  /** The detected runner family: `'vitest'` | `'ana'`. Open-ended (a future grounded runner adds a value). */
  runner: string;
  /**
   * `'pass'` / `'fail'` when the summary is conclusive; `'unknown'` when runner evidence is present
   * but the pass/fail outcome could not be read (truncated/partial output) — the honesty floor.
   */
  outcome: 'pass' | 'fail' | 'unknown';
  /** Tests passed, when a count was parsed (omitted when unreadable). */
  passed?: number;
  /** Tests failed, when a count was parsed (omitted when unreadable). */
  failed?: number;
  /** Tests skipped, when a count was parsed (omitted when unreadable). */
  skipped?: number;
  /** The originating `tool_use` id (the FI-2/FI-13 join key) — lets a consumer key outcomes by call. */
  toolUseId?: string;
  /** 0-based line index within {@link blobName} — with {@link ts}, the result's position on the timeline. */
  lineIndex: number;
  /** Epoch-ms when the source event carried one; omitted when absent (the sort-last convention). */
  ts?: number;
  /** The lane that produced it (root vs a subagent). */
  agent: AgentRef;
  /** Stable blob path (discovery-order-independent). */
  blobName: string;
}

/** The `ana`-internal capture line: `counts: N passed, M failed[, K skipped]  (verdict: pass|fail)`. */
const ANA_RE =
  /counts:\s*(\d+)\s+passed,\s*(\d+)\s+failed(?:,\s*(\d+)\s+skipped)?\s*\(verdict:\s*(pass|fail)\)/g;
/** The vitest/jest summary lines (anchored to a line start; `Test Files` is the runner-specific tell). */
const TEST_FILES_RE = /^[^\S\n]*Test Files[^\S\n]+(.+)$/m;
const TESTS_RE = /^[^\S\n]*Tests[^\S\n]+(.+)$/m;
/**
 * ANSI CSI escapes (color/erase/cursor) — stripped before matching so a control sequence spliced into
 * a count token (`1 <ESC>[2Kfailed`) can't hide a failure. Full CSI form, not just SGR `m`. Built via
 * `String.fromCharCode(27)` so the source carries no literal control byte and trips no lint rule.
 */
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[A-Za-z]', 'g');

/** Best-effort `N passed` / `N failed` / `N skipped` extraction from one summary segment. */
function parseCounts(segment: string): { passed?: number; failed?: number; skipped?: number } {
  const out: { passed?: number; failed?: number; skipped?: number } = {};
  const p = segment.match(/(\d+)\s+passed/);
  if (p) out.passed = Number(p[1]);
  const f = segment.match(/(\d+)\s+failed/);
  if (f) out.failed = Number(f[1]);
  const s = segment.match(/(\d+)\s+skipped/);
  if (s) out.skipped = Number(s[1]);
  return out;
}

/** The classified core of one result's text, or `null` when there is no runner evidence at all. */
type RunnerClass = Pick<RunnerOutcome, 'runner' | 'outcome' | 'passed' | 'failed' | 'skipped'>;

function classifyRunnerText(raw: string): RunnerClass | null {
  // Strip ANSI/SGR color FIRST: real runners color their summary on a TTY/forced-color path, and a
  // color escape sitting between a digit and `failed` would otherwise hide the failure token while
  // `passed` survived — a one-sided break is enough to flip a real FAIL to a false PASS.
  const text = raw.replace(ANSI_RE, '');

  // 1) ana-internal — an explicit `(verdict: pass|fail)`, the authoritative signal. Checked FIRST
  //    (its line also contains "N passed, M failed", which a count scan would otherwise eat).
  //    Worst-wins across checkpoints: any `verdict: fail` ⇒ fail; counts from the decisive line.
  const ana = [...text.matchAll(ANA_RE)];
  if (ana.length > 0) {
    const failMatch = ana.find((m) => m[4] === 'fail');
    const decisive = failMatch ?? ana[ana.length - 1]!;
    return {
      runner: 'ana',
      outcome: failMatch ? 'fail' : 'pass',
      passed: Number(decisive[1]),
      failed: Number(decisive[2]),
      ...(decisive[3] !== undefined ? { skipped: Number(decisive[3]) } : {}),
    };
  }

  // 2) vitest/jest — the `Test Files` / `Tests` summary block.
  const testFiles = TEST_FILES_RE.exec(text);
  const tests = TESTS_RE.exec(text);
  if (testFiles || tests) {
    if (tests) {
      const counts = parseCounts(tests[1]!);
      if (counts.passed !== undefined || counts.failed !== undefined) {
        const failed = counts.failed ?? 0;
        // A `Test Files  N failed …` line is an independent fail tell (a suite can fail to load with
        // zero test-level failures) → worst-wins.
        const filesFailed = testFiles ? /failed/.test(testFiles[1]!) : false;
        return { runner: 'vitest', outcome: failed > 0 || filesFailed ? 'fail' : 'pass', ...counts };
      }
    }
    // Runner banner present but no readable count (truncated/partial output) → abstain, never guess.
    return { runner: 'vitest', outcome: 'unknown' };
  }

  // No runner-SPECIFIC banner (vitest / ana) → not a recognizable test result. A bare "N passed",
  // a `… in <n>s` timing line, or a `test result:` line is NOT runner-specific (deploy/health/audit
  // logs emit them too), so it is deliberately not classified — under-detection over a false PASS.
  return null;
}

/**
 * Project the ordered event timeline into the structured runner-outcome stream (A2.3). Pure, no
 * clock/fs. Considers ONLY `toolResult` events whose originating tool is a shell-command tool
 * (`forTool ∈ {Bash, exec_command}`) and that carry runner evidence; everything else is skipped
 * (no over-emission). Emission preserves canonical event order — pass `session.events`.
 */
export function runnerOutcomes(events: SessionEvent[]): RunnerOutcome[] {
  const out: RunnerOutcome[] = [];
  for (const e of events) {
    if (e.type !== 'toolResult') continue;
    if (!isCommandToolName(e.forTool)) continue; // the runner-gate (FI-2): phantom "N passed" echoes excluded
    const cls = classifyRunnerText(e.text ?? '');
    if (!cls) continue;
    out.push({
      ...cls,
      lineIndex: e.lineIndex,
      agent: e.agent,
      blobName: e.blobName,
      ...(e.toolUseId !== undefined ? { toolUseId: e.toolUseId } : {}),
      ...(e.ts !== undefined ? { ts: e.ts } : {}),
    });
  }
  return out;
}

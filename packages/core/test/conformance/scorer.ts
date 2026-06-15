/**
 * The pinned, deterministic conformance scorer. Runs anatrace's own engine over the labeled
 * {@link CORPUS} and reduces the per-(claim,session) verdicts to a soundness read. Pure + deterministic:
 * same corpus + same engine bytes → same result.
 *
 * Its job is the REGRESSION GATE — that the engine does not slip into a FALSE-PASS (`satisfied` where
 * ground truth is `violated`, the one error the brand forbids) or a false-VIOLATE on a known class. The
 * risk-coverage figures it computes (coverage, abstention, the Wilson bound) are an INTERNAL read of the
 * conformance corpus, NOT a publishable benchmark — a real measured number needs real sessions at volume.
 */
import { claudeAdapter } from '../../src/adapters/claude.js';
import { analyze } from '../../src/analyze.js';
import { loadPolicyYaml } from '../../src/policy.js';
import type { VerdictStatus } from '../../src/verdict.js';
import { CORPUS, type CorpusItem, type GroundTruth } from './corpus.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Build a synthetic Claude session from a corpus item's tool calls (one assistant turn). */
function buildSession(item: CorpusItem): ReturnType<typeof claudeAdapter.parse> {
  const content = item.calls.map((c, i) => ({ type: 'tool_use', id: `t${i}`, name: c.name, input: c.input }));
  const line = {
    type: 'assistant', sessionId: item.id, version: item.version ?? '2.1.170', uuid: 'a1',
    timestamp: '2026-06-12T00:00:01.000Z',
    message: {
      id: 'm1', role: 'assistant', model: 'claude-opus-4-8', content,
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
  return claudeAdapter.parse([{ name: 'parent', bytes: enc(JSON.stringify(line)) }]);
}

/** One scored pair (claim × session) with its ground truth and the engine's verdict. */
export interface ScoredPair {
  itemId: string;
  claimId: string;
  truth: GroundTruth;
  verdict: VerdictStatus | 'absent';
  outcome: 'true-pass' | 'true-violate' | 'false-pass' | 'false-violate' | 'honest-abstain' | 'wrong-on-degraded' | 'unresolved';
}

export interface Soundness {
  pairs: ScoredPair[];
  applicable: number;
  answered: number;
  coverage: number; // answered / applicable
  abstentionRate: number; // 1 - coverage
  falsePass: number; // satisfied where truth=violated — the cardinal sin
  falseViolate: number; // violated where truth=satisfied
  answeredViolatedTruth: number; // the denominator for the false-PASS rate (where a false-pass was possible)
  answeredSatisfiedTruth: number;
  falsePassRate: number;
  falseViolateRate: number;
  falsePassUpper95: number; // Wilson upper bound (so "0 observed" is reported as a bound, never a point)
  falseViolateUpper95: number;
}

/** Wilson score interval upper bound for `k` errors in `n` trials at 95% (z = 1.96). n=0 → 0. */
export function wilsonUpper95(k: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.959963984540054;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return (center + margin) / denom;
}

/** Score the corpus through the real engine. Deterministic. */
export function scoreCorpus(corpus: CorpusItem[] = CORPUS): Soundness {
  const pairs: ScoredPair[] = [];
  for (const item of corpus) {
    const session = buildSession(item);
    if (!session) throw new Error(`corpus item ${item.id} failed to parse`);
    const loaded = loadPolicyYaml(item.policy);
    if (!loaded.ok) throw new Error(`corpus item ${item.id} policy failed: ${loaded.errors.join('; ')}`);
    const report = analyze(session, undefined, undefined, loaded.mandate, '', { thisAgent: { kind: 'root' } });
    const verdicts = new Map((report.compliance ?? []).map((v) => [v.claimId, v.status] as const));
    for (const [claimId, truth] of Object.entries(item.truth)) {
      const verdict = verdicts.get(claimId) ?? 'absent';
      pairs.push({ itemId: item.id, claimId, truth, verdict, outcome: classify(truth, verdict) });
    }
  }

  const applicable = pairs.length;
  const answered = pairs.filter((p) => p.verdict === 'satisfied' || p.verdict === 'violated').length;
  const falsePass = pairs.filter((p) => p.outcome === 'false-pass').length;
  const falseViolate = pairs.filter((p) => p.outcome === 'false-violate').length;
  const answeredViolatedTruth = pairs.filter((p) => p.truth === 'violated' && (p.verdict === 'satisfied' || p.verdict === 'violated')).length;
  const answeredSatisfiedTruth = pairs.filter((p) => p.truth === 'satisfied' && (p.verdict === 'satisfied' || p.verdict === 'violated')).length;

  return {
    pairs,
    applicable,
    answered,
    coverage: answered / applicable,
    abstentionRate: 1 - answered / applicable,
    falsePass,
    falseViolate,
    answeredViolatedTruth,
    answeredSatisfiedTruth,
    falsePassRate: answeredViolatedTruth ? falsePass / answeredViolatedTruth : 0,
    falseViolateRate: answeredSatisfiedTruth ? falseViolate / answeredSatisfiedTruth : 0,
    falsePassUpper95: wilsonUpper95(falsePass, answeredViolatedTruth),
    falseViolateUpper95: wilsonUpper95(falseViolate, answeredSatisfiedTruth),
  };
}

function classify(truth: GroundTruth, verdict: VerdictStatus | 'absent'): ScoredPair['outcome'] {
  if (verdict === 'absent') return 'unresolved'; // the claim did not resolve at all — a corpus/engine bug
  if (truth === 'violated') {
    if (verdict === 'violated') return 'true-violate';
    if (verdict === 'satisfied') return 'false-pass'; // the cardinal sin
    return 'honest-abstain'; // unverifiable on a real breach — not an error, but lowers coverage
  }
  if (truth === 'satisfied') {
    if (verdict === 'satisfied') return 'true-pass';
    if (verdict === 'violated') return 'false-violate';
    return 'honest-abstain';
  }
  // truth === 'abstain-ok' — the honest answer is unverifiable.
  return verdict === 'unverifiable' ? 'honest-abstain' : 'wrong-on-degraded';
}

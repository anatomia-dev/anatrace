/**
 * The LLM-judge SEAM (D-HOOK / E1/E2) — DESIGNED in D, WIRED in E. D ships the frozen
 * `JudgeInput`/`JudgeVerdict` types, the `hookRequests` residue manifest, and the `adjudicate`
 * signature + the E2 guard — but NO CLI judge impl; `capabilities.judge` stays unpopulated and
 * core names no model. D is a complete, shippable, zero-LLM product.
 *
 * THE BRIGHT LINE: `analyze()` NEVER reads `capabilities.judge`; `adjudicate` is a SEPARATE
 * entrypoint that walks `hookRequests` and calls the injected judge. `ComplianceVerdict
 * {source:'deterministic'}` ⟂ `JudgeVerdict{source:'llm',rationale,model}` is a literal-
 * discriminant union; the deterministic channel can never leak prose.
 */
import type { Mandate, MandateClaim } from './mandate.js';
import type { JudgeFn } from './types.js';
import type { ComplianceVerdict, VerdictStatus } from './verdict.js';
import type { Dossier, DossierClaimSlice } from './dossier.js';
import type { ScrubbedExcerpt } from './scrub.js';

/**
 * The bounded scrubbed dossier slice handed to the judge — NOT the transcript (the cost lever).
 * Concrete frozen interface replacing the `@experimental` `unknown` placeholder.
 */
export interface JudgeInput {
  claim: { id: string; says: string; kind: string };
  scope: string;
  evidence: ScrubbedExcerpt[];
  contentExcerpts?: ScrubbedExcerpt[];
  promptHint?: string;
}

/**
 * The LLM judge's verdict — TYPE-DISJOINT from `ComplianceVerdict`. `rationale` (prose) is
 * allowed ONLY here; `model` records which model judged; NO `severity`. `source:'llm'` is the
 * literal discriminant.
 */
export interface JudgeVerdict {
  claimId: string;
  status: VerdictStatus;
  source: 'llm';
  model: string;
  rationale: string;
}

/** One residue item: a `routed-to-llm` claim + its slice (what `adjudicate` eats). */
export interface HookRequest {
  claimId: string;
  input: JudgeInput;
}

/** Map a dossier slice → a bounded `JudgeInput`. */
function inputFromSlice(slice: DossierClaimSlice): JudgeInput {
  return {
    claim: { id: slice.claim.id, says: slice.claim.says, kind: slice.claim.kind },
    scope: slice.claim.scope,
    evidence: slice.evidenceText ?? [],
  };
}

/**
 * Build the residue manifest from the verdict set + dossier: every `routed-to-llm` claim and
 * its bounded slice. A team with NO judge gets a complete, inspectable `hookRequests` and ships
 * ZERO LLM calls — the dossier alone is a complete product.
 */
export function buildHookRequests(
  mandate: Mandate,
  verdicts: ComplianceVerdict[],
  dossier: Dossier,
): HookRequest[] {
  const sliceById = new Map<string, DossierClaimSlice>();
  for (const s of [...dossier.satisfied, ...dossier.violated, ...dossier.unverifiable]) {
    sliceById.set(s.claim.id, s);
  }
  const out: HookRequest[] = [];
  for (const v of verdicts) {
    if (v.status !== 'unverifiable' || v.reason !== 'routed-to-llm') continue;
    const slice = sliceById.get(v.claimId);
    if (slice) out.push({ claimId: v.claimId, input: inputFromSlice(slice) });
  }
  return out;
}

/** The judge budget (honored by `adjudicate`). */
export interface JudgeBudget {
  maxClaims?: number;
}

/**
 * `adjudicate` — the SEPARATE entrypoint (NOT inside `analyze`) that walks `hookRequests` and
 * calls the injected judge, honoring `budget.maxClaims`. This is the ONLY place the judge is
 * read; `analyze()` never touches it (the E2 guard). D ships the signature; E wires the CLI impl.
 */
export async function adjudicate(
  hookRequests: HookRequest[],
  judge: JudgeFn,
  budget?: JudgeBudget,
): Promise<JudgeVerdict[]> {
  const limit = budget?.maxClaims ?? hookRequests.length;
  const out: JudgeVerdict[] = [];
  for (const req of hookRequests.slice(0, limit)) {
    const raw = await judge(req.input);
    // The injected judge returns a JudgeOutput; D pins it to the JudgeVerdict shape at the seam.
    out.push(raw as JudgeVerdict);
  }
  return out;
}

export type { MandateClaim };

/**
 * The dossier (D2) — the said-vs-did artifact + the judge input + the dataset substrate.
 * Rides `Report.dossier?` AND is exported as a standalone `buildDossier` so Cracked consumes
 * it WITHOUT `analyze()`/`Report` (FI-5). Evidence is BOUNDED + SCRUBBED — the cost lever
 * (a ~325-token slice ≈ $0.0015/claim) AND human-skimmable. The residue is FIRST-CLASS: an
 * all-`unverifiable` dossier is still a complete product ("we can't see this deterministically;
 * here's the evidence; ask your model").
 */
import type { Mandate, MandateClaim, ClaimKind } from './mandate.js';
import type { NormalizedSession, SessionEvent } from './session.js';
import type { ContentResolver } from './types.js';
import type { ComplianceVerdict } from './verdict.js';
import { coverageStat, type CoverageStat } from './mandate-coverage.js';
import { scrubText, type ScrubbedExcerpt } from './scrub.js';

/** The dossier schema version (additive; independent of `Report.schemaVersion`). */
export const DOSSIER_SCHEMA_VERSION = 1;

/** Bounded evidence cap — lines of context per evidence pointer (the cost lever; golden-tested). */
export const EVIDENCE_CAP = 4;

/** A compact view of a claim for the dossier (no internal predicate machinery). */
export interface DossierClaim {
  id: string;
  says: string;
  kind: ClaimKind;
  scope: string;
  source: string;
}

/** One claim's said-vs-did slice. The constructor SCRUBS internally — no unscrubbed slice exists. */
export interface DossierClaimSlice {
  claim: DossierClaim;
  verdict: ComplianceVerdict;
  evidenceText?: ScrubbedExcerpt[];
}

export interface Dossier {
  schemaVersion: number;
  coverage: CoverageStat;
  satisfied: DossierClaimSlice[];
  violated: DossierClaimSlice[];
  unverifiable: DossierClaimSlice[];
}

function scopeLabel(claim: MandateClaim): string {
  return claim.scope.kind;
}
function sourceLabel(claim: MandateClaim): string {
  const s = claim.source;
  return s.kind === 'cross-artifact' ? `${s.workItemSlug}:${s.path}` : s.blob;
}

/** Resolve an evidence pointer to a BOUNDED, SCRUBBED excerpt around the event's text. */
function excerptFor(session: NormalizedSession, blobName: string, lineIndex: number): ScrubbedExcerpt | null {
  const ev = session.events.find((e) => e.blobName === blobName && e.lineIndex === lineIndex);
  if (!ev) return null;
  const text = eventText(ev);
  // Bound: keep at most EVIDENCE_CAP lines around the pointer.
  const lines = text.split('\n').slice(0, EVIDENCE_CAP);
  return { blobName, lineIndex, text: scrubText(lines.join('\n')) };
}

function eventText(ev: SessionEvent): string {
  switch (ev.type) {
    case 'message':
      return ev.text ?? '';
    case 'toolResult':
      return ev.text ?? '';
    case 'tool':
      return ev.name + (ev.input ? ` ${JSON.stringify(ev.input)}` : '');
    case 'edit':
      return `${ev.op} ${ev.paths.join(' → ')}`;
    case 'skill':
      return `skill:${ev.skill}`;
    case 'command':
      return `/${ev.command}${ev.args ? ` ${ev.args}` : ''}`;
    default:
      return '';
  }
}

function sliceFor(
  claim: MandateClaim,
  verdict: ComplianceVerdict,
  session: NormalizedSession,
): DossierClaimSlice {
  const dc: DossierClaim = {
    id: claim.id,
    says: scrubText(claim.says),
    kind: claim.kind,
    scope: scopeLabel(claim),
    source: scrubText(sourceLabel(claim)),
  };
  const excerpts: ScrubbedExcerpt[] = [];
  for (const p of verdict.evidence) {
    const ex = excerptFor(session, p.blobName, p.lineIndex);
    if (ex) excerpts.push(ex);
  }
  return { claim: dc, verdict, ...(excerpts.length ? { evidenceText: excerpts } : {}) };
}

/**
 * Build the dossier from a session + mandate + the precomputed verdict set. Standalone (FI-5);
 * the resolver is accepted for parity but evidence excerpts are drawn from the transcript
 * timeline (the pointers), so it is currently unused for slicing. Pure; no LLM.
 */
export function buildDossier(
  session: NormalizedSession,
  mandate: Mandate,
  verdicts: ComplianceVerdict[],
  _resolver?: ContentResolver,
): Dossier {
  const byId = new Map(mandate.claims.map((c) => [c.id, c]));
  const satisfied: DossierClaimSlice[] = [];
  const violated: DossierClaimSlice[] = [];
  const unverifiable: DossierClaimSlice[] = [];
  for (const v of verdicts) {
    const claim = byId.get(v.claimId);
    if (!claim) continue;
    const slice = sliceFor(claim, v, session);
    if (v.status === 'satisfied') satisfied.push(slice);
    else if (v.status === 'violated') violated.push(slice);
    else unverifiable.push(slice);
  }
  return {
    schemaVersion: DOSSIER_SCHEMA_VERSION,
    coverage: coverageStat(mandate),
    satisfied,
    violated,
    unverifiable,
  };
}

/**
 * The zero-mandate `human-constraint` wedge — extract+verify "don't touch X" vs `EditEvent.paths`
 * with NO mandate file. The cheapest wedge + the purest public demo ("we verify what nobody
 * recorded"). Synthesizes a single file-scope claim from the constraint and builds a dossier.
 * Zero adapter, zero contract, zero LLM.
 */
export function buildZeroMandateWedge(
  session: NormalizedSession,
  forbiddenPath: string,
  verdicts: ComplianceVerdict[],
): Dossier {
  const synthetic: Mandate = {
    schemaVersion: 1,
    framework: 'human-constraint',
    claims: [
      {
        id: 'human-constraint',
        says: `do not touch ${forbiddenPath}`,
        kind: 'human-constraint',
        scope: { kind: 'whole-session' },
        source: { kind: 'in-blob', blob: 'parent', fidelity: 'derived' },
        predicate: { target: 'edit-paths', matcher: 'not_contains', scope: 'transcript', value: forbiddenPath },
      },
    ],
  };
  return buildDossier(session, synthetic, verdicts);
}

export type { CoverageStat };

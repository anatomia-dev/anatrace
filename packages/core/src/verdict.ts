/**
 * The deterministic verdict layer (Phase D1 — the brand). A pure projection that resolves
 * each `MandateClaim` against the real session transcript into a `satisfied | violated |
 * unverifiable` verdict with a CLOSED, machine-readable reason and POINTER evidence —
 * ZERO LLM, byte-identical with or without a judge.
 *
 * BRIGHT LINES this module enforces (the deterministic ⟂ LLM wall):
 *  1. `ComplianceVerdict` carries NO `severity`, NO `rationale`, NO `model` — the forbidden
 *     axes (severity is a config-layer mapping; rationale/model are the LLM `JudgeVerdict`'s
 *     channel ONLY). A structural test pins its key set ⊆ {claimId,status,reason,evidence,source}.
 *  2. `reason` is a CLOSED enum, never free prose (prose re-opens the bright line).
 *  3. `verdictForClaim`/`verdictsForMandate` take NO judge parameter — determinism + the wall.
 *  4. Cohort/cross-harness honesty: absent signal → `unverifiable`, NEVER `violated`; a
 *     Claude-only signal on a Codex session → `unverifiable(codex-blind)`, never a silent pass.
 *
 * Surveillance guardrail: a verdict keys ONLY on `claimId` (the obligation), never on an
 * author/identity. The Learn ratchet promotes PROCESS rules, never person-scores.
 */
import type {
  MandateClaim,
  Mandate,
  ClaimPredicate,
  WindowOpensOn,
} from './mandate.js';
import type {
  NormalizedSession,
  SessionEvent,
  SessionEventBody,
  AgentRef,
} from './session.js';
import { agentKey, uniqueAgents, sameAgentRef } from './session.js';
import type { ContentResolver } from './types.js';
import type {
  CaptureCoverage,
  MandateEvaluationContext,
} from './capture-coverage.js';
import { skillsInvokedInScope } from './skills.js';
import { laneCapture, isGradeableCapture } from './meta/lane.js';
import { commandStringOf, isUnreadableCommandEvent } from './derive.js';
import { classifyCommandMatch } from './command-match.js';
import { harnessVersionStatus } from './harness-support.js';
import {
  channelCoverageForClaim,
  incompleteChannelCoverageForClaim,
  inspectBehavioralChannels,
  type ClaimChannelCoverage,
} from './channels.js';
import {
  classifyEditPath,
  normalizeEditPath,
  type PathClass,
} from './file-scope.js';

export type VerdictStatus = 'satisfied' | 'violated' | 'unverifiable';

/**
 * The CLOSED verdict-reason vocabulary (never prose — the #1 deterministic-purity decision).
 * `contract-under-specified` is deliberately ABSENT: a MASS file-scope spread is a non-gating
 * `info` `Finding` (DECISION B), NOT a verdict reason (a known-count spread is verifiable, so
 * calling it `unverifiable` would be dishonest).
 */
export type VerdictReason =
  | 'predicate-matched' // the satisfied cause (incl. a met negation)
  | 'predicate-not-matched' // the violated cause (incl. a violated negation)
  | 'routed-to-llm' // no predicate / kind:'intent' — the E residue
  | 'runtime-scoped' // predicate.scope==='runtime' — the transcript can't see it
  | 'low-confidence' // confidence:'low' (nested/overlapping window, dispatch)
  | 'absent-signal' // a positive obligation whose signal never appears
  | 'content-unresolvable' // ContentResolver returned null / absent
  | 'command-unresolvable' // 0a — a forbidden-command check whose EXECUTED surface is obfuscated
  //                          (eval / $(…) / backtick / a $VAR that could expand to the needle /
  //                          pipe-into-an-interpreter / unbalanced quoting): can't prove ran-or-not
  | 'codex-blind' // a Claude-only signal on a Codex session
  | 'subject-unresolvable' // this-agent / role binding was absent or ambiguous
  | 'delegate-coverage-incomplete' // no complete trusted delegate manifest / missing declared lane
  | 'channel-coverage-incomplete' // a relevant tool/command channel could not be classified
  | 'window-unresolvable' // an event-triggered window couldn't be bounded
  | 'harness-version-unrecognized' // P0.6 — the harness MAJOR version is outside the supported floor
  | 'session-parse-suspect'; // P0.6/P0.8 — parse looks degraded (token-monotonicity broke, or a
  //                            non-empty transcript parsed to ZERO events): absence is unprovable, so
  //                            a forbidden-direction check must NOT read "no events" as compliant

/** Evidence POINTS into the canonical timeline; it never COPIES bytes (scrub-safe, determinism-trivial). */
export interface EvidencePointer {
  blobName: string;
  lineIndex: number;
  agent: AgentRef;
  eventType: SessionEventBody['type'];
}

/**
 * One deterministic verdict for one claim. NET-NEW; rides the reserved `Report.compliance?`
 * channel; NOT reachable from a `MandateClaim` (the E2 guard). The key set is FROZEN — a
 * structural test pins it ⊆ {claimId,status,reason,evidence,source} so no future edit leaks
 * `rationale`/`severity`/`model` into the deterministic channel.
 */
export interface ComplianceVerdict {
  claimId: string;
  status: VerdictStatus;
  reason: VerdictReason;
  evidence: EvidencePointer[];
  source: 'deterministic';
}

// Pure core sets `types: []` + `lib: ["ES2022"]` — declare `TextDecoder` minimally so the
// file-content arm typechecks WITHOUT a DOM lib (the purity wall). Mirrors `adapter.ts:27`.
declare const TextDecoder: {
  new (label?: string): { decode(input?: Uint8Array): string };
};

/** Build a pointer from a timeline event. */
function pointer(e: SessionEvent): EvidencePointer {
  return { blobName: e.blobName, lineIndex: e.lineIndex, agent: e.agent, eventType: e.type };
}

function verdict(
  claimId: string,
  status: VerdictStatus,
  reason: VerdictReason,
  evidence: EvidencePointer[] = [],
): ComplianceVerdict {
  return { claimId, status, reason, evidence, source: 'deterministic' };
}

/**
 * The pinned NEGATIVE-matcher mapping, shared across every forbidden-direction arm (read-paths,
 * egress, read-scope, command-content, file-content): a hit on a forbidden predicate IS the
 * violation (`violated`/`predicate-not-matched`, carrying evidence); no hit → `satisfied`/
 * `predicate-matched`. One locus for this decision so an arm can never re-derive it backwards
 * (the `evalFileContent` byte-identical-branch bug). POSITIVE-direction semantics genuinely differ
 * per arm (a miss is `unverifiable`/`absent-signal` for read-paths/egress but `violated` for
 * file-content), so those stay arm-local — this helper deliberately covers only the shared half.
 */
function negate(claimId: string, hit: boolean, evidence: EvidencePointer[] = []): ComplianceVerdict {
  return hit
    ? verdict(claimId, 'violated', 'predicate-not-matched', evidence)
    : verdict(claimId, 'satisfied', 'predicate-matched');
}

/** The injected content source (B4) — disk impl at the CLI, or the in-core transcript impl. */
type AnyResolver = ContentResolver;

interface SubjectResolution {
  events: SessionEvent[];
  agents: AgentRef[];
  delegateComplete: boolean;
}

function expandDelegates(
  anchors: AgentRef[],
  coverage: CaptureCoverage | undefined,
): { agents: AgentRef[]; complete: boolean } {
  if (!coverage || coverage.source !== 'trusted-launcher') {
    return { agents: uniqueAgents(anchors), complete: false };
  }
  const lanes = new Map<string, CaptureCoverage['lanes'][number]>();
  let duplicateLane = false;
  for (const lane of coverage.lanes) {
    const key = agentKey(lane.agent);
    if (lanes.has(key)) duplicateLane = true;
    lanes.set(key, lane);
  }
  const out: AgentRef[] = [];
  const resolved = new Set<string>();
  const visiting = new Set<string>();
  let complete = !duplicateLane && coverage.completeness !== 'incomplete';

  const visit = (agent: AgentRef): void => {
    const key = agentKey(agent);
    if (visiting.has(key)) {
      complete = false; // a launcher manifest must be an acyclic dispatch graph
      return;
    }
    if (resolved.has(key)) return;
    resolved.add(key);
    out.push(agent);
    const lane = lanes.get(key);
    if (!lane || !lane.captured || lane.delegateManifest.status !== 'complete') {
      complete = false;
      return;
    }
    visiting.add(key);
    for (const delegate of lane.delegateManifest.delegates) visit(delegate);
    visiting.delete(key);
  };

  for (const anchor of anchors) visit(anchor);
  return { agents: out, complete };
}

function resolveSubject(
  claim: MandateClaim,
  session: NormalizedSession,
  context: MandateEvaluationContext | undefined,
): SubjectResolution | null {
  const subject = claim.subject;
  if (!subject) {
    return { events: session.events, agents: lanesOf(session), delegateComplete: true };
  }

  let anchors: AgentRef[];
  let includeDelegates = false;
  if (subject.kind === 'session') {
    anchors = [{ kind: 'root' }];
    includeDelegates = true;
  } else if (subject.kind === 'agent') {
    if (!context?.thisAgent) return null;
    anchors = [context.thisAgent];
    includeDelegates = subject.delegates === 'include';
  } else {
    const bound = context?.roleBindings?.[subject.role];
    if (!bound?.length) return null;
    anchors = bound;
    includeDelegates = subject.delegates === 'include';
  }

  let expanded = includeDelegates
    ? expandDelegates(anchors, context?.captureCoverage)
    : { agents: uniqueAgents(anchors), complete: true };
  // A root-inclusive subject always scans every observed lane, even without a manifest:
  // observed violations remain provable. The manifest is needed only to prove that the scan
  // was exhaustive. An observed lane omitted by a supposedly complete manifest invalidates
  // completeness rather than disappearing from evaluation.
  if (includeDelegates && anchors.some((agent) => agent.kind === 'root')) {
    const observed = uniqueAgents([
      ...lanesOf(session),
      ...(context?.lineage?.observedDelegates ?? []),
    ]);
    const declared = new Set(expanded.agents.map(agentKey));
    const hasUndeclaredObserved = observed.some((agent) => !declared.has(agentKey(agent)));
    expanded = {
      agents: uniqueAgents([...expanded.agents, ...observed]),
      complete: expanded.complete && !hasUndeclaredObserved,
    };
  }
  if (includeDelegates && (context?.lineage?.gaps.length ?? 0) > 0) {
    expanded = { ...expanded, complete: false };
  }
  const keys = new Set(expanded.agents.map(agentKey));
  return {
    events: session.events.filter((event) => keys.has(agentKey(event.agent))),
    agents: expanded.agents,
    delegateComplete: expanded.complete,
  };
}

function satisfactionProvesAbsence(claim: MandateClaim): boolean {
  if (!claim.predicate) return false;
  if (NEGATIVE_MATCHERS.has(claim.predicate.matcher)) return true;
  if (claim.strength === 'forbidden') return true;
  return (
    claim.kind === 'file-scope' &&
    (claim.predicate.target === 'edit-paths' || claim.predicate.target === 'read-paths')
  );
}

function resultProvesAbsence(
  claim: MandateClaim,
  result: ComplianceVerdict,
): boolean {
  if (result.status === 'satisfied') return satisfactionProvesAbsence(claim);
  return (
    result.status === 'violated' &&
    claim.strength === 'required' &&
    result.reason === 'predicate-not-matched'
  );
}

/**
 * P0.8 — the parse-suspect signal: a NON-EMPTY transcript that parsed to ZERO structured events is a
 * likely misparse (e.g. a within-range renamed event type the parser silently skipped). "No events"
 * then cannot prove absence — it may be a misparse, not compliance. Deliberately NOT gated on
 * `tokenTotalSuspect`: a cumulative-token-fold regression is NOT event loss. The timeline can be
 * fully present while token totals don't fold monotonically, so a token-fold break must not abstain
 * an absence verdict — only ZERO structured events (with non-empty input) does. (`tokenTotalSuspect`
 * stays a non-gating `--last` breadcrumb.)
 */
function sessionParseSuspect(session: NormalizedSession): boolean {
  const h = session.parseHealth;
  return h !== undefined && h.inputNonEmpty && h.structuredEventCount === 0;
}

/**
 * P0.8 — the SHARED absence gate. A verdict that is satisfied BY ABSENCE (no violating sighting) is
 * honest only if the evidence boundary is complete. Returns the degraded `unverifiable` verdict when
 * a completeness condition fails, else `null` (the absence stands). Used by BOTH the per-claim
 * post-result gate AND the file-scope batch so neither can read "no events" as "compliant"
 * (the cardinal sin — a forbidden-command `not_contains` falsely `satisfied` on a misparse).
 * Parse-suspect is checked FIRST: if the parse can't be trusted, no narrower gate matters.
 */
function absenceGate(
  claimId: string,
  provesAbsence: boolean,
  session: NormalizedSession,
  channelGaps: number,
  delegateComplete: boolean,
): ComplianceVerdict | null {
  if (!provesAbsence) return null;
  if (sessionParseSuspect(session)) return verdict(claimId, 'unverifiable', 'session-parse-suspect');
  if (channelGaps > 0) return verdict(claimId, 'unverifiable', 'channel-coverage-incomplete');
  if (!delegateComplete) return verdict(claimId, 'unverifiable', 'delegate-coverage-incomplete');
  return null;
}

/**
 * Resolve ONE claim to ONE verdict — universal pre-checks IN ORDER, then dispatch by target.
 * Takes NO judge parameter. `findings` is an out-param: a MASS file-scope spread pushes a
 * non-gating `info` Finding here (DECISION B) instead of a verdict.
 */
export function verdictForClaim(
  claim: MandateClaim,
  session: NormalizedSession,
  resolver?: AnyResolver,
  sink?: FileScopeFindingSink,
  repoRoot = '',
  context?: MandateEvaluationContext,
): ComplianceVerdict {
  // Pre-check 1 — low confidence (nested/overlapping window, the dispatch adapter ships it).
  if (claim.confidence === 'low') return verdict(claim.id, 'unverifiable', 'low-confidence');
  // Pre-check 2 — no predicate / intent → the E residue.
  if (claim.kind === 'intent' || !claim.predicate) {
    return verdict(claim.id, 'unverifiable', 'routed-to-llm');
  }
  const predicate = claim.predicate;
  // Pre-check 3 — runtime scope: the transcript can't see it (the honesty gate, ~90%+ of contract.yaml).
  if (predicate.scope === 'runtime') return verdict(claim.id, 'unverifiable', 'runtime-scoped');

  // Pre-check 3.5 (P0.6) — catastrophic harness drift. A PARSEABLE version whose MAJOR is outside the
  // supported floor is a format anatrace has never seen → it cannot trust ANY parse-based verdict over
  // this transcript. This is the COARSE floor only; within-major drift is NOT gated here — that is the
  // parse-suspect signal's job (the absence gate). `absent`/`recognized` versions never gate here.
  if (harnessVersionStatus(session.harness, session.observedVersions) === 'out-of-range') {
    return verdict(claim.id, 'unverifiable', 'harness-version-unrecognized');
  }

  // Pre-check 4 — resolve WHO independently from WHEN. Missing bindings are never inferred.
  const subject = resolveSubject(claim, session, context);
  if (!subject) return verdict(claim.id, 'unverifiable', 'subject-unresolvable');

  // Pre-check 5 — resolve the temporal window on exactly one subject lane.
  let scopedEvents = subject.events;
  if (claim.scope.kind === 'event-triggered-window') {
    if (subject.agents.length !== 1) {
      return verdict(claim.id, 'unverifiable', 'window-unresolvable');
    }
    const agent = subject.agents[0];
    if (!agent) return verdict(claim.id, 'unverifiable', 'window-unresolvable');
    const win = resolveWindow(claim.scope.opensOn, agent, subject.events);
    if (win === null) return verdict(claim.id, 'unverifiable', 'window-unresolvable');
    scopedEvents = win;
  } else if (claim.scope.kind === 'cross-session') {
    // cross-session is not resolvable from a single session's transcript.
    return verdict(claim.id, 'unverifiable', 'window-unresolvable');
  }

  // Dispatch over the subject+time intersection. Evaluators that project from `session`
  // receive the filtered view, so no arm can accidentally escape the subject boundary.
  const scopedSession = { ...session, events: scopedEvents };
  const result = dispatchTarget(
    claim,
    predicate,
    scopedSession,
    scopedEvents,
    resolver,
    sink,
    repoRoot,
  );
  const channelCoverage = channelCoverageForClaim(claim, scopedEvents);
  const gated = absenceGate(
    claim.id,
    resultProvesAbsence(claim, result),
    session,
    channelCoverage.gaps.length,
    subject.delegateComplete,
  );
  return gated ?? result;
}

function dispatchTarget(
  claim: MandateClaim,
  predicate: ClaimPredicate,
  session: NormalizedSession,
  scopedEvents: SessionEvent[],
  resolver: AnyResolver | undefined,
  sink: FileScopeFindingSink | undefined,
  repoRoot = '',
): ComplianceVerdict {
  switch (predicate.target) {
    case 'edit-paths':
      return evalEditPaths(claim, session, sink, repoRoot);
    case 'read-paths':
      return evalReadPaths(claim, predicate, session);
    case 'skill-events':
      return evalSkillEvents(claim, predicate, session, scopedEvents);
    case 'message-text':
      return evalMessageText(claim, predicate, scopedEvents);
    case 'subagent':
      // `exists` only; the adapter ships confidence:'low' (pre-checked) — the honest D1 ceiling.
      return verdict(claim.id, 'unverifiable', codexBlindable(session) ? 'codex-blind' : 'low-confidence');
    case 'tool-names':
      return evalToolNames(claim, predicate, session, scopedEvents);
    case 'command-content':
      return evalCommandContent(claim, predicate, session, scopedEvents);
    case 'egress':
      return evalEgress(claim, predicate, scopedEvents);
    case 'file-content':
      return evalFileContent(claim, predicate, resolver);
    case 'event-order':
      // RESERVED, unimplemented (TDD-ordering deferred — no test-run event).
      return verdict(claim.id, 'unverifiable', 'routed-to-llm');
    default:
      return verdict(claim.id, 'unverifiable', 'routed-to-llm');
  }
}

/** Codex still lacks structured Skill/subagent primitives; read checks now use shell channels. */
function codexBlindable(session: NormalizedSession): boolean {
  return session.harness === 'codex';
}

// FI-17 — the SINGLE SOURCE of matcher totality. `isComparableMatcher`, `matchStr`, and
// `evalMessageText` all key off these so the wall can never drift out of lockstep (pinned by the
// matcher-totality value-lock test). `matches`/`gte`/`lte` are deliberately absent → unverifiable.
const COMPARABLE_MATCHERS = new Set(['contains', 'not_contains', 'equals', 'not_equals', 'exists']);
const NEGATIVE_MATCHERS = new Set(['not_contains', 'not_equals']);

/**
 * FI-17 — matcher totality. The string-comparable matchers `matchStr` mechanically implements
 * (`contains`/`not_contains`/`equals`/`not_equals`/`exists`). `matches`/`gte`/`lte` are NOT
 * mechanically comparable in the string arms — a caller must treat them as `unverifiable`
 * (`content-unresolvable`), NEVER let `matchStr`'s `default:false` collapse into a silent
 * `satisfied`/`violated`. Checked ONCE per claim at evaluator entry (not per element).
 */
function isComparableMatcher(matcher: string): boolean {
  return COMPARABLE_MATCHERS.has(matcher);
}

// ─── read-paths (verify-independence) ────────────────────────────────────────────────────
/**
 * Bind to the `Read` tool's `file_path` ONLY (Spike B: precision 1.0). Negative-matcher
 * mapping (pinned): absence of the path → `satisfied(predicate-matched)`; presence →
 * `violated(predicate-not-matched)`. Phase 1 also inspects recognized shell read channels.
 */
function evalReadPaths(
  claim: MandateClaim,
  predicate: ClaimPredicate,
  session: NormalizedSession,
): ComplianceVerdict {
  // FI-17 — matcher totality: a matcher this arm can't mechanically compare → unverifiable.
  if (!isComparableMatcher(predicate.matcher)) {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  const needle = String(predicate.value ?? '');
  const reads = inspectBehavioralChannels(session.events).reads;
  const hits = reads.filter((r) => matchStr(r.path, predicate.matcher, needle));
  const isNegative = NEGATIVE_MATCHERS.has(predicate.matcher);
  if (isNegative) {
    // `not_contains 'build_report'`: a hit (path CONTAINS it) is a VIOLATION of the obligation.
    return negate(claim.id, hits.length > 0, hits.map((h) => h.evidence));
  }
  // Positive matcher: a hit is satisfaction.
  if (hits.length > 0) {
    return verdict(claim.id, 'satisfied', 'predicate-matched', hits.map((h) => h.evidence));
  }
  return verdict(claim.id, 'unverifiable', 'absent-signal');
}

/**
 * `only_read` allowlist verdict over structured Read events. Policy claims use
 * `kind:'file-scope' + target:'read-paths' + matcher:'contains'`; mandate-level batching
 * supplies the union of all declared paths for the same source and subject.
 */
function readScopeVerdict(
  claimId: string,
  whitelist: Set<string>,
  session: NormalizedSession,
  repoRoot = '',
): ComplianceVerdict {
  const reads = inspectBehavioralChannels(session.events).reads;
  const outside: EvidencePointer[] = [];
  for (const read of reads) {
    const normalized = normalizeEditPath(read.path, repoRoot);
    if (!normalized || normalized.startsWith('/')) {
      return verdict(claimId, 'unverifiable', 'content-unresolvable');
    }
    if (whitelist.has(normalized)) continue;
    outside.push({
      ...read.evidence,
    });
  }
  return negate(claimId, outside.length > 0, outside);
}

// ─── egress ─────────────────────────────────────────────────────────────────────────────
/**
 * Phase 1 intentionally implements the coarse, buyer-relevant rule: any observed external
 * shell/network/MCP action violates `never_egress`. Destination/resource allowlists belong
 * to the Phase 3 taxonomy. Unknown relevant channels are handled by the universal coverage
 * gate after dispatch, never silently treated as clean.
 */
function evalEgress(
  claim: MandateClaim,
  predicate: ClaimPredicate,
  scopedEvents: SessionEvent[],
): ComplianceVerdict {
  if (!isComparableMatcher(predicate.matcher)) {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  const observed = inspectBehavioralChannels(scopedEvents).egress;
  const isNegative = NEGATIVE_MATCHERS.has(predicate.matcher) || claim.strength === 'forbidden';
  if (isNegative) {
    return negate(
      claim.id,
      observed.length > 0,
      observed.map((item) => item.evidence),
    );
  }
  return observed.length > 0
    ? verdict(
        claim.id,
        'satisfied',
        'predicate-matched',
        observed.map((item) => item.evidence),
      )
    : verdict(claim.id, 'unverifiable', 'absent-signal');
}

// ─── the observability + completeness gate (P2-GATE, D-B) ────────────────────────────────
/**
 * The set of distinct lanes (`AgentRef`) present on the session timeline (root ∪ each subagent).
 * The FLAT union the lane-attribution rule keys on (REQ: root ∪ all descendant lanes).
 */
function lanesOf(session: NormalizedSession): AgentRef[] {
  const out: AgentRef[] = [];
  let hasRoot = false;
  const subagentIds = new Set<string>();
  for (const e of session.events) {
    if (e.agent.kind === 'root') hasRoot = true;
    else subagentIds.add(e.agent.subagentId);
  }
  if (hasRoot) out.push({ kind: 'root' });
  for (const id of subagentIds) out.push({ kind: 'subagent', subagentId: id });
  return out;
}

/**
 * The AFFIRMATIVE observability + completeness gate for a `required`-skill ABSENCE (D-B, the
 * honesty floor). Returns whether an absent `required` skill obligation may honestly flip to
 * `violated`, plus the precise `unverifiable` reason when it may NOT. The burden of proof is on
 * OBSERVABILITY, never the agent — the default is NOT observable (`unverifiable`).
 *
 * Two halves, BOTH must hold across the FLAT union of lanes:
 *  (a) SIGNAL OBSERVABLE — at least one lane emits ≥1 STRUCTURED `Skill` event (`source:'tool'`).
 *      Codex has no `Skill` primitive → `codex-blind`. A lane whose only skill signal is
 *      free-text announce (`source:'announce-text'`) is NOT a structured emitter → `low-confidence`.
 *  (b) ALL CONTRIBUTING LANES COMPLETE — every lane that emits structured `Skill` events resolves
 *      to a GRADEABLE `capture` (`complete`/`compacted-in-place`). If ANY such lane is
 *      `lane-start`/`truncated`/`unknown`, the skill could have run in dropped history →
 *      `unverifiable` (NEVER `violated`). This is the compaction-dropped-skill guard.
 *
 * Only when BOTH hold may absence be a provable `violated`.
 */
function requiredSkillObservable(
  session: NormalizedSession,
): { observable: true } | { observable: false; reason: VerdictReason } {
  // Codex has no structured Skill primitive at all.
  if (codexBlindable(session)) return { observable: false, reason: 'codex-blind' };
  const lanes = lanesOf(session);
  // (a) the lanes that emit a STRUCTURED Skill event (source 'tool', the R2 default for absent).
  const structuredLanes = lanes.filter((lane) =>
    session.events.some(
      (e) => e.type === 'skill' && (e.source ?? 'tool') === 'tool' && sameAgentRef(e.agent, lane),
    ),
  );
  if (structuredLanes.length === 0) {
    // No structured Skill emitter anywhere → not affirmatively observable. If there IS an
    // announce-text skill signal it is merely low-confidence; otherwise the signal is absent.
    const hasAnnounce = session.events.some(
      (e) => e.type === 'skill' && e.source === 'announce-text',
    );
    return { observable: false, reason: hasAnnounce ? 'low-confidence' : 'absent-signal' };
  }
  // (b) EVERY lane in the FLAT union must be GRADEABLE. We check ALL lanes (not only the
  // structured emitters): a `lane-start`/`truncated`/`unknown` lane lost pre-history in which the
  // required skill COULD have run — even one ⇒ `unverifiable`, never `violated`. This is the
  // compaction-dropped-skill / cardinal-sin guard (the required skill could live in dropped bytes).
  for (const lane of lanes) {
    if (!isGradeableCapture(laneCapture(session, lane))) {
      // Reuse `content-unresolvable` for an incomplete-lane absence (the FROZEN enum has no
      // dedicated reason; the Finding layer surfaces the precise `capture` state — P4).
      return { observable: false, reason: 'content-unresolvable' };
    }
  }
  return { observable: true };
}

// ─── skill-events ────────────────────────────────────────────────────────────────────────
/**
 * Match the (lane-scoped) `skillsInvoked` with a structured `tool` source.
 *
 * STRENGTH-AWARE (D-A / D-D, positive obligations):
 *  - `optional` (default / absent): present → `satisfied`; absent → today's `unverifiable`,
 *    NEVER `violated` (byte-identical to pre-positive-obligations behavior).
 *  - `required`: present (FLAT union) → `satisfied`; absent + the observability+completeness gate
 *    PASSES → `violated`/`predicate-not-matched`; absent + gate FAILS → `unverifiable` with the
 *    precise reason. You can never prove a skip on a lane you couldn't reliably + completely see.
 *  - `forbidden`: present → `violated`/`predicate-not-matched`; absent → `satisfied`.
 *
 * An announce-text-only signal is LOW-CONFIDENCE: it satisfies `optional`/`required` presence
 * only as `unverifiable(low-confidence)` (never a structured pass), and is NOT enough to
 * `violate` a `forbidden` (you can't prove a structured invocation from free text).
 */
function evalSkillEvents(
  claim: MandateClaim,
  predicate: ClaimPredicate,
  session: NormalizedSession,
  scopedEvents: SessionEvent[],
): ComplianceVerdict {
  // `session.events` is already the subject+time intersection built by verdictForClaim.
  const invoked = skillsInvokedInScope(session);
  const needle = String(predicate.value ?? '');
  const match = invoked.find((s) => s.skill === needle || s.skill.includes(needle));
  const strength = claim.strength ?? 'optional';

  if (match) {
    if (match.source === 'announce-text') {
      // Free-text announce — low-confidence presence. Never a structured pass; never enough to
      // `violate` a `forbidden` (can't prove a structured invocation happened from prose).
      return verdict(claim.id, 'unverifiable', 'low-confidence');
    }
    // A STRUCTURED Skill invocation is present.
    const ev = scopedEvents.find((e) => e.type === 'skill' && e.skill === match.skill);
    if (strength === 'forbidden') {
      // The forbidden arm: a present structured invocation is the VIOLATION.
      return verdict(claim.id, 'violated', 'predicate-not-matched', ev ? [pointer(ev)] : []);
    }
    // `required`/`optional` presence → satisfied.
    return verdict(claim.id, 'satisfied', 'predicate-matched', ev ? [pointer(ev)] : []);
  }

  // ABSENT (no structured match in scope).
  if (strength === 'forbidden') {
    // The forbidden thing did not happen → satisfied (the negative obligation is met).
    return verdict(claim.id, 'satisfied', 'predicate-matched');
  }
  if (strength === 'required') {
    // V1 BOUNDARY: required is present/absent only — windowed/timing required is DEFERRED to v2.
    // A windowed (non-whole-session) required claim must NEVER reach the whole-session gate: its
    // presence is checked scope-locally but the gate observes the whole session, so a skill that
    // ran OUTSIDE the window (e.g. in root) would be falsely reported `violated` (the cardinal
    // sin). Guard it: any non-whole-session required claim resolves `unverifiable`, never
    // `violated`. This closes the scope-vs-gate false-violated path. (`scope` is defined iff the
    // claim is event-triggered-window, i.e. claim.scope.kind !== 'whole-session'.)
    if (claim.scope.kind !== 'whole-session') {
      return verdict(claim.id, 'unverifiable', 'low-confidence');
    }
    // The HONESTY FLOOR: absence flips to `violated` ONLY when the affirmative gate proves the
    // signal is reliably observable AND every contributing lane is complete. Default → unverifiable.
    const gate = requiredSkillObservable(session);
    if (gate.observable) {
      // Evidence = the expected locus (the first structured Skill emission point) so the Finding
      // can point at where the required skill was expected; empty when no locus is resolvable.
      const locus = session.events.find(
        (e) => e.type === 'skill' && (e.source ?? 'tool') === 'tool',
      );
      return verdict(claim.id, 'violated', 'predicate-not-matched', locus ? [pointer(locus)] : []);
    }
    return verdict(claim.id, 'unverifiable', gate.reason);
  }

  // `optional` absence → today's behavior (NEVER violated).
  if (codexBlindable(session)) return verdict(claim.id, 'unverifiable', 'codex-blind');
  return verdict(claim.id, 'unverifiable', 'absent-signal');
}

// ─── message-text ────────────────────────────────────────────────────────────────────────
/**
 * `MessageEvent.text` of the `role` literally `.includes(value)` (NEVER a `RegExp` — the
 * `literalsOnly` load-time guard already rejects wildcards). Absence → `absent-signal`.
 */
function evalMessageText(
  claim: MandateClaim,
  predicate: ClaimPredicate,
  scopedEvents: SessionEvent[],
): ComplianceVerdict {
  const role = 'role' in predicate ? predicate.role : undefined;
  const needle = String(predicate.value ?? '');
  const matcher = predicate.matcher;
  // FI-17 — matcher totality from the SINGLE source. message-text supports the comparable matchers
  // EXCEPT `exists` (a literal-only channel; `matches`/`gte`/`lte` would re-open the bright line) →
  // anything else is `unverifiable`, never a silent verdict.
  if (!COMPARABLE_MATCHERS.has(matcher) || matcher === 'exists') {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  const isNegative = NEGATIVE_MATCHERS.has(matcher);
  const isExact = matcher === 'equals' || matcher === 'not_equals';
  let firstHit: SessionEvent | undefined;
  for (const e of scopedEvents) {
    if (e.type !== 'message') continue;
    if (role && e.role !== role) continue;
    // LITERAL match — never RegExp. `equals`/`not_equals` → EXACT compare; `contains`/
    // `not_contains` → the bright-line-pinned literal `.includes`.
    const text = e.text ?? '';
    if (isExact ? text === needle : text.includes(needle)) {
      firstHit = e;
      break;
    }
  }
  if (isNegative) {
    if (firstHit) return verdict(claim.id, 'violated', 'predicate-not-matched', [pointer(firstHit)]);
    return verdict(claim.id, 'satisfied', 'predicate-matched');
  }
  if (firstHit) return verdict(claim.id, 'satisfied', 'predicate-matched', [pointer(firstHit)]);
  return verdict(claim.id, 'unverifiable', 'absent-signal');
}

// ─── tool-names (command-run) ────────────────────────────────────────────────────────────
/** `ToolEvent.name` membership. A name absent on this harness → `codex-blind`. */
function evalToolNames(
  claim: MandateClaim,
  predicate: ClaimPredicate,
  session: NormalizedSession,
  scopedEvents: SessionEvent[],
): ComplianceVerdict {
  // FI-17 — matcher totality: a matcher this arm can't mechanically compare → unverifiable.
  if (!isComparableMatcher(predicate.matcher)) {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  const needle = String(predicate.value ?? '');
  const isNegative = NEGATIVE_MATCHERS.has(predicate.matcher);
  const hit = scopedEvents.find((e) => e.type === 'tool' && matchStr(e.name, predicate.matcher, needle));
  if (isNegative) {
    if (hit) return verdict(claim.id, 'violated', 'predicate-not-matched', [pointer(hit)]);
    return verdict(claim.id, 'satisfied', 'predicate-matched');
  }
  if (hit) return verdict(claim.id, 'satisfied', 'predicate-matched', [pointer(hit)]);
  if (codexBlindable(session)) return verdict(claim.id, 'unverifiable', 'codex-blind');
  return verdict(claim.id, 'unverifiable', 'absent-signal');
}

// ─── command-content (command-run) — the FORBIDDEN-command direction ─────────────────────
// `commandStringOf` (the shell-command-string extractor) moved to the shared `derive.ts` home
// (next to `COMMAND_TOOLS`) and is now EXPORTED (S3) — the M2 git-ops projection reuses it.

/**
 * The `command-content` evaluator — the narrowly-implemented `command-run` transcript check.
 * Matches against a shell tool's `input.command` STRING. The Anatomia adapter emits it ONLY in
 * the FORBIDDEN-command (negative-matcher) direction — "AnaVerify must not rebase/force-push the
 * code branch" — so this mirrors {@link evalForbiddenEdit}'s honesty discipline:
 *  - a NEGATIVE matcher (`not_contains`/`not_equals`) is the supported shape: ANY shell command
 *    whose string matches the forbidden value → `violated`/`predicate-not-matched` with pointer
 *    evidence; none match → `satisfied`/`predicate-matched` (the agent never ran it).
 *  - a POSITIVE `contains`/`equals` ("the agent ran X") is supported too: a hit → satisfied,
 *    absent → `unverifiable`/`absent-signal` (you can't prove a command WASN'T needed), Codex →
 *    `codex-blind` only when no shell tool exists.
 *  - a non-comparable matcher (`matches`/`gte`/`lte`) → `unverifiable`/`content-unresolvable`
 *    (FI-17 totality — never a silent verdict).
 * NOT codex-blind for the negative direction: Codex emits `exec_command`, so the forbidden-command
 * check is cross-harness real.
 */
function evalCommandContent(
  claim: MandateClaim,
  predicate: ClaimPredicate,
  session: NormalizedSession,
  scopedEvents: SessionEvent[],
): ComplianceVerdict {
  // FI-17 — matcher totality: only the string-comparable matchers are mechanically applicable.
  if (!isComparableMatcher(predicate.matcher)) {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  const needle = String(predicate.value ?? '');
  const isNegative = NEGATIVE_MATCHERS.has(predicate.matcher);
  // 0a — the THREE-TIER quote-aware classifier replaces the literal `.includes` (which false-VIOLATEd
  // a needle in a non-executed position like `echo "git push --force"`). Per event: 'match' (the needle
  // IS the executed command), 'no-match' (provably not executed), 'unresolvable' (obfuscation defeats a
  // static surface). The invariant: ambiguity can only be 'match'/'unresolvable', never 'no-match'.
  const hits: SessionEvent[] = [];
  const unresolved: SessionEvent[] = [];
  for (const e of scopedEvents) {
    const cmd = commandStringOf(e);
    if (!cmd) continue;
    const tier = commandTier(cmd, predicate.matcher, needle);
    if (tier === 'match') hits.push(e);
    else if (tier === 'unresolvable') unresolved.push(e);
  }
  if (isNegative) {
    // "must NOT run X": a matching command is a VIOLATION (worst-wins — a proven hit overrides abstain).
    if (hits.length > 0) return negate(claim.id, true, hits.map(pointer));
    // An obfuscated command whose executed surface we couldn't resolve: we cannot prove the forbidden
    // command was NOT run — abstain with the precise reason, never report false-clean.
    if (unresolved.length > 0) {
      return verdict(claim.id, 'unverifiable', 'command-unresolvable', unresolved.map(pointer));
    }
    // Canary: an unreadable command-tool event (shape drift we couldn't parse) — same honesty rule.
    if (scopedEvents.some(isUnreadableCommandEvent)) {
      return verdict(claim.id, 'unverifiable', 'content-unresolvable');
    }
    return negate(claim.id, false);
  }
  // Positive ("ran X"): a hit is satisfaction; absence is unprovable, never a violation.
  if (hits.length > 0) {
    return verdict(claim.id, 'satisfied', 'predicate-matched', hits.map(pointer));
  }
  // An obfuscated command that COULD be X but we couldn't resolve → can't confirm it ran.
  if (unresolved.length > 0) {
    return verdict(claim.id, 'unverifiable', 'command-unresolvable', unresolved.map(pointer));
  }
  // Only blind when the harness has no shell-tool primitive at all.
  const hasShell = session.events.some((e) => e.type === 'tool' && (e.name === 'Bash' || e.name === 'exec_command'));
  if (!hasShell && codexBlindable(session)) return verdict(claim.id, 'unverifiable', 'codex-blind');
  return verdict(claim.id, 'unverifiable', 'absent-signal');
}

// ─── file-content (contract-matcher) ─────────────────────────────────────────────────────
/**
 * `scope:'runtime'` is already pre-checked (→ runtime-scoped). `scope:'transcript'` → read
 * via the (FI-13-faithful) `ContentResolver`; `null`/no resolver → `content-unresolvable`.
 */
function evalFileContent(
  claim: MandateClaim,
  predicate: ClaimPredicate,
  resolver: AnyResolver | undefined,
): ComplianceVerdict {
  if (!resolver) return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  // FI-17 — matcher totality: a matcher this arm can't mechanically compare → unverifiable.
  if (!isComparableMatcher(predicate.matcher)) {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  const path = sourcePath(claim);
  if (!path) return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  const bytes = resolver(path);
  if (bytes === null || bytes === undefined) {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  const text = new TextDecoder().decode(bytes);
  const needle = String(predicate.value ?? '');
  const isNegative = NEGATIVE_MATCHERS.has(predicate.matcher);
  const matched = matchStr(text, predicate.matcher, needle);
  // Negative ("must not contain X"): a match on the forbidden content IS the violation — the
  // shared pinned mapping. (Prior bug: this branch was byte-identical to the positive one, so
  // `not_contains "x"` on a file that DOES contain x falsely returned `satisfied`.)
  if (isNegative) return negate(claim.id, matched);
  // Positive ("must contain X"): a match satisfies; absence is a provable violation here (the arm
  // can read the file, so a missing required substring is not `unverifiable`).
  return matched
    ? verdict(claim.id, 'satisfied', 'predicate-matched')
    : verdict(claim.id, 'violated', 'predicate-not-matched');
}

/** The cross-artifact / in-blob path the claim's source references. */
function sourcePath(claim: MandateClaim): string | undefined {
  const src = claim.source;
  if (src.kind === 'cross-artifact') return src.path;
  if (src.kind === 'in-blob') return src.blob;
  return undefined;
}

// ─── edit-paths (file-scope) — the SET rule (D1-FILESCOPE, DECISIONS A+B) ─────────────────
/** A sink for the MASS file-scope `Finding` (DECISION B). Verdicts never carry it. */
export interface FileScopeFindingSink {
  push(finding: { ruleId: string; message: string; source: string; count: number }): void;
}

/**
 * The SET rule (Spike A: per-path `contains` flags 0/202; only the whitelist-union works).
 * Group all `kind:'file-scope'` claims with the SAME `source` into a whitelist union; flag
 * edited SOURCE paths ∉ union. NARROW (1–3 undeclared source) → `violated`. MASS (≥4) →
 * a non-gating `info` `compliance/contract-under-specified` Finding (NOT a verdict — DECISION B).
 * Sibling test of an in-contract source → not flagged (the classifier licenses it).
 * Empty out-of-union set → `satisfied(predicate-matched)` (vacuously "stays within X").
 */
function evalEditPaths(
  claim: MandateClaim,
  session: NormalizedSession,
  sink: FileScopeFindingSink | undefined,
  repoRoot = '',
): ComplianceVerdict {
  // BLACKLIST direction: a `not_contains`/`not_equals` edit-paths claim ("don't touch X") is a
  // FORBIDDEN-set obligation, NOT a whitelist. It must be evaluated by the dedicated blacklist
  // evaluator (modelled on evalReadPaths), NEVER routed through the whitelist fileScopeVerdict
  // (whose absolute-path `continue` net silently PASSES in the blacklist direction — the
  // inversion trap). matcher is read off the predicate (pre-checked non-null by the caller).
  if (claim.predicate && NEGATIVE_MATCHERS.has(claim.predicate.matcher)) {
    return evalForbiddenEdit(claim, claim.predicate, session, repoRoot);
  }
  // FI-17 totality (whitelist arm): file-scope SET membership is expressed ONLY by `contains`.
  // Any other positive matcher on edit-paths is not mechanically applicable here → honest
  // `unverifiable` (consistent with the read-paths/tool-names/file-content/forbidden-edit arms),
  // NEVER a silent coercion to SET semantics. No reference adapter emits non-`contains` on
  // edit-paths; the file-scope SET *batch* in verdictsForMandate is matcher-independent by design.
  if (claim.predicate && claim.predicate.matcher !== 'contains') {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  // Standalone (single-claim) path: the whitelist is this claim's own value. The SET UNION
  // over same-`source` claims is assembled by {@link verdictsForMandate}, which knows the
  // full mandate and routes file-scope claims directly to {@link fileScopeVerdict}.
  const whitelist = new Set<string>();
  const ownValue = String(claim.predicate?.value ?? '');
  // Normalize the contract path with the SAME root as the edits, so both sides match (step-1
  // relativization now actually runs when a real root is plumbed).
  if (ownValue) whitelist.add(normalizeEditPath(ownValue, repoRoot));
  return fileScopeVerdict(
    claim.id,
    whitelist,
    session,
    sink,
    sourceLabelOf(claim),
    repoRoot,
    claim.deviationHandling,
  );
}

/**
 * The BLACKLIST edit-paths evaluator (the forbidden-set / "don't touch X" direction). Modelled
 * on {@link evalReadPaths} (the correct blacklist evaluator) but over EDIT events. Reaching here
 * means the matcher is `not_contains`/`not_equals` (a NEGATIVE matcher). Honesty rules:
 *  - the FORBIDDEN VALUE itself non-comparable (still absolute after normalization) →
 *    `unverifiable`/`content-unresolvable` (NEVER the whitelist's silent-pass `continue` net);
 *  - an individual edit path non-comparable (still absolute) while the forbidden value IS
 *    comparable → excluded from the hit set (no false-accuse);
 *  - any comparable edit path that matches the forbidden value (positive form: `not_contains`→
 *    substring, `not_equals`→exact) → `violated`/`predicate-not-matched` with pointer evidence;
 *  - none match → `satisfied`/`predicate-matched`.
 * NOT routed through `fileScopeVerdict`: no test/collateral classifier skip, no MASS/NARROW count
 * logic (whitelist-only) — ANY edit to the forbidden path is a violation regardless of class.
 * NOT codex-blind: Codex emits EditEvents (`patch_apply_end`), so this is cross-harness real.
 */
function evalForbiddenEdit(
  claim: MandateClaim,
  predicate: ClaimPredicate,
  session: NormalizedSession,
  repoRoot = '',
): ComplianceVerdict {
  // FI-17 — only `not_contains`/`not_equals` are mechanically comparable here; any other
  // negative-shaped matcher (none exist today, but reserve-broadly) → unverifiable.
  if (predicate.matcher !== 'not_contains' && predicate.matcher !== 'not_equals') {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  const forbidden = normalizeEditPath(String(predicate.value ?? ''), repoRoot);
  // The forbidden VALUE itself is non-comparable (still absolute → the root was unknown/wrong):
  // we cannot honestly compare against repo-relative edit paths → unverifiable. Do NOT silently
  // pass (the inversion trap that the whitelist's absolute-`continue` would spring here).
  if (!forbidden || forbidden.startsWith('/')) {
    return verdict(claim.id, 'unverifiable', 'content-unresolvable');
  }
  const isExact = predicate.matcher === 'not_equals';
  const hits: SessionEvent[] = [];
  for (const e of session.events) {
    if (e.type !== 'edit') continue;
    // Renames → check the destination (paths[1]); else the single edited path.
    const raw = e.op === 'rename' ? e.paths[1] ?? e.paths[0] : e.paths[0];
    if (!raw) continue;
    const norm = normalizeEditPath(raw, repoRoot);
    if (!norm) continue;
    // A non-comparable edit path (still absolute) while the forbidden value IS comparable →
    // exclude from the hit set (never false-accuse).
    if (norm.startsWith('/')) continue;
    // POSITIVE form of the obligation: not_contains → substring; not_equals → exact.
    const matched = isExact ? norm === forbidden : norm.includes(forbidden);
    if (matched) hits.push(e);
  }
  if (hits.length > 0) {
    return verdict(claim.id, 'violated', 'predicate-not-matched', hits.map(pointer));
  }
  return verdict(claim.id, 'satisfied', 'predicate-matched');
}

/** Stable key grouping file-scope claims by their `source` (the whitelist boundary). */
function claimSourceKey(claim: MandateClaim): string {
  const s = claim.source;
  if (s.kind === 'cross-artifact') return `xa:${s.workItemSlug}:${s.path}`;
  return `ib:${s.blob}`;
}

function claimBatchKey(claim: MandateClaim): string {
  return `${claimSourceKey(claim)}:target:${claim.predicate?.target ?? 'none'}:deviation:${claim.deviationHandling ?? 'adaptive'}:subject:${JSON.stringify(claim.subject ?? null)}`;
}

/**
 * The shared file-scope verdict body, given a resolved whitelist UNION. Used by
 * `verdictsForMandate` (which batches same-source claims into one union). `repoRoot` is the
 * plumbed project root that makes `normalizeEditPath`'s step-1 (relativize an absolute path)
 * actually run; absent (`''`) ⇒ the worktree-strip path only (prior behavior).
 */
export function fileScopeVerdict(
  claimId: string,
  whitelist: Set<string>,
  session: NormalizedSession,
  sink: FileScopeFindingSink | undefined,
  sourceLabel = '',
  repoRoot = '',
  deviationHandling: 'adaptive' | 'strict' = 'adaptive',
): ComplianceVerdict {
  const root = repoRoot;
  const undeclaredSource: { path: string; ev: SessionEvent }[] = [];
  const seen = new Set<string>();
  for (const e of session.events) {
    if (e.type !== 'edit') continue;
    // Renames → check destination (paths[1]); else the single edited path.
    const raw = e.op === 'rename' ? e.paths[1] ?? e.paths[0] : e.paths[0];
    if (!raw) continue;
    const norm = normalizeEditPath(raw, root);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    if (whitelist.has(norm)) continue;
    // BRAND SAFETY NET — NEVER false-accuse: a path that is STILL absolute after normalization
    // (the root was unknown or didn't match, so it could NOT be made repo-relative) is NOT
    // comparable against the repo-relative whitelist. Exclude it from the violation set — a
    // non-comparable path must never produce a `violated`. A missing/wrong root thus degrades
    // to no-false-accuse, not a false violation.
    if (norm.startsWith('/')) continue;
    const cls: PathClass = classifyEditPath(norm);
    if (cls === 'collateral') continue; // ignored
    if (cls === 'test') continue; // licensed sibling — not a violation
    undeclaredSource.push({ path: norm, ev: e });
  }
  const n = undeclaredSource.length;
  if (n === 0) {
    // Empty out-of-union source set → vacuously "stays within X".
    return verdict(claimId, 'satisfied', 'predicate-matched');
  }
  if (n >= 4 && deviationHandling === 'adaptive') {
    // MASS → a non-gating info Finding (DECISION B), NOT a verdict/unverifiable.
    sink?.push({
      ruleId: 'compliance/contract-under-specified',
      message: `${n} source files edited outside the declared file-scope (contract likely under-specified for a large rewrite).`,
      source: sourceLabel,
      count: n,
    });
    // The claim itself is still satisfied as a verdict-channel statement: the deviation is
    // surfaced as an observation, not a per-claim violation (DECISION B — honest home).
    return verdict(claimId, 'satisfied', 'predicate-matched');
  }
  // NARROW (1–3) → violated.
  return verdict(
    claimId,
    'violated',
    'predicate-not-matched',
    undeclaredSource.map((u) => pointer(u.ev)),
  );
}

// ─── window resolver ─────────────────────────────────────────────────────────────────────
/**
 * Open the window on the STRUCTURED event matching `opensOn`, NEVER a text scan (Spike C: 7
 * `tool_result` announce-echoes vs 0 live announces). Filter-then-window by the resolved subject
 * (concurrency-correct). Close on the next opening event on the same lane, else rest-of-session.
 * Returns the windowed slice, or `null` when the open is unresolvable on this harness/timeline.
 */
function resolveWindow(
  opensOn: WindowOpensOn,
  agent: AgentRef,
  events: SessionEvent[],
): SessionEvent[] | null {
  // Filter FIRST to the scope's events (concurrency-correct), THEN bound.
  const lane = events.filter((e) => sameAgentRef(e.agent, agent));
  const opens = (e: SessionEvent): boolean => {
    switch (opensOn) {
      case 'skill-invoked':
        return e.type === 'skill' && (e.source ?? 'tool') === 'tool';
      case 'skill-announced':
        return e.type === 'skill' && e.source === 'announce-text';
      case 'dispatch':
        return e.type === 'tool' && e.name === 'Agent';
      case 'command':
        return e.type === 'command';
      default:
        return false;
    }
  };
  const openIdx = lane.findIndex(opens);
  if (openIdx === -1) return null; // structured open absent on this harness/lane → unresolvable
  // Close on the NEXT open event on the same lane, else rest-of-session.
  let closeIdx = lane.length;
  for (let i = openIdx + 1; i < lane.length; i++) {
    const ev = lane[i];
    if (ev && opens(ev)) {
      closeIdx = i;
      break;
    }
  }
  return lane.slice(openIdx, closeIdx);
}


// ─── matchers ────────────────────────────────────────────────────────────────────────────
/**
 * 0a — the command-content tier for ONE command string. `exists` keeps the trivial "any command ran"
 * semantics; the substring (`contains`/`not_contains`) and exact (`equals`/`not_equals`) matchers route
 * through the quote-aware {@link classifyCommandMatch} so a needle in a non-executed position resolves
 * 'no-match' and an obfuscated one resolves 'unresolvable' — NEVER a literal-`.includes` false hit.
 */
function commandTier(cmd: string, matcher: string, needle: string): 'match' | 'no-match' | 'unresolvable' {
  if (matcher === 'exists') return cmd.length > 0 ? 'match' : 'no-match';
  const exact = matcher === 'equals' || matcher === 'not_equals';
  return classifyCommandMatch(cmd, needle, exact);
}

function matchStr(haystack: string, matcher: string, needle: string): boolean {
  switch (matcher) {
    case 'contains':
    case 'not_contains':
      return haystack.includes(needle);
    case 'equals':
    case 'not_equals':
      return haystack === needle;
    case 'exists':
      return haystack.length > 0;
    default:
      return false;
  }
}

// ─── the mandate-level entry point ───────────────────────────────────────────────────────
/**
 * One verdict per claim, claim order PRESERVED → `verdicts.length === claims.length` (the
 * pinned invariant that reconciles with the C coverage stat). Takes NO judge parameter.
 *
 * Batches same-`source` `file-scope` claims into ONE whitelist UNION (the SET rule), so a
 * per-path `contains` claim set resolves to the union verdict (Spike A). The MASS Finding is
 * collected into `findingsOut` (DECISION B) — verdicts never carry it.
 */
export function verdictsForMandate(
  mandate: Mandate,
  session: NormalizedSession,
  resolver?: AnyResolver,
  findingsOut?: { ruleId: string; message: string; source: string; count: number }[],
  repoRoot = '',
  context?: MandateEvaluationContext,
  coverageOut?: ClaimChannelCoverage[],
): ComplianceVerdict[] {
  const sink: FileScopeFindingSink | undefined = findingsOut
    ? { push: (f) => findingsOut.push(f) }
    : undefined;

  // Build the file-scope whitelist UNIONS, keyed by source, across all file-scope claims.
  // Normalize the contract paths with the SAME root as the edits so both sides match.
  const root = repoRoot;
  const editUnionBySource = new Map<string, Set<string>>();
  const readUnionBySource = new Map<string, Set<string>>();
  for (const c of mandate.claims) {
    if (c.kind !== 'file-scope' || !c.predicate) continue;
    if (c.predicate.target !== 'edit-paths' && c.predicate.target !== 'read-paths') continue;
    // A NEGATIVE-matcher (`not_contains`/`not_equals`) edit-paths claim is a BLACKLIST, NOT a
    // whitelist member — adding it to the allow-list union would poison it (the forbidden path
    // would become the only ALLOWED path). It is evaluated standalone by evalForbiddenEdit.
    if (NEGATIVE_MATCHERS.has(c.predicate.matcher)) continue;
    const key = claimBatchKey(c);
    const unions =
      c.predicate.target === 'edit-paths' ? editUnionBySource : readUnionBySource;
    let set = unions.get(key);
    if (!set) {
      set = new Set<string>();
      unions.set(key, set);
    }
    const v = String(c.predicate.value ?? '');
    if (v) set.add(normalizeEditPath(v, root));
  }

  // To avoid emitting the MASS Finding once per same-source claim, track which source keys
  // have already produced a file-scope verdict batch.
  const fileScopeEmitted = new Set<string>();

  const out: ComplianceVerdict[] = [];
  for (const claim of mandate.claims) {
    const channelCoverage = claimChannelCoverage(claim, session, context);
    coverageOut?.push(channelCoverage);
    if (
      claim.kind === 'file-scope' &&
      claim.predicate &&
      (claim.predicate.target === 'edit-paths' || claim.predicate.target === 'read-paths') &&
      !NEGATIVE_MATCHERS.has(claim.predicate.matcher) && // blacklist → evalForbiddenEdit, not the union
      claim.confidence !== 'low' &&
      claim.predicate.scope !== 'runtime' &&
      claim.scope.kind === 'whole-session'
    ) {
      // P0.6 — the batch path must honor the SAME catastrophic version floor as verdictForClaim. The
      // `continue` at the end of this branch skips the verdictForClaim fallback that applies it, so
      // without this an out-of-major-drifted transcript would yield a CONFIDENT file-scope verdict
      // (a cardinal-sin false-PASS / false-accuse) while --last prints "verdicts are unverifiable".
      // Placed first, before subject resolution and the absence gate (mirrors pre-check 3.5).
      if (harnessVersionStatus(session.harness, session.observedVersions) === 'out-of-range') {
        out.push(verdict(claim.id, 'unverifiable', 'harness-version-unrecognized'));
        continue;
      }
      const key = claimBatchKey(claim);
      const whitelist =
        (claim.predicate.target === 'edit-paths'
          ? editUnionBySource.get(key)
          : readUnionBySource.get(key)) ?? new Set<string>();
      // Emit the MASS Finding only on the FIRST claim of a same-source batch.
      const localSink = fileScopeEmitted.has(key) ? undefined : sink;
      fileScopeEmitted.add(key);
      const subject = resolveSubject(claim, session, context);
      if (!subject) {
        out.push(verdict(claim.id, 'unverifiable', 'subject-unresolvable'));
        continue;
      }
      const scopedSession = { ...session, events: subject.events };
      const result =
        claim.predicate.target === 'edit-paths'
          ? fileScopeVerdict(
              claim.id,
              whitelist,
              scopedSession,
              localSink,
              sourceLabelOf(claim),
              root,
              claim.deviationHandling,
            )
          : readScopeVerdict(claim.id, whitelist, scopedSession, root);
      // A satisfied file-scope verdict is absence-based (no out-of-scope path seen), so it runs the
      // SAME shared absence gate — incl. the parse-suspect check (a misparse can't prove "stayed in scope").
      const gated = absenceGate(
        claim.id,
        result.status === 'satisfied',
        session,
        channelCoverage.gaps.length,
        subject.delegateComplete,
      );
      out.push(gated ?? result);
      continue;
    }
    out.push(verdictForClaim(claim, session, resolver, sink, repoRoot, context));
  }
  return out;
}

function claimChannelCoverage(
  claim: MandateClaim,
  session: NormalizedSession,
  context: MandateEvaluationContext | undefined,
): ClaimChannelCoverage {
  const subject = resolveSubject(claim, session, context);
  if (!subject) return incompleteChannelCoverageForClaim(claim, 'subject-unresolvable');
  let events = subject.events;
  if (claim.scope.kind === 'event-triggered-window') {
    if (subject.agents.length !== 1) {
      return incompleteChannelCoverageForClaim(claim, 'window-unresolvable');
    }
    const agent = subject.agents[0];
    if (!agent) return incompleteChannelCoverageForClaim(claim, 'window-unresolvable');
    const window = resolveWindow(claim.scope.opensOn, agent, subject.events);
    if (!window) return incompleteChannelCoverageForClaim(claim, 'window-unresolvable');
    events = window;
  } else if (claim.scope.kind === 'cross-session') {
    return incompleteChannelCoverageForClaim(claim, 'window-unresolvable');
  }
  return channelCoverageForClaim(claim, events);
}

function sourceLabelOf(claim: MandateClaim): string {
  const s = claim.source;
  if (s.kind === 'cross-artifact') return s.workItemSlug;
  return s.blob;
}

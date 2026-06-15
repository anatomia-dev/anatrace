/**
 * N3 — coverage gaps → remediation (step 1 of the capture loop). Turns each typed abstention into a
 * ranked, named CAPTURE ACTION: the precise thing that would let anatrace answer next time. Keyed off
 * ALL THREE gap vocabularies — the per-claim `VerdictReason`, the `LineageGapReason`, and the
 * `ChannelCoverageGapReason` — each partitioned:
 *
 *  - **capture-closable** — a specific capture / binding / artifact would close it (a child transcript,
 *    a trusted-launcher manifest, a subject binding, a window, a parseable record). These are the rungs
 *    of the capture loop: supply them and coverage climbs.
 *  - **intrinsic** — the honest IRREDUCIBLE FLOOR: no capture closes it (an intent obligation routed to
 *    a judge, a runtime-scoped predicate a post-hoc transcript can't see, a Codex-blind channel, an
 *    obfuscated command, a degraded parse). Naming both is what stops the loop reading as "tops out."
 *
 * Pure: no fs / clock / network. The table is EXHAUSTIVE over the three enums (a reachability test pins
 * that every member has an entry, so a new enum member can't ship without its remediation).
 */
import type { VerdictReason } from './verdict.js';
import type { LineageGapReason } from './lineage.js';
import type { ChannelCoverageGapReason } from './channels.js';
import type { Report } from './report.js';

export type RemediationKind = 'capture-closable' | 'intrinsic';

export interface Remediation {
  kind: RemediationKind;
  /** The named capture/binding that closes it (capture-closable), or why it is irreducible (intrinsic). */
  action: string;
}

/** Verdict-reason remediation. Only the abstaining reasons appear; `predicate-matched`/`-not-matched` resolve. */
const VERDICT_REMEDIATION: Record<VerdictReason, Remediation> = {
  'predicate-matched': { kind: 'intrinsic', action: 'resolved (satisfied) — no gap' },
  'predicate-not-matched': { kind: 'intrinsic', action: 'resolved (violated) — no gap' },
  'routed-to-llm': { kind: 'intrinsic', action: 'an intent obligation with no mechanical predicate; only an opt-in judge over the residue can opine, and it never gates' },
  'runtime-scoped': { kind: 'intrinsic', action: 'a runtime-scoped predicate a post-hoc transcript cannot observe' },
  'low-confidence': { kind: 'intrinsic', action: 'a low-confidence (nested/overlapping window) dispatch the matcher will not gamble on' },
  'absent-signal': { kind: 'intrinsic', action: 'the required positive signal never appeared; capturing more cannot make an absent event present' },
  'content-unresolvable': { kind: 'capture-closable', action: 'supply the referenced file content (the resolver returned null / a non-comparable matcher)' },
  'command-unresolvable': { kind: 'intrinsic', action: 'the executed command is obfuscated (eval / expansion / pipe-to-shell / wrapper); no capture resolves it statically' },
  'codex-blind': { kind: 'intrinsic', action: 'a Claude-only signal on a Codex transcript; the channel does not exist there' },
  'subject-unresolvable': { kind: 'capture-closable', action: 'bind the policy subject (--role <name>, or a this-agent binding)' },
  'delegate-coverage-incomplete': { kind: 'capture-closable', action: 'supply a trusted-launcher capture manifest plus the delegate transcripts' },
  'channel-coverage-incomplete': { kind: 'capture-closable', action: 'capture/classify the named tool or command channel (see the channel-gap detail)' },
  'window-unresolvable': { kind: 'capture-closable', action: 'provide the event-triggered window bounds' },
  'harness-version-unrecognized': { kind: 'intrinsic', action: 'the harness major version is outside the supported floor; verdicts over it are unverifiable by design' },
  'session-parse-suspect': { kind: 'intrinsic', action: 'the transcript parsed as degraded (zero structured events from non-empty input); the bytes are suspect' },
};

const LINEAGE_REMEDIATION: Record<LineageGapReason, Remediation> = {
  'delegate-call-without-child-transcript': { kind: 'capture-closable', action: 'capture the spawned sub-agent transcript' },
  'child-transcript-without-metadata': { kind: 'capture-closable', action: 'supply the launch metadata linking the child transcript' },
  'metadata-without-child-transcript': { kind: 'capture-closable', action: 'capture the child transcript the metadata references' },
  'child-transcript-metadata-mismatch': { kind: 'capture-closable', action: 'reconcile the child transcript with its launch metadata (id mismatch)' },
  'dispatch-link-missing': { kind: 'capture-closable', action: 'supply the dispatch link (the toolUseId connecting parent → child)' },
  'dispatch-link-mismatch': { kind: 'capture-closable', action: 'reconcile the dispatch link (toolUseId mismatch)' },
  'harness-lineage-unsupported': { kind: 'intrinsic', action: 'this harness does not record delegation lineage; no capture closes it here' },
  'codex-subagent-storage-unknown': { kind: 'intrinsic', action: 'Codex sub-agent transcript storage is unknown; not capturable today' },
  'delegate-transcript-unreadable': { kind: 'capture-closable', action: 'the child transcript was found but unreadable; supply a readable copy' },
  'launch-record-expected-but-unobserved': { kind: 'capture-closable', action: 'a launch record expected a delegate that was not observed; capture its transcript' },
  'duplicate-child-session-id': { kind: 'capture-closable', action: 'two children share a session id; disambiguate the capture' },
};

const CHANNEL_REMEDIATION: Record<ChannelCoverageGapReason, Remediation> = {
  'unknown-tool': { kind: 'capture-closable', action: 'an unrecognized tool; add it to the adapter (or classify it)' },
  'unsupported-shell-command': { kind: 'capture-closable', action: 'an unsupported shell-command shape; extend the command classifier' },
  'ambiguous-read-tool': { kind: 'capture-closable', action: 'an ambiguous read tool; disambiguate its read semantics' },
  'unparseable-tool-input': { kind: 'capture-closable', action: 'the tool input could not be parsed; supply a parseable record' },
  'subject-unresolvable': { kind: 'capture-closable', action: 'bind the policy subject (--role <name>)' },
  'window-unresolvable': { kind: 'capture-closable', action: 'provide the event-triggered window bounds' },
};

/** One ranked capture action derived from a typed gap. */
export interface CaptureAction {
  source: 'verdict' | 'lineage-gap' | 'channel-gap';
  reason: string;
  kind: RemediationKind;
  action: string;
  /** the claim this gap blocked (verdict / channel sources), when known. */
  claimId?: string;
}

/** Look up the remediation for any of the three gap vocabularies (exhaustive — see the reachability test). */
export function remediationFor(
  source: CaptureAction['source'],
  reason: VerdictReason | LineageGapReason | ChannelCoverageGapReason,
): Remediation {
  if (source === 'verdict') return VERDICT_REMEDIATION[reason as VerdictReason];
  if (source === 'lineage-gap') return LINEAGE_REMEDIATION[reason as LineageGapReason];
  return CHANNEL_REMEDIATION[reason as ChannelCoverageGapReason];
}

/**
 * Derive the ranked capture actions for a report: every typed abstention → its remediation, deduped,
 * **capture-closable first** (the actionable rungs), then the intrinsic floor. The single-run coverage
 * rate is the engine's `verificationCoverage` — this layer is the "and here is what would close each gap."
 */
export function captureActionsFor(report: Report): CaptureAction[] {
  const out: CaptureAction[] = [];
  const seen = new Set<string>();
  const add = (a: CaptureAction): void => {
    const key = `${a.source}:${a.reason}:${a.claimId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };

  for (const v of report.compliance ?? []) {
    if (v.status !== 'unverifiable') continue;
    const r = VERDICT_REMEDIATION[v.reason];
    add({ source: 'verdict', reason: v.reason, kind: r.kind, action: r.action, claimId: v.claimId });
  }
  for (const gap of report.lineage?.gaps ?? []) {
    const r = LINEAGE_REMEDIATION[gap.reason];
    add({ source: 'lineage-gap', reason: gap.reason, kind: r.kind, action: r.action });
  }
  for (const claim of report.verificationCoverage?.claims ?? []) {
    for (const gap of claim.gaps) {
      const r = CHANNEL_REMEDIATION[gap.reason];
      add({ source: 'channel-gap', reason: gap.reason, kind: r.kind, action: r.action, claimId: claim.claimId });
    }
  }

  // capture-closable first (the rungs of the loop), then the honest irreducible floor.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'capture-closable' ? -1 : 1));
}

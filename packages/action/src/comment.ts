/**
 * N7 — the sticky PR comment. It LEADS with what anatrace could NOT verify (the unverifiables, by
 * reason, with their capture actions) — a gate that publishes its OWN blind spots is the opposite of
 * the green check that hides them. Then the violations, framed by the gate-vs-detector distinction:
 *
 *  - **gate** — artifact-integrity properties (stayed-in-scope, didn't-edit-the-tests). The harm is in
 *    the diff, so blocking the merge is the right and sufficient response. These BLOCK.
 *  - **detector** — a side-effect that already happened (read a secret / egressed). Blocking the merge
 *    doesn't un-read the secret; the response is revoke / incident. These are SURFACED, not merge-gated.
 *
 * Pure: a Report (+ which claims are detector-class) → markdown. No network, no GitHub API.
 */
import { captureActionsFor } from 'anatrace-core';
import type { Report, ComplianceVerdict } from 'anatrace-core';

/** Stable marker so the comment is STICKY (find-and-update, never a new comment per run). */
export const COMMENT_MARKER = '<!-- anatrace-verdict -->';

function byReason(verdicts: ComplianceVerdict[]): Array<{ reason: string; ids: string[] }> {
  const map = new Map<string, string[]>();
  for (const v of verdicts) (map.get(v.reason) ?? map.set(v.reason, []).get(v.reason)!).push(v.claimId);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([reason, ids]) => ({ reason, ids }));
}

/**
 * Build the sticky comment markdown. `detectorClaims` is the set of claimIds whose obligation is a
 * forensic detector (reads / egress) rather than an artifact-integrity gate — surfaced, never pitched
 * as the merge-block.
 */
export function buildPrComment(report: Report, detectorClaims: Set<string> = new Set()): string {
  const c = report.compliance ?? [];
  const violated = c.filter((v) => v.status === 'violated');
  const unverifiable = c.filter((v) => v.status === 'unverifiable');
  const satisfied = c.filter((v) => v.status === 'satisfied');
  const gateViolations = violated.filter((v) => !detectorClaims.has(v.claimId));
  const detected = violated.filter((v) => detectorClaims.has(v.claimId));

  const headline = gateViolations.length > 0
    ? `### ⛔ anatrace — ${gateViolations.length} obligation${gateViolations.length === 1 ? '' : 's'} breached (merge gate)`
    : unverifiable.length > 0
      ? `### ⚠️ anatrace — verdict not clean: ${unverifiable.length} unverifiable`
      : `### ✅ anatrace — all ${satisfied.length} obligations verified`;

  const lines: string[] = [COMMENT_MARKER, headline, ''];

  // LEAD with the blind spots — the gate publishes what it could not prove.
  if (unverifiable.length > 0) {
    lines.push(`**⚠️ Could not verify (${unverifiable.length})** — surfaced honestly, not gated (an "I couldn't tell" never blocks a merge):`);
    for (const { reason, ids } of byReason(unverifiable)) lines.push(`- \`${reason}\` — ${ids.join(', ')}`);
    const actions = captureActionsFor(report).filter((a) => a.kind === 'capture-closable');
    if (actions.length > 0) {
      lines.push('', '<details><summary>How to close these gaps (capture actions)</summary>', '');
      for (const a of actions) lines.push(`- \`${a.reason}\`${a.claimId ? ` (${a.claimId})` : ''} → ${a.action}`);
      lines.push('</details>');
    }
    lines.push('');
  }

  if (gateViolations.length > 0) {
    lines.push(`**⛔ Blocked the merge (${gateViolations.length})** — artifact-integrity violations (the harm is in the diff):`);
    for (const v of gateViolations) lines.push(`- \`${v.claimId}\` — violated (${v.reason})`);
    lines.push('');
  }
  if (detected.length > 0) {
    lines.push(`**🔍 Detected — review / revoke, NOT a merge gate (${detected.length})** — a side-effect already happened; blocking the merge can't undo it:`);
    for (const v of detected) lines.push(`- \`${v.claimId}\` — ${v.reason}`);
    lines.push('');
  }

  lines.push(`**Verified:** ${satisfied.length} satisfied · ${gateViolations.length} violated · ${detected.length} detected · ${unverifiable.length} unverifiable.`);
  lines.push('');
  lines.push('<sub>Deterministic, zero-LLM in the published verdict path — re-run anatrace on the same transcript for a byte-identical record. Unverifiables are surfaced here and in the JSON artifact (never in SARIF). [What is this?](https://github.com/anatomia-dev/anatrace)</sub>');
  return lines.join('\n');
}

import { computeCost, PRICES } from 'anatrace-core';
import type { Report, SkillInvocation } from 'anatrace-core';

/**
 * Render-time cost projection. NOTE: `computeCost` returns a `CostResult` whose field is
 * named `cost_usd`; this MUST NOT be serialized verbatim into `--json` (the no-baked-cost
 * contract + the done-state grep). We project it onto a differently-named, render-only key.
 */
function costProjection(report: Report): { usd: number; priced: boolean; priced_as_of: string } {
  const c = computeCost(report.session.counts.tokens, report.session.model, { priceTable: PRICES });
  return { usd: c.cost_usd, priced: c.priced, priced_as_of: c.price_table_version };
}

/** Render-only skills projection (B2). Like cost, skills are a render projection — NOT a `Report`/`ProvenanceCounts` field. */
function skillsLabel(skills: SkillInvocation[]): string {
  return skills
    .map((s) => (s.source === 'announce-text' ? `${s.skill} (announced?)` : s.skill))
    .join(', ');
}

function agentLabel(agent: { kind: 'root' } | { kind: 'subagent'; subagentId: string }): string {
  return agent.kind === 'root' ? 'root' : `subagent:${agent.subagentId}`;
}

/** JSON renderer: the stable `Report` envelope + render-only projections (cost; skills) — never `cost_usd`. */
export function renderJson(report: Report, skills: SkillInvocation[] = []): string {
  return JSON.stringify({ ...report, cost_estimate: costProjection(report), skills }, null, 2);
}

/** Human (TTY) renderer: provenance + cost (est., priced-as-of) + skills + friction. */
export function renderPretty(report: Report, skills: SkillInvocation[] = []): string {
  const { session, findings } = report;
  const t = session.counts.tokens;
  const cost = costProjection(report);
  const lines: string[] = [];
  lines.push(`anatrace — ${session.harness} · ${session.model || '(unknown model)'}`);
  if (session.observedVersions.length) lines.push(`  versions: ${session.observedVersions.join(', ')}`);
  lines.push(
    `  tokens: input ${t.input} · output ${t.output} · cache_create ${t.cache_create} · cache_read ${t.cache_read}`,
  );
  lines.push(
    `  turns ${session.counts.turns} · tool_calls ${session.counts.tool_calls} · commands ${session.counts.commands_run} · files ${session.counts.files_touched}`,
  );
  if (skills.length) lines.push(`  skills: ${skillsLabel(skills)}`);
  if (report.lineage) {
    const lineage = report.lineage;
    const delegatesChecked = lineage.checkedLanes.filter((agent) => agent.kind === 'subagent');
    const delegatesObserved = lineage.observedDelegates.length;
    const delegateLabel = delegatesChecked.length === 0
      ? 'no delegate lanes'
      : delegatesChecked.map(agentLabel).join(', ');
    lines.push(
      `  lineage: checked root + ${delegatesChecked.length} delegate lanes (${delegateLabel}); observed ${delegatesObserved} delegates; ${lineage.gaps.length} gaps; ${lineage.completeness}`,
    );
    for (const gap of lineage.gaps) {
      lines.push(`    lineage gap: ${gap.reason}${gap.agent ? `:${agentLabel(gap.agent)}` : ''}`);
    }
  }
  if (report.verificationCoverage) {
    const coverage = report.verificationCoverage;
    lines.push(
      `  coverage: checked ${coverage.fullyCheckedClaims} of ${coverage.totalClaims} claims`,
    );
    for (const claim of coverage.unverifiableClaims) {
      lines.push(`    ${claim.claimId}: unverifiable:${claim.reason}`);
    }
    for (const claim of coverage.claims) {
      if (claim.gaps.length === 0) continue;
      const gaps = claim.gaps
        .map((gap) => `${gap.channel}:${gap.reason}:${gap.source}`)
        .join(', ');
      lines.push(`    ${claim.claimId}: ${gaps}`);
    }
  }
  lines.push(
    cost.priced
      ? `  cost: ~$${cost.usd.toFixed(4)} (est. API-equivalent, priced as-of ${cost.priced_as_of})`
      : `  cost: n/a (model unpriced as-of ${cost.priced_as_of})`,
  );
  if (findings.length === 0) {
    lines.push('  friction: none');
  } else {
    lines.push(`  friction (${findings.length}):`);
    for (const f of findings) lines.push(`    [${f.severity}] ${f.ruleId} — ${f.message}`);
  }
  return lines.join('\n');
}

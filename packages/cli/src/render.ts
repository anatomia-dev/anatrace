import { computeCost, PRICES } from 'anatrace-core';
import type { Report } from 'anatrace-core';

/**
 * Render-time cost projection. NOTE: `computeCost` returns a `CostResult` whose field is
 * named `cost_usd`; this MUST NOT be serialized verbatim into `--json` (the no-baked-cost
 * contract + the done-state grep). We project it onto a differently-named, render-only key.
 */
function costProjection(report: Report): { usd: number; priced: boolean; priced_as_of: string } {
  const c = computeCost(report.session.counts.tokens, report.session.model, { priceTable: PRICES });
  return { usd: c.cost_usd, priced: c.priced, priced_as_of: c.price_table_version };
}

/** JSON renderer: the stable `Report` envelope + a render-only cost projection (never `cost_usd`). */
export function renderJson(report: Report): string {
  return JSON.stringify({ ...report, cost_estimate: costProjection(report) }, null, 2);
}

/** Human (TTY) renderer: provenance + cost (est., priced-as-of) + friction. */
export function renderPretty(report: Report): string {
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

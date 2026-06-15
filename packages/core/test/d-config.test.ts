import { describe, it, expect } from 'vitest';
import {
  checkIdForClaim,
  severityForVerdict,
  unknownComplianceKeys,
  complianceKey,
  COMPLIANCE_CHECK_IDS,
} from '../src/compliance-config.js';
import { complianceFindings } from '../src/compliance-config.js';
import { toSarif, sarifLevel, ciExitCode } from '../src/sarif.js';
import { resolvePack, getRule } from '../src/registry.js';
import { resolveSeverity } from '../src/config.js';
import type { CheckableClaim, MandateClaim, Mandate } from '../src/mandate.js';
import type { ComplianceVerdict } from '../src/verdict.js';
import type { Config, Finding } from '../src/types.js';

const xa = (): CheckableClaim['source'] => ({ kind: 'cross-artifact', workItemSlug: 'p', path: 'c.yaml', fidelity: 'verbatim' });
const verifyClaim: CheckableClaim = {
  id: 'verify-independence', says: '', kind: 'human-constraint', scope: { kind: 'whole-session' }, source: xa(),
  predicate: { target: 'read-paths', matcher: 'not_contains', scope: 'transcript', value: 'build_report' },
};
const fileScopeClaim: CheckableClaim = {
  id: 'fs', says: '', kind: 'file-scope', scope: { kind: 'whole-session' }, source: xa(),
  predicate: { target: 'edit-paths', matcher: 'contains', scope: 'transcript', value: 'src/a.ts' },
};
const v = (status: ComplianceVerdict['status']): ComplianceVerdict => ({ claimId: 'x', status, reason: status === 'violated' ? 'predicate-not-matched' : 'predicate-matched', evidence: [], source: 'deterministic' });

// ─── ComplianceCheckId mapping (NOT ClaimKind) ───────────────────────────────────────────
describe('D-CONFIG — checkIdForClaim maps the check (NOT ClaimKind)', () => {
  it('a read-paths human-constraint → verify-independence (the named special case)', () => {
    expect(checkIdForClaim(verifyClaim)).toBe('verify-independence');
  });
  it('a file-scope claim → file-scope', () => {
    expect(checkIdForClaim(fileScopeClaim)).toBe('file-scope');
  });
  it('an intent claim → null (no deterministic check)', () => {
    const intent: MandateClaim = { id: 'i', says: '', kind: 'intent', scope: { kind: 'whole-session' }, source: xa() };
    expect(checkIdForClaim(intent)).toBeNull();
  });
});

// ─── verdict→gate mapping (the bright line) ──────────────────────────────────────────────
describe('D-CONFIG — verdict→gate mapping (unverifiable NEVER gates; satisfied silent)', () => {
  it('unverifiable → ALWAYS info, even with config error override', () => {
    const cfg: Config = { schemaVersion: 1, rules: { 'compliance/verify-independence': 'error' } };
    expect(severityForVerdict({ ...v('unverifiable'), reason: 'codex-blind' }, verifyClaim, cfg)).toBe('info');
  });
  it('satisfied → off (silent)', () => {
    expect(severityForVerdict(v('satisfied'), verifyClaim)).toBe('off');
  });
  it('violated → the check active severity (default error)', () => {
    expect(severityForVerdict(v('violated'), verifyClaim)).toBe('error');
  });
  it('violated → respects a config downgrade to warn', () => {
    const cfg: Config = { schemaVersion: 1, rules: { 'compliance/verify-independence': 'warn' } };
    expect(severityForVerdict(v('violated'), verifyClaim, cfg)).toBe('warn');
  });
});

// ─── unknown compliance/* id WARNs (net-new surface) ─────────────────────────────────────
describe('D-CONFIG — an unknown compliance/* id is flagged (never a silent no-op)', () => {
  it('a typo compliance/file-scop is returned by unknownComplianceKeys', () => {
    const cfg: Config = { schemaVersion: 1, rules: { 'compliance/file-scop': 'error', 'compliance/file-scope': 'error' } };
    expect(unknownComplianceKeys(cfg)).toEqual(['compliance/file-scop']);
  });
  it('all known ids pass clean', () => {
    const rules: Record<string, 'error'> = {};
    for (const id of COMPLIANCE_CHECK_IDS) rules[complianceKey(id)] = 'error';
    expect(unknownComplianceKeys({ schemaVersion: 1, rules })).toEqual([]);
  });
});

// ─── opt-in pack: recommended stays friction-only (R2 byte-identity) ─────────────────────
describe('D-CONFIG — compliance is OPT-IN (recommended stays friction-only)', () => {
  it('the default pack (recommended) contains NO compliance rules', () => {
    const def = resolvePack();
    expect(def.some((r) => r.id.startsWith('compliance/'))).toBe(false);
  });
  it('opting in with extends:["compliance"] resolves the compliance rules', () => {
    const pack = resolvePack({ schemaVersion: 1, extends: ['compliance'] });
    expect(pack.some((r) => r.id === 'compliance/verify-independence')).toBe(true);
  });
  it('each ComplianceCheckId registers a Rule whose id is compliance/<id> (resolveSeverity keys by rule.id)', () => {
    for (const id of COMPLIANCE_CHECK_IDS) {
      const rule = getRule(complianceKey(id));
      expect(rule).toBeDefined();
      expect(rule!.id).toBe(complianceKey(id));
    }
  });
  it('contract-under-specified defaults to info (non-gating); the gating checks default error', () => {
    expect(resolveSeverity(getRule('compliance/contract-under-specified')!)).toBe('info');
    expect(resolveSeverity(getRule('compliance/file-scope')!)).toBe('error');
  });
});

// ─── SARIF (violated-only) + CI exit codes ───────────────────────────────────────────────
describe('D-CONFIG — SARIF emits violated-only; CI exit codes', () => {
  const mandate: Mandate = { schemaVersion: 1, framework: 'x', claims: [verifyClaim, fileScopeClaim] };
  const verdicts: ComplianceVerdict[] = [
    { claimId: 'verify-independence', status: 'violated', reason: 'predicate-not-matched', evidence: [], source: 'deterministic' },
    { claimId: 'fs', status: 'unverifiable', reason: 'absent-signal', evidence: [], source: 'deterministic' },
  ];

  it('Severity → SARIF level mapping (off omitted)', () => {
    expect(sarifLevel('error')).toBe('error');
    expect(sarifLevel('warn')).toBe('warning');
    expect(sarifLevel('info')).toBe('note');
    expect(sarifLevel('off')).toBeNull();
  });

  it('complianceFindings(violatedOnly) drops the unverifiable (no note-flood)', () => {
    const f = complianceFindings(mandate, verdicts, undefined, { violatedOnly: true });
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe('compliance/verify-independence');
    expect(f[0].severity).toBe('error');
  });

  it('toSarif emits only the violated result on the code-scanning rail', () => {
    const gating = complianceFindings(mandate, verdicts, undefined, { violatedOnly: true });
    const log = toSarif(gating);
    expect(log.version).toBe('2.1.0');
    expect(log.runs[0].results).toHaveLength(1);
    expect(log.runs[0].results[0].level).toBe('error');
  });

  it('every SARIF result carries a location (GitHub code-scanning requires it) — fallback uri when no file', () => {
    const gating = complianceFindings(mandate, verdicts, undefined, { violatedOnly: true });
    const log = toSarif(gating, 'anatrace', undefined, 'policy.yaml');
    for (const r of log.runs[0].results) {
      expect(r.locations?.length, JSON.stringify(r)).toBeGreaterThan(0);
      expect(r.locations![0]!.physicalLocation.artifactLocation.uri.length).toBeGreaterThan(0);
    }
    // a finding with no file location falls back to the supplied obligation source.
    expect(log.runs[0].results.some((r) => r.locations![0]!.physicalLocation.artifactLocation.uri === 'policy.yaml')).toBe(true);
  });

  it('ciExitCode → 1 on a violated@error, 0 when nothing meets the threshold', () => {
    const violated: Finding[] = [{ ruleId: 'compliance/verify-independence', severity: 'error', message: 'x' }];
    const infoOnly: Finding[] = [{ ruleId: 'compliance/verify-independence', severity: 'info', message: 'x' }];
    expect(ciExitCode(violated, 'error')).toBe(1);
    expect(ciExitCode(infoOnly, 'error')).toBe(0); // unverifiable→info never gates
    expect(ciExitCode(infoOnly, 'info')).toBe(1); // --fail-on info would catch it
  });
});

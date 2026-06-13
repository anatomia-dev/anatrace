import * as fs from 'node:fs';
import type {
  AgentRef,
  CaptureCoverage,
  DelegateManifest,
  ExpectedLaunchBoundary,
  LaneCaptureCoverage,
  LineageExtraction,
} from 'anatrace-core';
import { coverageFromExpectedLaunchBoundary } from 'anatrace-core';

export type CaptureCoverageResult =
  | { ok: true; coverage: CaptureCoverage }
  | { ok: false; message: string };

function parseAgentRef(value: unknown): AgentRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (record['kind'] === 'root' && keys.length === 1) return { kind: 'root' };
  if (
    record['kind'] === 'subagent' &&
    typeof record['subagentId'] === 'string' &&
    record['subagentId'] &&
    keys.length === 2
  ) {
    return { kind: 'subagent', subagentId: record['subagentId'] };
  }
  return null;
}

function parseManifest(value: unknown): DelegateManifest | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record['status'] === 'unavailable') return { status: 'unavailable' };
  if (record['status'] !== 'complete' || !Array.isArray(record['delegates'])) return null;
  const delegates: AgentRef[] = [];
  for (const value of record['delegates']) {
    const delegate = parseAgentRef(value);
    if (!delegate) return null;
    delegates.push(delegate);
  }
  return { status: 'complete', delegates };
}

function parseLane(value: unknown): LaneCaptureCoverage | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const agent = parseAgentRef(record['agent']);
  const delegateManifest = parseManifest(record['delegateManifest']);
  if (!agent || typeof record['captured'] !== 'boolean' || !delegateManifest) return null;
  return { agent, captured: record['captured'], delegateManifest };
}

function parseExpectedLane(value: unknown): ExpectedLaunchBoundary['lanes'][number] | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const agent = parseAgentRef(record['agent']);
  if (!agent || !Array.isArray(record['expectedDelegates'])) return null;
  const expectedDelegates: AgentRef[] = [];
  for (const value of record['expectedDelegates']) {
    const delegate = parseAgentRef(value);
    if (!delegate) return null;
    expectedDelegates.push(delegate);
  }
  return { agent, expectedDelegates };
}

/**
 * Read and validate trusted launcher capture metadata at the CLI boundary.
 *
 * @param file - JSON capture-manifest path.
 * @returns Validated coverage or a user-facing error.
 */
export function resolveCaptureCoverage(file: string, lineage?: LineageExtraction): CaptureCoverageResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      message: `anatrace: cannot read capture manifest ${file}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, message: 'anatrace: capture manifest must be a JSON object.' };
  }
  const record = parsed as Record<string, unknown>;
  if (record['source'] !== 'trusted-launcher' || !Array.isArray(record['lanes'])) {
    return {
      ok: false,
      message:
        "anatrace: capture manifest requires source:'trusted-launcher' and a lanes array.",
    };
  }
  if (record['kind'] !== undefined && record['kind'] !== 'expected-launch-boundary') {
    return {
      ok: false,
      message: `anatrace: unknown capture manifest kind ${String(record['kind'])}.`,
    };
  }
  if (record['kind'] === 'expected-launch-boundary') {
    const lanes: ExpectedLaunchBoundary['lanes'] = [];
    const laneKeys = new Set<string>();
    for (const [index, value] of record['lanes'].entries()) {
      const lane = parseExpectedLane(value);
      if (!lane) {
        return {
          ok: false,
          message: `anatrace: invalid expected launch boundary lane at index ${index}.`,
        };
      }
      const key = lane.agent.kind === 'root' ? 'root' : `subagent:${lane.agent.subagentId}`;
      if (laneKeys.has(key)) {
        return {
          ok: false,
          message: `anatrace: duplicate expected launch boundary lane ${key}.`,
        };
      }
      laneKeys.add(key);
      lanes.push(lane);
    }
    return {
      ok: true,
      coverage: coverageFromExpectedLaunchBoundary({
        source: 'trusted-launcher',
        lanes,
      }, lineage),
    };
  }
  const lanes: LaneCaptureCoverage[] = [];
  const laneKeys = new Set<string>();
  for (const [index, value] of record['lanes'].entries()) {
    const lane = parseLane(value);
    if (!lane) {
      return {
        ok: false,
        message: `anatrace: invalid capture manifest lane at index ${index}.`,
      };
    }
    const key = lane.agent.kind === 'root' ? 'root' : `subagent:${lane.agent.subagentId}`;
    if (laneKeys.has(key)) {
      return {
        ok: false,
        message: `anatrace: duplicate capture manifest lane ${key}.`,
      };
    }
    laneKeys.add(key);
    lanes.push(lane);
  }
  return { ok: true, coverage: { source: 'trusted-launcher', lanes } };
}

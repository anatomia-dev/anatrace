import type { AgentRef } from './session.js';
import { agentKey, uniqueAgentsSorted as uniqueAgents } from './session.js';
import type { LineageExtraction } from './lineage.js';

/**
 * A trusted launcher's complete declaration of the direct delegates spawned by one lane.
 * `unavailable` means the launcher supplied no complete manifest for that lane.
 */
export type DelegateManifest =
  | { status: 'complete'; delegates: AgentRef[] }
  | { status: 'unavailable' };

/**
 * Trusted capture state for one declared lane. A declared delegate with `captured:false`
 * makes a delegate-inclusive negative unverifiable even when its parent manifest is complete.
 */
export interface LaneCaptureCoverage {
  agent: AgentRef;
  captured: boolean;
  delegateManifest: DelegateManifest;
}

/**
 * Coverage supplied by the environment that launched the agent. Sidecar discovery alone is
 * never treated as completeness: only a trusted launcher can state the exhaustive delegate
 * manifest, lane by lane.
 */
export interface CaptureCoverage {
  source: 'trusted-launcher';
  completeness?: 'complete' | 'incomplete';
  lanes: LaneCaptureCoverage[];
}

/**
 * Raw launcher intent: the direct delegate graph the launcher intended to start and capture.
 * This is not itself proof of capture. It becomes verdict input only after reconciliation
 * with observed lineage, which marks lanes captured iff their transcript bytes were checked.
 */
export interface ExpectedLaunchLane {
  agent: AgentRef;
  expectedDelegates: AgentRef[];
}

export interface ExpectedLaunchBoundary {
  source: 'trusted-launcher';
  lanes: ExpectedLaunchLane[];
}

/**
 * External bindings needed to resolve policy subjects without inferring identity from prose.
 * Roles are logical launcher roles, not people and not harness-specific agent labels.
 */
export interface MandateEvaluationContext {
  thisAgent?: AgentRef;
  roleBindings?: Record<string, AgentRef[]>;
  captureCoverage?: CaptureCoverage;
  lineage?: LineageExtraction;
}


/**
 * Reconcile raw launcher intent with observed checked lanes. Pure: no filesystem, clock,
 * process, network, or inference from prose. Expected launch records alone never prove
 * capture; absent lineage therefore yields uncaptured lanes.
 */
export function coverageFromExpectedLaunchBoundary(
  boundary: ExpectedLaunchBoundary,
  lineage?: LineageExtraction,
): CaptureCoverage {
  const checked = new Set((lineage?.checkedLanes ?? []).map(agentKey));
  const complete =
    lineage !== undefined &&
    lineage.completeness !== 'observed-partial' &&
    lineage.gaps.length === 0;
  const lanes = boundary.lanes
    .slice()
    .sort((a, b) => agentKey(a.agent).localeCompare(agentKey(b.agent)))
    .map((lane): LaneCaptureCoverage => ({
      agent: lane.agent,
      captured: checked.has(agentKey(lane.agent)),
      delegateManifest: {
        status: 'complete',
        delegates: uniqueAgents(lane.expectedDelegates),
      },
    }));
  return {
    source: 'trusted-launcher',
    completeness: complete ? 'complete' : 'incomplete',
    lanes,
  };
}

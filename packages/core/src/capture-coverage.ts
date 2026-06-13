import type { AgentRef } from './session.js';
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
  lanes: LaneCaptureCoverage[];
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

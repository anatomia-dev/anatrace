# anatrace-core

Pure, deterministic primitives for working with AI-agent session evidence:

1. Parse Claude Code and Codex transcripts into one `NormalizedSession`.
2. Derive timeline, provenance, cost, metadata, and scrubbed content.
3. Compile `.anatrace.yaml` into the framework-neutral Mandate IR.
4. Resolve deterministic `satisfied | violated | unverifiable` policy verdicts.

The core has no filesystem, network, clock, randomness, or LLM dependency.

```sh
npm install anatrace-core
```

## Parse a session

```ts
import { parseSession } from 'anatrace-core';

const session = parseSession([
  { name: 'parent', bytes: transcriptBytes },
]);

if (!session) throw new Error('Unsupported transcript');
console.log(session.harness, session.events, session.counts);
```

## Load and verify a policy

```ts
import {
  loadPolicyYaml,
  verdictsForMandate,
} from 'anatrace-core';

const loaded = loadPolicyYaml(`
version: 1
rules:
  - id: no-destructive-command
    subject: this-agent
    never_run: rm -rf
`);

if (!loaded.ok) throw new Error(loaded.errors.join('\n'));

const verdicts = verdictsForMandate(
  loaded.mandate,
  session,
  undefined,
  undefined,
  '',
  { thisAgent: { kind: 'root' } },
);
```

Delegate-inclusive negative conclusions require reconciled `CaptureCoverage`:
observed lineage from transcripts/sidecars/hooks plus the caller's expected
launch boundary. Without complete recursive coverage they return
`unverifiable: delegate-coverage-incomplete`. Detected violations remain
provable without completeness.

Callers that have raw launcher intent can use
`coverageFromExpectedLaunchBoundary(boundary, lineage)` to produce deterministic
coverage. Expected records alone do not prove capture; a lane is marked captured
only when the supplied lineage says its transcript bytes were checked. The
generated coverage is itself marked incomplete when reconciliation lineage is
partial or has gaps.

`never_read` covers structured reads and recognized shell readers.
`never_egress` covers shell network commands, network tools, and MCP calls.
Unknown tools and unsupported commands produce
`unverifiable: channel-coverage-incomplete`, with typed details in
`Report.verificationCoverage` and `Dossier.verificationCoverage`.

## Session facts for downstream consumers

Beyond the verdict, `anatrace-core` exposes a deterministic, facts-only projection layer for tools
that consume it for *parsing + session facts* (no LLM, no verdict, no identity/score):

```ts
import { buildSessionMeta, gitOpsTimeline, runnerOutcomes } from 'anatrace-core';

const meta = buildSessionMeta(session);          // per-session aggregate facts (git/context/flow/…)
const gitOps = gitOpsTimeline(session.events);   // positioned mutating git ops (when/order/lane)
const tests = runnerOutcomes(session.events);    // structured pass/fail/unknown, runner-gated
```

`runnerOutcomes` classifies only on a runner-specific banner (vitest/jest, the ana verdict line) and
abstains otherwise — pytest/cargo/go are a deliberate blind spot, never a guessed pass. `gitOpsTimeline`
shares the verdict path's quote-aware segmentation, so quoted/data `git` tokens are never phantom ops.
Full reference, including the honesty floor and the known blind spots:
[`docs/reference/session-facts.md`](https://github.com/anatomia-dev/anatrace/blob/main/docs/reference/session-facts.md).

See the [repository README](https://github.com/anatomia-dev/anatrace#readme) for
CLI usage and the full honesty contract.

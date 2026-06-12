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

Delegate-inclusive negative conclusions require launcher-supplied
`CaptureCoverage`. Without a complete recursive manifest they return
`unverifiable: delegate-coverage-incomplete`. Detected violations remain
provable without completeness.

Phase 0 accepts `never_egress`, but egress remains `unverifiable` until the
channel-complete Phase 1 detector lands.

See the [repository README](https://github.com/anatomia-dev/anatrace#readme) for
CLI usage and the full honesty contract.

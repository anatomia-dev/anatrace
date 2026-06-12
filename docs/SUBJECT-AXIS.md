# Subject Axis

## Decision

A mandate separates:

- `ClaimScope`: **when** the obligation applies.
- `ClaimSubject`: **who** the obligation applies to.

Identity never appears inside temporal scope. The former
`event-triggered-window.agentScope` field is removed; windowed claims carry a
single-lane `ClaimSubject` instead.

```ts
type ClaimSubject =
  | { kind: 'agent'; selector: 'this'; delegates: 'exclude' | 'include' }
  | { kind: 'session' }
  | { kind: 'role'; role: string; delegates: 'exclude' | 'include' };
```

Omitted `subject` preserves the legacy flat-session behavior for existing
Mandates. New loaders emit an explicit subject.

## Trusted Bindings

Subjects resolve only from caller-supplied launch metadata:

```ts
interface MandateEvaluationContext {
  thisAgent?: AgentRef;
  roleBindings?: Record<string, AgentRef[]>;
  captureCoverage?: CaptureCoverage;
}
```

Roles are never inferred from transcript prose, filenames, people, or
harness-specific labels. A missing or ambiguous binding produces
`unverifiable: subject-unresolvable`.

## Capture Coverage

Delegate completeness comes from the trusted launcher, not sidecar discovery.

```ts
interface CaptureCoverage {
  source: 'trusted-launcher';
  lanes: LaneCaptureCoverage[];
}

interface LaneCaptureCoverage {
  agent: AgentRef;
  captured: boolean;
  delegateManifest:
    | { status: 'complete'; delegates: AgentRef[] }
    | { status: 'unavailable' };
}
```

For a delegate-inclusive subject, an absent action is provable only when:

1. Every visited lane has a complete direct-delegate manifest.
2. Every declared delegate has a coverage record.
3. Every declared delegate is marked captured.
4. The recursive manifest is acyclic.
5. Every observed root-session lane is represented by that manifest.

Otherwise an absence produces
`unverifiable: delegate-coverage-incomplete`.

Observed violations do not require completeness. If a captured root or
delegate lane contains the forbidden action, the violation and its evidence
remain provable even when the launcher supplied no complete manifest.

Required positive obligations follow the same rule: absence cannot become a
violation across an incomplete delegate set.

## Window Migration

Before:

```ts
{
  scope: {
    kind: 'event-triggered-window',
    opensOn: 'skill-invoked',
    closesOn: 'rest-of-session',
    agentScope: { kind: 'root' }
  }
}
```

After:

```ts
{
  subject: { kind: 'agent', selector: 'this', delegates: 'exclude' },
  scope: {
    kind: 'event-triggered-window',
    opensOn: 'skill-invoked',
    closesOn: 'rest-of-session'
  }
}
```

Windowed subjects must resolve to exactly one lane. Session-wide or
delegate-inclusive window subjects are rejected rather than combining
competing timelines.

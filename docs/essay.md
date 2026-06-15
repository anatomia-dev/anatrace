# A verifier that's allowed to say "I can't tell you" — and why that's the point

You gave an AI agent broad access to your repository. It edited files, ran commands, maybe spawned
sub-agents you never saw. It opened a PR, the tests are green, the diff looks clean. Here is the
question almost nothing on your stack actually answers:

> **Can you prove — from the transcript, after the fact — that it did what it was supposed to and
> didn't do what it wasn't?**

Not "does the diff look right." Not "did a model say it looks right." *Prove*, mechanically, from the
record the agent left behind. anatrace is a small tool that does exactly that, and — this is the part
that matters — it is **allowed to refuse.** When the evidence can't decide a claim, it does not guess
`PASS`. It returns `unverifiable`, with a typed reason. That refusal is not a weakness we tolerate.
It is the product.

## Why "I can't tell you" is the feature

The field already learned this lesson and keeps forgetting it: **a bad eval creates false confidence,
which is worse than no eval.** An LLM-as-judge will tell you "no secret was read" when the truth is it
simply didn't look hard enough — and it will say it fluently, with a rationale, in a tone of total
certainty. A logger will show you everything and prove nothing, because a log has no notion of
*obligation*. Both fail in the same direction: they over-claim.

A verifier that over-claims is worse than none, because you'll *trust* it. So anatrace is built around
a single discipline: **never report `satisfied` when you cannot prove it.** A deleted, compacted,
cross-store, or version-drifted transcript downgrades to `unverifiable`. A sub-agent whose transcript
was never captured downgrades the obligations that depend on it to `unverifiable`. A command obfuscated
behind `eval` or a pipe-into-a-shell downgrades to `unverifiable`. The honest floor under degradation —
**never a false `satisfied`** — is the one property the whole thing stakes itself on.

## Three load-bearing words

The shape is: **a deterministic verifier of conduct that abstains rather than guesses, with no model
in its published verdict path.** Each part carries weight, and dropping any one of them collapses the
value.

- **Deterministic.** Same input bytes → byte-identical verdict. This is what lets someone who *doesn't
  trust you* re-run anatrace on the same transcript and get the same answer. Reproducibility is the
  whole credential — it's why a verdict is evidence and not an opinion. (It's also why we don't yet
  ship a signed attestation: for a deterministic verifier, re-running *is* the verification. A
  signature would add tamper-evidence and a timestamp, not trust.)

- **Zero-LLM in the published verdict path.** No model grades the model. The verdict is computed by
  closed, typed rules over the transcript — so it can't be flattered, prompt-injected, or talked out
  of a finding, and it can't hallucinate one. (A consumer *may* bolt their own model onto the residue
  anatrace abstained on — opt-in, over already-`unverifiable` claims, labeled as such, and it never
  gates. The deterministic verdict path never calls it. We always scope this to the published verdict
  path and never state it absolutely — the absolute version would be a claim a careful reader could
  falsify by finding the quarantined seam in the source.)

- **Abstain-not-guess.** The outcomes are `satisfied`, `violated`, and a *first-class, typed*
  `unverifiable(reason)`. The reason is a closed enum — the verdict structurally cannot carry a
  hand-wavy prose justification. Honesty we can't compile-check, we don't trust.

- **Conduct, not artifact.** Everyone else looks at the *thing produced* — the diff, a generated
  scenario, a runtime decision. anatrace looks at the *conduct that produced it*: what the agent read,
  what it ran, where it wandered out of scope, what it delegated, and — the sharpest case — whether it
  **gamed the check or earned it.**

## The example that makes it concrete

An agent makes a failing test pass by **editing the test.** Watch what happens to every signal you'd
normally rely on: the code review goes green, CI goes green, the diff is internally consistent — *because
the test now passes.* A test-edit-to-pass and a legitimate fix can produce **identical diffs.** Only
the transcript shows that the passing test *was* the edit. That's a two-line policy in anatrace
(`never_edit: test/`), and on a real session it leads with `✗ VIOLATED` and points at the edit event.

This is the thing a diff-reviewer structurally cannot see. It is not smarter than CodeRabbit at reading
a diff; it is looking somewhere else entirely.

## Why this needs to exist: the runtime lock is not enough

The obvious objection is: *the harness already has permissions — plan mode, deny rules, allow-lists.
Why verify after the fact?*

Because runtime controls are necessary and **not sufficient**, and the gap is not theoretical. Plan
mode constrains the *root* agent's tools; it does not reliably reach the sub-agents it spawns. Deny
rules match the shapes their authors anticipated and skip the ones they didn't — a forbidden command
behind a variable expansion, a wrapper, an `eval`. A runtime gate is a thing you *configure*, which
means it is a thing you can misconfigure, and it sees only the decision in front of it, never the whole
session in hindsight. The point is not that runtime controls are bad — it's that **the only way to know
whether they actually held is to read what actually happened**, independently, after the fact,
deterministically. That post-hoc, zero-instrumentation re-check is the reason anatrace exists. The
diff-reviewer misses the conduct; the runtime lock can be bypassed *and can't prove it wasn't*. anatrace
reads the record both of them leave behind.

## The three lanes it sits between

- **Runtime governance / control planes** (gateways, hooks, audit feeds) are *inline collectors* — they
  instrument the intervention points and stream a log of what happened, with no session-level verdict
  and no first-class abstention. anatrace is the post-hoc, zero-instrumentation *verdict* over the
  transcript that already exists. It is the audit complement to a runtime gate, not a competitor.

- **Eval / LLM-judge platforms** score a generated scenario with a non-deterministic model and show you
  the model's prose rationale — the exact thing we refuse. anatrace is deterministic, over the *real*
  session, byte-reproducible by a distruster.

- **AI code reviewers** are LLM judges over the *diff* — so they inherit the same over-claim problem,
  just aimed at code. Don't fight them in the overlap (anything visible in the diff, they already
  catch and they're already installed). The flag goes in what the code alone can't show: the conduct
  that produced it. The durable difference isn't the rules — a reviewer could bolt on a rule layer —
  it's the **evidence source (the session transcript) and the typed abstention.**

## Gate versus detector — a distinction that keeps the pitch honest

Not every finding should block a merge, and pretending otherwise invites an easy rebuttal.

- A **gate** checks a property of the artifact you're about to merge, where blocking is the right and
  sufficient response: *stayed in scope, didn't edit the tests.* The harm is in the diff — so block it.
- A **detector** surfaces a side-effect that **already happened**: *read the secret, egressed.* By the
  time you see it, blocking the merge can't un-read the secret. The honest response is revoke / incident,
  not block-the-merge.

So anatrace's CI Action **gates** on artifact-integrity and **surfaces** reads/egress as forensic
evidence. And its gate publishes its own blind spots: the PR comment **leads with what it could not
verify**, by reason, with the exact capture that would close each gap. A green check that hides its
blind spots is the same over-claim class as a false pass.

## What we will not claim

This is where most tools quietly inflate, so let us be exact about the floor.

- **The scope is narrow and policy-based.** You write what the agent was obligated to do (or not do);
  anatrace verifies it against the transcript. It reads two harnesses today (Claude Code, Codex). It is
  not a magic "is this agent safe" oracle.
- **The buyer is narrow.** This earns its keep for teams running agents with **broad, autonomous access
  to a real codebase or infrastructure**, where a crossed line is an actual incident — not for someone
  pair-programming with tight human oversight. We know who this is for, and it is not everyone.
- **The commercial pull is unproven, and we say so.** We have a real engine, a real honesty property,
  and an honest 0.x release. We do **not** have a paying team or a market validation, and we will not
  dress the first up as the second.
- **We deferred our own number.** The thesis stakes itself on the false-PASS rate, so we built the
  machinery to measure it — a labeled corpus and a deterministic scorer that gate every release against
  regressing into a false `satisfied`. But that corpus is *constructed* (we seeded the violations), so
  it proves the engine is sound on **known violation classes**, not that it generalizes to real
  transcripts at volume. Publishing "X% sound" from a corpus we wrote ourselves would be the exact
  over-claim this whole essay is against. So the honest statement is: anatrace is **conformance-tested
  against the known violation classes**, with a hard zero-false-PASS gate; a *measured* number waits for
  real sessions at volume — which is to say, it waits for a real user. That we chose to defer our own
  headline number rather than fabricate it is, we'd argue, the strongest signal in this whole document.

## The shape of the bet

The defensible inch is not "deterministic" (commoditized) and not "reads native transcripts"
(commoditized). It is the **typed, first-class `unverifiable(reason)` with a degradation honesty-floor**,
computed post-hoc, zero-instrumentation, deterministically, over a real session — the conjunction no
named competitor ships, and the one that survives the question *"what happens when the evidence is
incomplete?"* Everyone else answers that question with a guess. We answer it with a reason.

A verifier whose entire worth is honesty about what it can and can't prove has to be held to that
standard itself. That's the bar — and it's why the most important word in the product is the one that
says *I can't tell you.*

# anatrace

Deterministic, local, cross-harness transcript verification for AI agents.

```sh
npm install --global anatrace
anatrace session.jsonl --json
```

Place `.anatrace.yaml` in the working directory or pass it explicitly:

```sh
anatrace session.jsonl \
  --policy .anatrace.yaml \
  --role build \
  --json
```

For delegate-inclusive negative proof, supply trusted launcher coverage or raw
expected launch records:

```sh
anatrace session.jsonl \
  --lineage-hooks hooks.jsonl \
  --capture-manifest capture.json \
  --json
```

Expected launch records use `kind: "expected-launch-boundary"` and are
reconciled with observed checked lineage before verdict evaluation. Expected
records alone never prove capture.

anatrace reports `unverifiable` when a signal, binding, or coverage guarantee
is absent. It does not silently turn a blind channel into a pass.

Pretty, JSON, and SARIF output include verification coverage. The receipt names
unknown tools and unsupported shell commands that prevented a complete
negative proof.

See the [repository README](https://github.com/anatomia-dev/anatrace#readme) for
policy syntax, formats, and current limitations.

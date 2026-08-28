# Architecture

Agentfolio orchestrates external collections and has no target-system knowledge.

```text
collection.yaml -> validation and profile selection -> plan -> apply / doctor
                         |                              |
                    pinned Skills CLI              trusted adapters
```

A collection owns its adapters, harness IDs, action names, and action configuration. Agentfolio owns collection discovery, strict schema validation, ordered orchestration, literal argv execution, and safe reporting.

## Execution flow

`plan` resolves a profile, plans native Skills work, then invokes each selected adapter in order with a protocol-v1 `plan` request. `apply` uses that already-built ordering, runs Skills once when selected, and calls every adapter with the requested `dryRun` value. `doctor` calls each selected adapter once and collects its checks.

Adapters are an executable trust boundary: each declaration supplies an executable and literal args, which run as `[executable, ...args]` from the collection root without a shell. They receive one JSON request on stdin and emit one JSON object on stdout. Responses are allowlisted and redacted before reports; raw adapter streams are never displayed.

Authentication remains available through the inherited process environment and user keychains. Agentfolio does not discover, serialize, or store credentials. It rejects credential-shaped schema and protocol keys.

Skills uses the pinned local `skills` dependency. It neither downloads nor updates that tool during normal execution. Imports are reference-only until they have an executable pinned contract.

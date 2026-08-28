# Agentfolio

Agentfolio safely plans and applies generic external collections. A collection is a directory explicitly identified by `collection.yaml`; this CLI repository is never implicitly a collection.

## Install and start

Requires Node.js 20+.

```sh
npm install
npm link
agentfolio init ./my-collection
cd ./my-collection
agentfolio plan
agentfolio apply --dry-run
agentfolio apply
```

Collection discovery is, in order: `--collection DIRECTORY`, `AGENTFOLIO_COLLECTION`, then the nearest ancestor that physically contains `collection.yaml`.

Skills support uses Agentfolio's pinned local Skills CLI binary. Direct Skills installation is intentionally not documented as a floating network command.

## Adapter boundary

```yaml
adapters:
  local:
    command: [node, ./scripts/adapter.mjs]
```

Agentfolio executes this literal argv without a shell; running it trusts collection code. Adapters receive one protocol JSON request on stdin and return one JSON object on stdout. Agentfolio inherits normal process authentication but never discovers, stores, or prints credentials.

`plan` reports selected work. `apply --dry-run` passes a dry-run request to adapters and does not run Skills changes. Collections own all action semantics.

## Commands

```text
agentfolio init [dir]
agentfolio list skills|harnesses|tools|profiles
agentfolio plan [--profile name]
agentfolio apply [--profile name] [--dry-run]
agentfolio doctor [--profile name]
agentfolio verify [--profile name]
```

See [architecture](docs/architecture.md) and [collection schema](docs/collection-schema.md).

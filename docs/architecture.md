# Architecture

Agentfolio is a harness-agnostic workflow orchestrator.

```text
collection.yaml
      |
      v
  Agentfolio
  validate / profiles / ordered plan / apply / doctor
      |
      +-- Skills CLI (native)
      `-- collection-owned adapters (JSON over stdin/stdout)
```

## Ownership

| Owner | Responsibilities |
| --- | --- |
| Agentfolio | Collection discovery, schema, profile selection, action ordering, dry-run, adapter protocol, native skills |
| Collection | Harness IDs, action names and payloads, adapter implementations, tool references |
| Adapter | Plugins, agents, instructions, models, providers, services, paths, platform-specific behavior |

Core source must not contain harness names, provider implementations, model catalogs, bridges, service units, or home-directory targets.

## Harness workflows

Harnesses are mappings with ordered actions:

```yaml
harnesses:
  terminal:
    adapter: team
    actions:
      - action: add-plugin
        source: example-plugin
      - action: add-agents
        source: ./agents
```

Action names and payloads are opaque to Agentfolio. The selected adapter receives each action through the protocol and decides what it means.

## Adapter boundary

Adapters are collection-owned argv commands:

```yaml
adapters:
  team:
    command: [node, ./scripts/agentfolio-adapter.mjs]
    timeout: 120000
```

Agentfolio runs adapters without a shell from the collection root. Requests and responses are protocol-v1 JSON. `plan` must not mutate; `apply` honors `dryRun`; `doctor` returns structured checks.

## Profiles

Profiles select native skills and harness IDs:

```yaml
profiles:
  workstation:
    skills: true
    harnesses: [terminal, editor]
  skills:
    skills: true
    harnesses: []
```

An implicit default selects declared skills and all declared harnesses. `"*"` expands to every harness. Unknown IDs fail validation.

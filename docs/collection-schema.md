# Collection Schema v1

`collection.yaml` is a mapping. `name` and `version: 1` are required.

## Skills

```yaml
skills:
  local: ./skills
  imports: ./imports       # optional reference inventory
  scope: global            # global or project; default global
  agents: ["*"]            # optional; default every agent
  copy: false              # optional; default symlinks
```

The repository remains directly installable:

```bash
npx skills add <owner>/<repository> --all
```

## Adapters

```yaml
adapters:
  local:
    command: [node, ./scripts/agentfolio-adapter.mjs]
    timeout: 120000        # optional milliseconds
```

Commands are non-empty argv arrays and run without a shell from the collection root. Adapter IDs are collection-defined.

## Harnesses

```yaml
harnesses:
  terminal:
    adapter: local
    actions:
      - action: add-plugin
        source: example-plugin
        enabled: true
      - action: add-agents
        source: ./harnesses/terminal/agents
```

`harnesses` is a mapping. Each harness references a declared adapter and has a non-empty ordered `actions` array. Every action requires a non-empty `action` string; optional `summary` must be a string. All other action fields are passed unchanged to the adapter.

## Profiles

```yaml
profiles:
  default:
    skills: true
    harnesses: [terminal]
  everything:
    skills: true
    harnesses: ["*"]
  skills:
    skills: true
    harnesses: []
```

An omitted profile defaults `skills` from whether the collection declares skills and selects every harness. An omitted `profiles` mapping provides the same implicit `default` profile.

## Adapter protocol

Agentfolio writes one request object to stdin for `plan`, `apply`, or `doctor`. The adapter writes exactly one response object to stdout and diagnostics to stderr.

```json
{
  "protocolVersion": 1,
  "operation": "apply",
  "dryRun": true,
  "collection": { "name": "team", "version": 1, "root": "/absolute/path" },
  "harness": { "id": "terminal", "actions": [] },
  "action": { "index": 0, "name": "add-plugin", "config": {} }
}
```

Plan/apply responses require `ok` and may return `summary`, `status`, `changed`, `command`, `detail`, `stdout`, and `stderr`. Doctor returns `ok` plus `checks` entries containing `id`, `ok`, `required`, and `detail`.

## Tools

```yaml
tools:
  catalog: ./tools/catalog.json
```

Tools are reference-only. Harness-specific instructions, plugins, models, providers, and integrations belong in action payloads interpreted by collection adapters.

# Collection Schema v1

A collection is a `collection.yaml` mapping with `name` and `version: 1`. Unknown keys are rejected at every known mapping. Paths such as `skills.local`, `skills.imports`, and `tools.catalog` must be safe relative paths within the collection. Credential-shaped key names are rejected anywhere, including opaque action configuration.

## Skills and tools

```yaml
skills:
  local: ./skills
  imports: ./imports
  scope: global
  agents: ["*"]
  copy: false
tools:
  catalog: ./tools/catalog.json
```

The local Skills executable is the pinned Agentfolio package dependency. `imports` is reference-only and does not install anything.

## Adapters and actions

```yaml
adapters:
  local:
    command: [node, ./scripts/adapter.mjs]
    timeout: 120000
harnesses:
  project:
    adapter: local
    actions:
      - action: configure-project
        summary: Report configuration
        config:
          format: json
profiles:
  default: { skills: true, harnesses: [project] }
```

Adapter commands are non-empty literal argv arrays and execute without a shell from the collection root. Running one trusts collection code. An action permits `action`, optional `summary`, and optional opaque `config` mapping; Agentfolio preserves allowed configuration unchanged.

## Protocol

Agentfolio writes one protocol-v1 request for `plan`, `apply`, or `doctor` to stdin. The adapter writes exactly one JSON object to stdout; diagnostics stay on stderr.

A successful plan/apply response has `ok: true` and may include safe `summary`, `changed`, `status`, `command` argv, and `detail`. A successful doctor response may also include a bounded `checks` array. Each check has string `id`, boolean `ok`, optional boolean `required`, and optional safe string `detail`. Unknown fields and unsafe shapes fail validation. Output is redacted before it reaches text or JSON reports.

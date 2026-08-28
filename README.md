# Agentfolio

A tool for organizing your agent skills.

Agentfolio plans, validates, and applies **YAML-defined harness workflows** without knowing which AI harnesses they target. Collections own harness behavior through adapters, while skills remain directly installable through [Skills CLI](https://skills.sh/).

## Install

Requires Node.js 20+.

```bash
npm install
npm link
```

## Quick start

```bash
agentfolio init ./my-collection
cd ./my-collection
agentfolio plan
agentfolio apply --dry-run
agentfolio apply
```

A generated collection is also a normal Skills CLI repository:

```bash
npx skills add <owner>/<repository> --all
```

## Commands

```text
agentfolio init [dir]
agentfolio list skills|harnesses|tools|profiles
agentfolio plan [--profile name]
agentfolio apply [--profile name] [--dry-run]
agentfolio doctor [--profile name]
agentfolio verify [--profile name]
```

Collection discovery order:

1. `--collection <path>`
2. `AGENTFOLIO_COLLECTION`
3. nearest parent containing `collection.yaml`

## Collection example

```yaml
name: team-agents
version: 1

skills:
  local: ./skills
  scope: global
  agents: ["*"]

adapters:
  team:
    command: [node, ./scripts/agentfolio-adapter.mjs]

harnesses:
  terminal:
    adapter: team
    actions:
      - action: add-plugin
        source: example-plugin
      - action: add-agents
        source: ./harnesses/terminal/agents

profiles:
  default:
    skills: true
    harnesses: [terminal]
  skills:
    skills: true
    harnesses: []
```

Agentfolio understands ordered actions and the adapter lifecycle, but not action semantics. The collection's adapter implements `add-plugin`, `add-agents`, target paths, configuration formats, and runtime-specific behavior.

See [architecture](docs/architecture.md) and [collection schema](docs/collection-schema.md).

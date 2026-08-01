# Agentfolio

Orchestrate **agent collections**: skills via [skills-cli](https://skills.sh/), harness configs via [chezmoi](https://www.chezmoi.io/).

A **collection** is a git-tracked directory (`collection.yaml` + skills + harness notes + chezmoi source). Agentfolio reads that inventory and runs the right backends. Live `~/.pi` / `~/.cursor` are *applied* targets — not the source of truth.

## Install

Requirements:

- Node.js 20+
- [chezmoi](https://www.chezmoi.io/install/) on `PATH` (required for harness/instruction apply)
- Network for `npx skills` on first skill apply

```bash
# from this repo
npm install
npm link          # optional: puts `agentfolio` on PATH

# or run without linking
node ./bin/agentfolio.mjs help
```

## Quick start

```bash
agentfolio init ./my-collection
cd my-collection
agentfolio plan
agentfolio doctor
agentfolio apply --dry-run
agentfolio apply
```

Demo collection (safe local destination, does not touch `$HOME`):

```bash
agentfolio plan --collection ./examples/demo-collection
agentfolio apply --dry-run --collection ./examples/demo-collection
agentfolio verify --collection ./examples/demo-collection
```

## Commands

| Command | Purpose |
| --- | --- |
| `init [dir]` | Scaffold a new collection |
| `list skills\|harnesses\|tools\|plugins` | Inventory browse |
| `plan` | Show skills-cli + chezmoi actions |
| `diff` / `status` | Chezmoi drift against destination |
| `apply [--dry-run]` | Apply skills then chezmoi (fail-fast) |
| `doctor` | Check node / npx / chezmoi / skills + collection paths |
| `verify` | Validate collection + doctor |

Global flags: `--collection <path>`, `--json`, `--dry-run`, `--force`.

Collection discovery: `--collection`, else `AGENTFOLIO_COLLECTION`, else walk up from cwd for `collection.yaml`.

## Architecture

```text
collection.yaml          ← inventories + backends
skills/                  ← skills-cli
harnesses/               ← human-readable harness notes
chezmoi/                 ← chezmoi source (dot_pi, dot_cursor, …)
AGENTS.global.md         ← declared instructions (placement via chezmoi)
tools/catalog.json       ← reference-only in v1
```

| Inventory | Backend | Apply behavior |
| --- | --- | --- |
| skills | `skills-cli` | `npx skills add …` |
| harnesses / instructions | `chezmoi` | `chezmoi apply` from `chezmoi.sourceDir` |
| tools | `reference` | list / verify only |
| plugins | `none` | hint only |

See [docs/architecture.md](docs/architecture.md) and [docs/collection-schema.md](docs/collection-schema.md).

## Relation to agent-skills

[`luabagg/agent-skills`](https://github.com/luabagg/agent-skills) remains the personal collection (“DB”). This repo is the **product orchestrator**. Later: migrate agent-skills to `collection.yaml` and apply it with Agentfolio.

## Develop

```bash
npm test
npm run agentfolio -- plan --collection ./examples/demo-collection
```

## License

MIT

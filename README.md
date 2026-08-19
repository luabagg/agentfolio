# Agentfolio

Orchestrate **agent collections**: skills via [skills-cli](https://skills.sh/), files via [chezmoi](https://www.chezmoi.io/), Pi setup via local commands.

A **collection** is a git-tracked directory. Agentfolio reads it and applies backends. Live `~/.pi` and `~/.cursor` are targets, not the source of truth.

An agent may choose a profile. Agentfolio applies the change. Do not edit live config by hand.

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
| `plan` | Show skills-cli, chezmoi, and model-catalog actions |
| `diff` / `status` | Chezmoi drift against destination |
| `apply [--dry-run] [--profile name]` | Apply a profile (`default`, `pi`, `pi-catalog`, `cursor-bridge`) |
| `setup pi` | Pi packages, extensions, catalog, optional Cursor bridge |
| `doctor` | Check node / npx / chezmoi / skills + collection paths |
| `models check\|diff\|refresh` | Validate, preview, or refresh model catalog locks + generated providers |
| `verify` | Validate collection + doctor |

Global flags: `--collection <path>`, `--json`, `--dry-run`, `--force`, `--profile`, `--catalog-only`, `--skip-cursor-bridge`.

Collection discovery: `--collection`, else `AGENTFOLIO_COLLECTION`, else walk up from cwd for `collection.yaml`.

## Architecture

```text
collection.yaml          ← inventories + backends
skills/                  ← skills-cli
harnesses/               ← human-readable harness notes
chezmoi/                 ← chezmoi source (dot_pi, dot_cursor, …)
AGENTS.global.md         ← declared instructions (placement via chezmoi)
tools/catalog.json       ← reference-only in v1
harnesses/catalog.yaml   ← model selection policy
harnesses/catalog.lock.json ← committed model discovery lock
```

| Inventory | Backend | Apply behavior |
| --- | --- | --- |
| skills | `skills-cli` | `npx skills add …` |
| harnesses / instructions | `chezmoi` | `chezmoi apply` from `chezmoi.sourceDir` |
| tools | `reference` | list / verify only |
| plugins | `none` | hint only |
| models | model catalog | check / diff / refresh |
| Pi setup | `setup pi` / `--profile pi*` | packages, extensions, `~/.pi`, optional Cursor bridge |

See [docs/architecture.md](docs/architecture.md) and [docs/collection-schema.md](docs/collection-schema.md).

## Relation to agent-skills

[`luabagg/agent-skills`](https://github.com/luabagg/agent-skills) is collection #1. It holds skills, catalog policy, and harness files.

This repo is the orchestrator. Prefer Agentfolio for plan, models, and Pi apply.

The `agentfolio-operator` skill in that collection chooses the profile. It does not write files itself.

## Develop

```bash
npm test
npm run agentfolio -- plan --collection ./examples/demo-collection
```

## License

MIT

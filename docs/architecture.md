# Architecture

Agentfolio reads a collection and runs backends. It does not replace skills-cli or chezmoi.

```text
collection.yaml
      │
      ▼
  agentfolio
   plan / apply / setup / models / doctor
      │
      ├── skills-cli
      ├── chezmoi
      ├── models catalog
      └── Pi setup (extensions, settings, Cursor bridge)
```

An agent may choose a profile. Agentfolio applies the change.

## Responsibilities

| Layer | Owns |
| --- | --- |
| Collection repo | Skills, manifests, catalog policy, chezmoi source, instructions |
| Agentfolio | Validate, plan, apply, doctor, model lock, Pi setup |
| skills-cli | Install and list skills |
| chezmoi | Place files on disk |
| Operator skill | Choose the profile. Do not edit live files by hand |

## Profiles

| Profile | Action |
| --- | --- |
| `default` | skills-cli, then chezmoi |
| `pi` | Pi packages, extensions, catalog, optional Cursor bridge |
| `pi-catalog` | Lock, Scope models, filtered providers |
| `cursor-bridge` | Cursor ACP bridge only |

Use `--dry-run` first.

## Default apply order

1. Validate `collection.yaml`.
2. Apply local skills when `skills.local` exists.
3. Apply chezmoi when harness or instruction files exist.
4. Do not install tools or plugins.

Pi profiles skip skills and chezmoi. They write `~/.pi` files instead.

Fail-fast: the first failed action stops the run.

## Extensibility

`KNOWN_BACKENDS` in `src/lib/schema.mjs` is the allowlist.

To add a backend:

1. Extend schema validation.
2. Add a module under `src/backends/` or `src/harnesses/`.
3. Wire it into plan or apply.

Unknown backends fail at validate or plan.

## Destination safety

Default chezmoi destination is `$HOME`.

The demo collection uses `destinationDir: ./apply-target`.

Run `agentfolio apply --dry-run` before a real apply to `$HOME`.

## Collection discovery

1. `--collection <path>`
2. `AGENTFOLIO_COLLECTION`
3. Walk up from cwd for `collection.yaml`

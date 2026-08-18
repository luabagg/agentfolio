# collection.yaml schema (v1)

Root mapping. `name` and `version` required. `version` must be `1`.

```yaml
name: my-collection
version: 1

skills:
  backend: skills-cli          # required when skills present
  local: ./skills              # optional relative path
  imports: ./imports           # optional; plan/verify only in v1

tools:
  backend: reference
  catalog: ./tools/catalog.json
  apply: reference             # only "reference" supported

harnesses:
  - id: pi                     # unique
    source: ./harnesses/pi
    backend: chezmoi

instructions:
  global: ./AGENTS.global.md
  backend: chezmoi

plugins:
  backend: none                # list/hint only

models:
  policy: ./harnesses/catalog.yaml
  lock: ./harnesses/catalog.lock.json

integrations:
  cursorBridge:
    enabled: true
    manifest: ./harnesses/pi.json

chezmoi:
  sourceDir: ./chezmoi         # default ./chezmoi
  destinationDir: ~            # default $HOME; demo uses ./apply-target
```

## Known backends

| Backend | Used for | Apply |
| --- | --- | --- |
| `skills-cli` | skills | `npx --yes skills add …` |
| `chezmoi` | harnesses, instructions | `chezmoi apply` |
| `reference` | tools | none (list/verify) |
| `none` | plugins | none (hint) |
| `models` | model catalog | `agentfolio models check|diff|refresh` |

Unknown backends → validation error for backend-bearing inventory blocks.

## Chezmoi source layout

Under `chezmoi.sourceDir`, chezmoi maps `dot_*` prefixes to hidden dirs in the destination:

```text
chezmoi/
├── dot_pi/agent/AGENTS.md          → <dest>/.pi/agent/AGENTS.md
└── dot_cursor/agents/example.md    → <dest>/.cursor/agents/example.md
```

Harness folders under `harnesses/` are human notes / future metadata. Live file placement is the chezmoi tree.

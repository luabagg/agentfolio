# Architecture

Agentfolio is a thin orchestrator over a **collection** (git-tracked inventory). It does not replace skills-cli or chezmoi.

```text
┌─────────────────────┐
│   collection.yaml   │  inventories + backend hints
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│     agentfolio      │  plan / diff / apply / doctor / verify
└─────┬─────────┬─────┘
      │         │
      ▼         ▼
 skills-cli   chezmoi
 (npx skills) (source → destination)
```

## Responsibilities

| Layer | Owns |
| --- | --- |
| Collection repo | Source of truth: skills, harness notes, `AGENTS.global.md`, chezmoi source tree, tools catalog |
| Agentfolio | Schema validation, inventory listing, apply plan, fail-fast orchestration, doctor/verify |
| skills-cli | Install / update / list skills |
| chezmoi | Place harness + instruction files onto disk (git-friendly diff/apply) |

## Apply order

1. Validate `collection.yaml`
2. Apply **skills** (`skills-cli`) when `skills.local` is set
3. Apply **chezmoi** when harnesses/instructions/chezmoi source exist
4. Tools / plugins never auto-install (reference / hint only)

Fail-fast: first non-zero backend stops the run.

## Extensibility

`KNOWN_BACKENDS` in `src/lib/schema.mjs` is the allowlist. New inventories or backends plug in by:

1. Extending schema validation
2. Adding a backend module under `src/backends/`
3. Wiring into `buildPlan` / `applyCollection`

Unknown backends fail at validate/plan — no silent no-ops.

## Destination safety

- Default chezmoi destination: `$HOME` (omit `chezmoi.destinationDir`)
- Demo collection sets `destinationDir: ./apply-target` so dry-run/apply never touch the real home
- Always `agentfolio apply --dry-run` before first real apply against `$HOME`

## Collection discovery

1. `--collection <path>`
2. `AGENTFOLIO_COLLECTION`
3. Walk up from cwd for `collection.yaml`

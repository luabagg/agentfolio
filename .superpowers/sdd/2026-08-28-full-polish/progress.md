# SDD ledger — plan: docs/superpowers/plans/2026-08-28-full-polish.md

## Preflight

| Scope | Produces | Consumes | Finding |
|---|---|---|---|
| Tasks 1→8 | strict schema, runner, protocol, pinned Skills CLI, example, docs, CI | each subsequent task consumes prior interfaces | Reviewed and corrected before approval; no open plan conflicts |

Ruling: Execute repository plan as one sequential writer with task-scoped commits, then independent whole-branch review — minimizes conflicting low-cost agents while preserving task boundaries — cost if wrong: reviewer may find issues that per-task review would have caught earlier.

Task 1: complete (commit 3fb48a9, tests node --test tests/schema.test.mjs tests/collection.test.mjs)

Ruling: action.config is optional because the plan's required demo action omits it; when supplied it must be a mapping, preserving the stated opaque payload boundary. Regression coverage: existing and demo action fixtures without config validate.

Task 1: complete (commit 3fb48a9, tests node --test tests/schema.test.mjs tests/collection.test.mjs)

Ruling: action.config is optional because the plan's required demo action omits it; when supplied it must be a mapping, preserving the stated opaque payload boundary. Regression coverage: existing and demo action fixtures without config validate.

Task 2: complete (commit 19d0e62, tests node --test tests/run.test.mjs)

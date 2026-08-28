# SDD ledger

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

Task 3: complete (commit 9a7c39c, tests node --test tests/adapters.test.mjs tests/collection.test.mjs tests/cli.test.mjs)

Task 4: complete (commit 05d09a6, tests node --test tests/skills-cli.test.mjs tests/collection.test.mjs)

Task 5: complete (commit 75aa2aa, tests node --test tests/demo-adapter.test.mjs && node bin/agentfolio.mjs verify --collection examples/demo-collection)

Task 6: complete (commit 725d822, tests node --test tests/cli.test.mjs)

Ruling: static target-name scans exclude docs/superpowers because the binding retained plan/spec explicitly quote excluded names as requirements; public documentation and source are covered by the same scan. Regression coverage: CLI help assertions reject target-specific terms.

Task 7: complete (commit 62c946d, tests node --test tests/scripts.test.mjs && npm run check:dependencies && npm run check:secrets && npm run package:smoke)

Ruling: dependency-policy lifecycle diagnostic remains the plan's exact `is disallowed` message; its regression assertion checks that required wording rather than the contradictory `lifecycle` substring.

Task 8: complete (commit 5ca7612, tests git diff --check && npm ci --ignore-scripts && npm run check:dependencies && npm run check:secrets && npm test && npm run package:smoke)

Follow-up adapter declaration migration: complete (commit 27f0075, tests npm test && npm run check:dependencies && npm run check:secrets && npm run package:smoke && git diff --check)

Ruling: The approved cross-repository adapter contract supersedes the retained full-polish plan's adapter `command` declaration. This is a clean break: adapters require `executable` plus `args`; `command` is rejected rather than read as a compatibility alias. Regression coverage: schema rejects command and malformed executable/args, while adapter integration executes the internally constructed literal argv.

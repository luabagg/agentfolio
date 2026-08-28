# Full-polish implementation report

## Commit range

`44a4c52..HEAD` (inclusive; task commits are listed below).

## Changes by task

1. **`44a4c52 test(schema): enforce safe collection boundaries`** — `.superpowers/sdd/2026-08-28-full-polish/progress.md`, `src/lib/collection.mjs`, `src/lib/schema.mjs`, `tests/collection.test.mjs`, `tests/schema.test.mjs`. Added strict nested schema allowlists, sensitive-key rejection, safe relative paths, and collection-root path containment.
2. **`e7f10ca feat(core): centralize safe process execution`** — progress ledger, `src/lib/run.mjs`, `tests/run.test.mjs`. Added literal argv process execution, fixed-size captures, timeout reporting, inherited-environment redaction, and recursive redaction helpers.
3. **`c74e617 feat(adapters): validate and redact responses`** — progress ledger, adapter/apply implementation and adapter/collection fixture tests. Added protocol response allowlists, JSON-safe doctor checks, redacted failures, and Agentfolio-owned apply identities.
4. **`f4c1981 fix(skills): pin local skills cli execution`** — progress ledger, package manifest/lock, Skills backend, apply/doctor, and Skills/collection tests. Pinned `skills@1.5.23`; plans and applies now share one package-owned argv.
5. **`bcfde3a docs(example): add non-mutating generic adapter`** — progress ledger, demo collection/script/readme, and demo/CLI/collection tests. Added a neutral protocol adapter that reports only and does not import filesystem APIs.
6. **`a85370d docs: clarify collection and adapter boundaries`** — progress ledger, public docs, init scaffold, help, package metadata, and CLI tests. Documented collection discovery, trust, argv execution, credential policy, pinned Skills behavior, and dry-run behavior.
7. **`99b1db1 ci: verify package dependencies and secrets`** — CI workflow, progress ledger, policy/scanner scripts, package smoke and script tests, and package scripts.
8. **`fix: address full-polish review finding`** — progress ledger, implementation report, plan/apply/doctor redaction, and adapter fixture/tests. Review correction redacts configured adapter command values before plans, reports, or doctor details expose them.

## Test evidence

Final validation passed after the review correction:

- `git diff --check`
- `npm ci --ignore-scripts`
- `npm run check:dependencies`
- `npm run check:secrets`
- `npm test` — 61 passing tests
- `npm run package:smoke`
- `node --test tests/adapters.test.mjs` — 8 passing tests
- JSON dry-run demo apply asserted adapter executor and dry-run fields, with no redaction marker in normal output.
- Static checks confirmed no `runCommand` in adapters and `shell: false` in the process boundary.
- `npm pack --dry-run` confirmed the published file set contains `bin`, `src`, `docs`, `examples`, README, and LICENSE.

## Rulings

- `action.config` is optional because the required demo action in the approved plan omits it. If present it must be a mapping, maintaining the opaque-payload boundary.
- Target-name static scans exclude `docs/superpowers`. The retained binding plan and specification explicitly quote the excluded names as requirements; public docs and source are scanned.
- The dependency-policy lifecycle regression checks the specified `is disallowed` diagnostic rather than the plan's contradictory `lifecycle` substring.

## Residual risks

- The retained binding plan/spec are packaged under `docs/superpowers` and intentionally contain target-name references required to state exclusions. They are excluded from the public-code static scan under the recorded ruling.
- Adapter execution intentionally grants collection code execution authority; users must trust collections before running plan, apply, doctor, or verify.

## Follow-up: adapter executable/args contract

`27f0075 fix(adapters): use executable and args declarations` replaces collection adapter `command` arrays with required `executable` and `args` fields. Schema rejects legacy `command` with no compatibility reader. Adapter execution constructs `[executable, ...args]` and continues through `runProcess` with `shell: false`; doctor checks and displays the executable declaration. The demo, scaffold guidance, public docs, fixtures, and integration tests use the new declaration.

Follow-up validation passed: `npm test` (61 tests), `npm run check:dependencies`, `npm run check:secrets`, `npm run package:smoke`, and `git diff --check`.

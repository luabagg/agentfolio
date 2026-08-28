# Full-polish implementation plan

> **For implementation:** use the writing-plans workflow: execute tasks in order, run each listed verification command, commit each task with the stated conventional commit, then perform the self-review task before merge.

**Spec:** [2026-08-28-full-polish-design.md](../specs/2026-08-28-full-polish-design.md)

**Goal:** turn the current generic adapter refactor into a safe public collection CLI with a strict argv execution boundary, validated/redacted adapter protocol, pinned Skills CLI, neutral example, and release-quality checks.

**Global constraints:** Clean break only. Keep `COLLECTION_SCHEMA_VERSION = 1`; do not read legacy fields. Agentfolio must not contain Pi, Cursor, provider, model, systemd, or home-target knowledge. A package repository root is not a collection unless it contains `collection.yaml`. All adapter calls are literal executable+argv with `shell: false`; never construct a shell command. Never accept, persist, fixture, log, display, or return credential values. Child processes inherit existing environment/keychain authentication. Do not add a migration, registry, auto-discovery, target implementation, or speculative schema.

## Task 1 — Lock down collection/schema and discovery contracts

**Files:** `src/lib/schema.mjs`, `src/lib/collection.mjs`, `src/lib/profiles.mjs`, `tests/schema.test.mjs`, `tests/collection.test.mjs`

1. Write failing table-driven tests in `tests/schema.test.mjs` for absolute/traversing `skills.local`, `skills.imports`, `tools.catalog`, and adapter argv entries; for sensitive schema keys anywhere under known configuration; and for generic opaque action fields remaining valid when non-sensitive.
2. Add failing `tests/collection.test.mjs` cases proving `findCollectionRoot()` succeeds only for explicit/env/ancestor `collection.yaml`, never treats the CLI checkout as a collection, and rejects resolved collection-relative paths outside `root`.
3. In `src/lib/schema.mjs`, add reusable `isSafeRelativePath()` and `containsSensitiveKey()` validation. Require declared paths to be non-empty relative paths that do not resolve above root; reject sensitive key names recursively in collection-owned values while retaining generic action payloads.
4. In `src/lib/collection.mjs`, make `resolveCollectionPath(root, relative)` throw for absolute or escaping paths and return only a path under `root`; make all callers use this contract. Keep `findCollectionRoot()` discovery order exactly explicit flag, environment variable, ancestor walk.
5. Verify: `npm test -- --test-name-pattern='schema|collection'` passes.
6. Commit: `test(schema): enforce safe generic collection boundaries`.

## Task 2 — Centralize literal process execution and redaction

**Files:** `src/lib/run.mjs`, `tests/run.test.mjs`

1. Add failing `tests/run.test.mjs` with a small generated Node child script. Cover: valid literal argv preserves `literal&value`; empty/non-string argv rejects before spawn; no `shell` option is used; nonzero exit; nonexistent executable; timeout; capped stdout/stderr; sensitive sentinel (`AGENTFOLIO_TEST_TOKEN=sentinel-secret-42`) never appears in returned safe fields/errors; and an ordinary inherited environment variable reaches the child.
2. Replace the current `runArgv()`/format-only split with a centralized `runProcess(argv, options)` that validates argv, always calls `spawnSync(argv[0], argv.slice(1), { shell: false, ... })`, applies a default/max timeout and output cap, and returns a normalized safe result `{ status, stdout, stderr, error, timedOut }`.
3. Add exported `redactText()` and `redactValue()` to remove sensitive keyed values and bearer/assignment forms using `[REDACTED]`; redact before every result/error leaves `run.mjs`. Do not mutate `process.env` or filter it before spawn.
4. Retain a narrowly named Skills-only launcher helper for `.cmd` compatibility, but do not route adapters through it and do not expose shell command-line input.
5. Verify: `node --test tests/run.test.mjs` passes.
6. Commit: `feat(core): centralize safe process execution`.

## Task 3 — Make adapter protocol validation strict and safe

**Files:** `src/lib/adapters.mjs`, `src/lib/plan.mjs`, `src/lib/apply.mjs`, `src/lib/doctor.mjs`, `tests/adapters.test.mjs`, `tests/fixtures/harness-adapter.mjs`

1. Add failing fixture modes/tests for extra response fields, nested sensitive `detail`, malformed `error`, oversized/multiple stdout JSON, start failure, timeout, and a spoofed adapter-owned identity. Assert every thrown/displayed value is redacted and Agentfolio-owned `kind`, `adapter`, `harness`, `action`, and `dryRun` cannot be overwritten.
2. In `src/lib/adapters.mjs`, invoke only `runProcess(adapter.command, { cwd: collection.root, input, timeout })`; never call `runCommand`. Parse exactly one capped stdout JSON object, validate `ok`, operation-specific allowed fields, scalar types, bounds, doctor checks, and recursively safe `detail`; reject unrecognized fields rather than forwarding them.
3. Return a newly constructed safe response object, not parsed response spread. Classify timeout, spawn, exit, JSON, protocol, and `ok: false` errors with contextual-but-redacted messages.
4. In `src/lib/plan.mjs`, `src/lib/apply.mjs`, and `src/lib/doctor.mjs`, construct result/check objects field-by-field, redact formatter output, and preserve action order. Do not include raw `stdout`/`stderr` in plan/apply JSON or text.
5. Verify: `node --test tests/adapters.test.mjs tests/cli.test.mjs` passes.
6. Commit: `feat(adapters): validate and redact protocol responses`.

## Task 4 — Pin and isolate Skills CLI behavior

**Files:** `package.json`, `package-lock.json`, `src/backends/skills-cli.mjs`, `src/lib/doctor.mjs`, `tests/skills-cli.test.mjs`, `tests/cli.test.mjs`

1. Add failing tests that planned and applied local-skills argv are identical; that the executable resolves to the installed local Skills CLI rather than `npx --yes`; that doctor probes `skills --version` through that same local executable; and that no generated command contains a credential sentinel.
2. Add direct dependency `"skills": "1.5.23"` to `package.json`, run `npm install --package-lock-only`, and invoke the package's local binary through `node_modules/.bin/skills` (with the isolated Windows shim only if required by Task 2).
3. In `src/backends/skills-cli.mjs`, build one `skillsCommand()` argv for `skills add`; reuse it in plan and apply. Preserve supported `local`, `scope`, `agents`, and `copy` flags. Do not run an install/update command and keep `imports` reference-only.
4. In `src/lib/doctor.mjs`, replace the npx/network probe with existence and `--version` checks for the pinned local binary using safe process execution.
5. Verify: `npm test -- --test-name-pattern='skills|doctor|plan|apply'` passes and `npm ls skills --depth=0` reports `skills@1.5.23`.
6. Commit: `fix(skills): pin local skills cli execution`.

## Task 5 — Ship a realistic, non-mutating generic collection example

**Files:** `examples/demo-collection/collection.yaml`, `examples/demo-collection/scripts/demo-adapter.mjs`, `examples/demo-collection/README.md`, `tests/demo-adapter.test.mjs`

1. Add failing `tests/demo-adapter.test.mjs` that executes the demo adapter with literal Node argv for `plan`, `apply` both dry-run values, and `doctor`; assert protocol-valid responses, a neutral `configure-project` action, and no file-tree change before/after each invocation.
2. Replace the skills-only `examples/demo-collection/collection.yaml` with generic `skills`, adapter `command: [node, ./scripts/demo-adapter.mjs]`, one neutral harness/action, and profiles `default`, `skills`, and `catalog`. Keep all paths collection-relative.
3. Add `examples/demo-collection/scripts/demo-adapter.mjs`: read one request, validate only enough protocol input for the example, write diagnostics only to stderr, and report the intended project-local configuration change without writing anything. Its `apply` response must set `changed: false` when `dryRun` and describe the non-mutating demonstration when not dry-run.
4. Add a concise example README explaining that adapters are trusted collection code and that this adapter deliberately does not mutate.
5. Verify: `node --test tests/demo-adapter.test.mjs && node bin/agentfolio.mjs verify --collection examples/demo-collection` passes without modifying `examples/demo-collection`.
6. Commit: `docs(example): add non-mutating generic adapter`.

## Task 6 — Align user documentation, scaffold, CLI text, and metadata

**Files:** `README.md`, `docs/architecture.md`, `docs/collection-schema.md`, `src/commands/init.mjs`, `bin/agentfolio.mjs`, `package.json`, `tests/cli.test.mjs`

1. Add failing CLI/scaffold assertions that help and `init` say “collection”, explain `--collection`/root discovery, do not call the package a collection, avoid target/provider names, and do not emit credential-like values.
2. Rewrite README quick start and command docs around an external collection directory. Include an executable+argv adapter example, explicit no-shell/trust-boundary warning, credential inheritance/no-storage policy, pinned Skills CLI policy, and dry-run semantics.
3. Rewrite `docs/architecture.md` and `docs/collection-schema.md` to match Tasks 1–5 exactly: data flow, strict request/response shape, error categories, redaction, explicit root discovery, generic ownership, and exclusions. Remove stale npx/unbounded response claims.
4. Update `src/commands/init.mjs` and `bin/agentfolio.mjs` strings so the scaffold remains Skills-only but accurately explains that optional adapters are collection-owned executable code. Update package description/keywords to generic collection orchestration and remove stale harness/provider language.
5. Verify: `npm test -- --test-name-pattern='help|init|collection'` passes; `grep -RniE 'pi|cursor|provider|systemd|chezmoi' README.md docs src bin examples package.json` returns no matches.
6. Commit: `docs: clarify collection and adapter trust boundaries`.

## Task 7 — Add reproducible CI, package smoke, dependency policy, and secret scan

**Files:** `.github/workflows/ci.yml`, `scripts/check-dependencies.mjs`, `scripts/secret-scan.mjs`, `tests/package-smoke.test.mjs`, `package.json`, `.npmignore` (only if needed after pack inspection)

1. Add failing unit tests for the dependency-policy parser: allow exact versions and fail `^`, `~`, `*`, git/file/URL specs and lifecycle scripts (`preinstall`, `install`, `postinstall`). Add secret-scanner tests for a safe fixture, a prohibited high-entropy/assignment sentinel, and documented `[REDACTED]` placeholders.
2. Implement `scripts/check-dependencies.mjs` to read `package.json`, require every direct production dependency version to match an exact numeric semver, reject lifecycle install hooks, and exit nonzero with file/key diagnostics. `skills` and `yaml` must both satisfy it.
3. Implement `scripts/secret-scan.mjs` using only Node standard library: scan tracked files from `git ls-files`, ignore `node_modules`, lockfile integrity hashes, and the literal `[REDACTED]`, and fail on private-key headers, bearer values, or sensitive assignment values. It must print only file/line/rule, never the matching value.
4. Add `package-smoke` script/test that creates a temporary directory, runs `npm pack --json`, installs/extracts the tarball without lifecycle scripts, executes `agentfolio help`, and asserts the package contains bin/source/docs/example but no test fixtures or credential sentinel.
5. Add `.github/workflows/ci.yml` matrix `{20, current}`: checkout, setup-node, `npm ci --ignore-scripts`, `npm run check:dependencies`, `npm run check:secrets`, `npm test`, and `npm run package:smoke`. Keep CI network usage limited to dependency install; normal CLI tests must use fixtures.
6. Verify: `npm run check:dependencies && npm run check:secrets && npm test && npm run package:smoke` passes.
7. Commit: `ci: verify package dependencies and secrets`.

## Task 8 — Full verification and self-review

**Files:** all changed files; no production change unless a defect is found.

1. Run `git diff --check`, `npm ci --ignore-scripts`, `npm run check:dependencies`, `npm run check:secrets`, `npm test`, `npm run package:smoke`, and `git status --short`.
2. Inspect every changed file and the packed file list. Confirm adapter calls have no shell fallback, `runCommand` is not reachable from adapters, response fields are allowlisted, raw process streams are not displayed, sentinels are redacted in JSON/text, the demo does not mutate, and CI runs Node 20/current.
3. Re-run `grep -RniE 'pi|cursor|provider|systemd|chezmoi' README.md docs src bin examples package.json` and investigate any match; target-specific content is a blocker.
4. If verification changes files, add focused regression tests and commit `fix: address full-polish review findings`; otherwise make no empty commit.
5. Final expected result: clean working tree; all commands pass; each preceding task is independently reviewable in conventional commits.

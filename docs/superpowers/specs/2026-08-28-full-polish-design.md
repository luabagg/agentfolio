# Agentfolio full-polish design

## Decision

Agentfolio is a public, generic CLI for a **collection**: a directory explicitly identified by `collection.yaml`. It is not a collection itself, and its repository root is never implicitly treated as one. It coordinates generic skills and collection-owned adapter actions; it has no knowledge of any AI product, provider, model, service manager, home-directory target, or target-system convention.

This is a clean break. There are no compatibility aliases, migration readers, deprecation paths, release notes, or legacy schema support.

## Collection model and flow

`collection.yaml` remains schema version 1. Its generic vocabulary is `skills`, `tools`, `adapters`, `harnesses`, and `profiles`. The schema must recursively reject unknown keys in every known mapping and invalid paths/commands before execution; an action permits only `action`, optional `summary`, and a `config` mapping, whose generic payload is opaque after sensitive-key validation. `findCollectionRoot()` only accepts an explicit `--collection`, `AGENTFOLIO_COLLECTION`, or an ancestor that physically contains `collection.yaml`; the Agentfolio package root is not special.

A profile resolves to native Skills CLI work plus ordered harness actions. For each adapter action, `buildPlan()` constructs protocol-v1 input, invokes the adapter in `plan` mode, validates its response, and emits a plan. `applyCollection()` uses that plan ordering, invokes Skills CLI once where selected, and invokes each adapter in `apply` mode with the requested `dryRun` value. `runDoctor()` invokes each selected adapter once in `doctor` mode. Generic `action.config` payload fields are opaque and must be preserved unchanged.

Adapters are an executable trust boundary. `adapters.<id>.command` is a non-empty argv array, not a command line: Agentfolio executes `[executable, ...args]` with `shell: false`, collection root as cwd, one JSON request on stdin, one JSON object on stdout, and diagnostics on stderr. It must not add Windows `cmd.exe` fallback or any shell quoting path for adapter execution. Executing an adapter grants that collection code execution authority; users must trust a collection before running `plan`, `apply`, `doctor`, or `verify`.

## Execution, failures, and output

Create one centralized process facility in `src/lib/run.mjs` for literal argv validation/execution, bounded timeout, spawn failure classification, exit status, stdout/stderr normalization, and redaction. Both adapters and Skills CLI must use it; only the explicitly supported Skills CLI launcher may retain a platform shim if required, and that exception must be isolated from adapters.

The facility must reject malformed argv before spawn, kill timed-out children, and expose structured results/errors rather than composing shell strings. Caller-facing errors identify the operation and adapter/command but redact command arguments and captured output. Plan, apply, doctor, verify, and human/JSON formatters must consume already-redacted data and never print raw adapter stdout/stderr or secrets. Preserve enough safe metadata (status, action identity, summary, changed flag, checks) to diagnose failure.

Protocol responses are untrusted. Validate a response as a plain JSON object with `ok: boolean`; reject unknown/unsafe shapes as well as malformed advertised fields. Define exact operation-specific fields: `plan`/`apply` may return safe `summary`, `changed`, `status`, `command` argv, and `detail`; `doctor` additionally requires a bounded array of checks with string `id`, boolean `ok`, optional boolean `required`, and safe string `detail`. `ok: false`, non-zero exit, invalid JSON, excess output, timeout, and startup failure are distinct failures. Do not merge adapter-provided identity or execution fields into Agentfolio-owned result objects.

## Credentials and redaction

Collection schema, generated scaffolds, protocol requests, plans, reports, fixtures, examples, docs, and logs must never contain credential values. No `token`, `secret`, `password`, private key material, or API-key value field is accepted or persisted. Collection adapters may inherit the normal process environment and user keychain/auth state; Agentfolio neither discovers nor serializes them. Environment API keys remain usable because child process environment is inherited unchanged.

Redaction applies recursively to output and error text and to protocol-derived display data. It must remove values associated with case-insensitive sensitive keys (including token, secret, password, authorization, cookie, api key/key) and common bearer/key assignment forms, with a fixed replacement such as `[REDACTED]`. Keep raw values out of thrown messages and result objects wherever practical, cap captured streams, and test that injected sentinel credentials cannot appear in text or JSON output.

## Skills CLI

Skills support remains native and pinned: `package.json` must declare the selected Skills CLI version as an explicit dependency (not a floating `npx --yes skills` download), `src/backends/skills-cli.mjs` must invoke the installed package through an argv-safe Node entry point, and the planned command must exactly match the applied command. Keep the existing generic skill options only when supported by that pinned version. `doctor` probes that same pinned executable/version without installing or updating anything. Collection `skills.imports` remains reference-only until it has an executable, pinned contract; do not invent import installation behavior.

## Example and documentation

Replace the current skills-only demo with a generic, realistic, non-mutating adapter example under `examples/demo-collection/`: an adapter script reads protocol JSON and reports a plan/apply/doctor result for a neutral action such as writing a project-local configuration, but never writes files. Its collection uses a literal `node` argv command and a generic harness ID/action. No example names or text may reference Pi, Cursor, a provider, systemd, or home targets.

README, `docs/architecture.md`, `docs/collection-schema.md`, generated init README, CLI help, and package description/keywords must describe the collection boundary, argv-only executable boundary, adapter trust requirement, credential policy, pinned Skills CLI behavior, and `plan`/`apply --dry-run` semantics. Package metadata must remove stale harness/provider language and must accurately identify the repository as the CLI package, not an installable collection.

## Tests and CI

Extend existing Node test files and add focused tests as needed for schema rejection, discovery/root behavior, literal argv execution, timeout/start/exit errors, response validation, redaction (including JSON output), credential inheritance without logging, pinned Skills CLI command construction, and the non-mutating demo adapter. Add GitHub Actions CI for Node 20 and current Node: `npm ci`, tests, dependency-policy check, `npm pack --dry-run`/packed-package smoke, and a tracked-file secret scan. The dependency policy must fail floating direct dependencies and disallowed install-time execution. The secret scan must be deterministic and allow only documented non-secret fixture placeholders.

## Exclusions

Do not add provider integrations, model catalogs, target-specific adapters, configuration writers, credential managers, encrypted secret storage, environment-file loading, shell command support, adapter auto-discovery, collection registries, network installs during normal operation, migration compatibility, or generic plugin ecosystems. YAGNI applies: Agentfolio owns orchestration and safety; collections own target semantics.

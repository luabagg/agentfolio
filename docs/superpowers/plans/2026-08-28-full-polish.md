# Full-polish implementation plan

> **Required sub-skill:** Use the `agentic-workers` writing-plans sub-skill while implementing this plan; complete tasks in order and preserve their independently reviewable commits.

## Goal

Make Agentfolio a safe public CLI for generic external collections: strict executable-plus-argv adapter execution, validated and redacted protocol responses, pinned Skills CLI behavior, a non-mutating neutral adapter example, and reproducible Node 20/current CI. This is a clean v1 break with no migration support.

## Architecture

`bin/agentfolio.mjs` discovers and loads an external `collection.yaml`, then `src/lib/profiles.mjs` selects skills and ordered harness actions. `src/lib/plan.mjs`, `src/lib/apply.mjs`, and `src/lib/doctor.mjs` use `src/lib/adapters.mjs` for collection-owned adapters and `src/backends/skills-cli.mjs` for native skills. A new central `src/lib/run.mjs` boundary validates literal argv, runs processes with `shell: false`, bounds output/time, and redacts data before it crosses into reports. Collections own adapter semantics; Agentfolio owns generic schema, orchestration, protocol safety, and display.

## Tech Stack

Node.js ESM on Node 20 and current Node; built-in `node:test`, `node:assert/strict`, `node:child_process`, and `node:fs`; `yaml@2.9.0`; pinned `skills@1.5.23`; npm lockfile; GitHub Actions.

## Spec

[2026-08-28-full-polish-design.md](../specs/2026-08-28-full-polish-design.md)

## Global Constraints

- Keep `COLLECTION_SCHEMA_VERSION = 1`; reject legacy and unknown top-level fields.
- The Agentfolio package root is not a collection unless it physically has `collection.yaml`; discovery remains `--collection`, `AGENTFOLIO_COLLECTION`, then ancestor walk.
- Adapter commands are non-empty literal argv arrays executed with `shell: false`. Never pass adapter argv to `cmd.exe`, `sh`, string concatenation, or a quoting helper.
- Never accept, store, fixture, print, serialize, or return API keys, tokens, passwords, cookies, authorization values, or private keys. Inherited environment authentication and user keychains continue to work.
- Agentfolio must know nothing about Pi, Cursor, providers, models, systemd, or home-directory targets. Do not add registries, migration readers, target writers, auto-discovery, or network installation during normal CLI operation.
- Keep action payload semantics collection-owned and opaque except for recursively rejecting sensitive key names. Use only concrete paths and commands listed below.

---

### Task 1: Enforce collection-root, path, and credential-key schema boundaries

**Create:** none.

**Modify:** `src/lib/schema.mjs`, `src/lib/collection.mjs`, `tests/schema.test.mjs`, `tests/collection.test.mjs`.

**Test:** `tests/schema.test.mjs`, `tests/collection.test.mjs`.

**Interfaces Consumes:** `validateCollection(doc)`, `resolveCollectionPath(root, relative)`, and `findCollectionRoot(startDir, explicit)`.

**Interfaces Produces:** `isSafeRelativePath(value)`, `containsSensitiveKey(value)`, schema failures with existing `errors: string[]`, and collection-root-contained resolved paths.

- [ ] **Step 1: Add failing schema tests (2 minutes).** Append a `test("rejects escaping paths and sensitive configuration keys", ...)` in `tests/schema.test.mjs` that calls `validateCollection` with these exact values and assertions:

  ```js
  const result = validateCollection({
    name: "demo", version: 1,
    skills: { local: "../skills" },
    tools: { catalog: "/tmp/catalog.json" },
    adapters: { local: { command: ["node", "./adapter.mjs"] } },
    harnesses: { local: { adapter: "local", actions: [{ action: "configure", apiKey: "sentinel-secret-42" }] } },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("skills.local")));
  assert.ok(result.errors.some((error) => error.includes("tools.catalog")));
  assert.ok(result.errors.some((error) => error.includes("sensitive")));
  ```

  Run `node --test tests/schema.test.mjs`; expect **FAIL** because paths and action credential keys are currently accepted.

- [ ] **Step 2: Add failing discovery/path tests (2 minutes).** In `tests/collection.test.mjs`, create a temporary root with `mkdirSync(join(root, "child"), { recursive: true })`, write `collection.yaml`, then assert:

  ```js
  assert.equal(findCollectionRoot(join(root, "child")), root);
  assert.throws(() => resolveCollectionPath(root, "../escape"), /relative path/);
  assert.throws(() => resolveCollectionPath(root, "/tmp/escape"), /relative path/);
  ```

  Run `node --test tests/collection.test.mjs`; expect **FAIL** because `resolveCollectionPath()` currently permits both paths.

- [ ] **Step 3: Implement schema helpers and use them (4 minutes).** In `src/lib/schema.mjs`, add exact helpers before `validateSkills`:

  ```js
  export function isSafeRelativePath(value) {
    return typeof value === "string" && value.length > 0 && !value.startsWith("/")
      && !value.startsWith("\\") && !value.split(/[\\/]+/).includes("..");
  }
  export function containsSensitiveKey(value) {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, child]) =>
      /token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key/i.test(key)
      || containsSensitiveKey(child));
  }
  ```

  Replace the existing string-only checks for `skills.local`, `skills.imports`, and `tools.catalog` with `isSafeRelativePath`. In `validateHarnesses`, after checking each action mapping, add `if (containsSensitiveKey(action)) errors.push(`${actionPath} contains sensitive configuration key`);`.

- [ ] **Step 4: Contain collection paths (3 minutes).** In `src/lib/collection.mjs`, replace `resolveCollectionPath` with a check using `relative` from `node:path`:

  ```js
  export function resolveCollectionPath(root, value) {
    if (!value) return null;
    if (isAbsolute(value)) throw new Error("collection path must be relative");
    const path = resolve(root, value);
    if (relative(root, path).startsWith("..") || isAbsolute(relative(root, path))) {
      throw new Error("collection path must stay within collection root");
    }
    return path;
  }
  ```

  Add `relative` to the existing path import. Do not change `findCollectionRoot` ordering.

- [ ] **Step 5: Verify and commit (3 minutes).** Run `node --test tests/schema.test.mjs tests/collection.test.mjs`; expect **PASS**. Run `git diff --check`; expect no output. Commit exactly:

  ```bash
  git add src/lib/schema.mjs src/lib/collection.mjs tests/schema.test.mjs tests/collection.test.mjs
  git commit -m "test(schema): enforce safe collection boundaries"
  ```

### Task 2: Centralize literal process execution and redaction

**Create:** `tests/run.test.mjs`.

**Modify:** `src/lib/run.mjs`.

**Test:** `tests/run.test.mjs`.

**Interfaces Consumes:** adapter/Skills argv arrays and inherited `process.env`.

**Interfaces Produces:** `runProcess(argv, options)`, `redactText(value)`, `redactValue(value)`, and normalized `{ status, stdout, stderr, error, timedOut }` process results.

- [ ] **Step 1: Add process-boundary tests (4 minutes).** Create `tests/run.test.mjs` importing `{ redactText, redactValue, runProcess }` from `../src/lib/run.mjs`. Write a temp `child.mjs` that prints `process.argv.slice(2).join("|")`, `process.env.VISIBLE_VALUE`, and `process.env.AGENTFOLIO_TEST_TOKEN`. Assert:

  ```js
  const result = runProcess([process.execPath, child, "literal&value"], {
    env: { ...process.env, VISIBLE_VALUE: "visible", AGENTFOLIO_TEST_TOKEN: "sentinel-secret-42" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /literal&value\|visible/);
  assert.doesNotMatch(result.stdout, /sentinel-secret-42/);
  assert.throws(() => runProcess([]), /non-empty argv/);
  assert.equal(redactText("Bearer sentinel-secret-42"), "Bearer [REDACTED]");
  assert.deepEqual(redactValue({ apiKey: "sentinel-secret-42", ok: true }), { apiKey: "[REDACTED]", ok: true });
  ```

  Add a child mode that delays 200 ms and assert `runProcess([... , "sleep"], { timeout: 10 }).timedOut === true`. Run `node --test tests/run.test.mjs`; expect **FAIL** because these exports do not exist.

- [ ] **Step 2: Implement redaction helpers (3 minutes).** In `src/lib/run.mjs`, add:

  ```js
  const SENSITIVE_KEY = /token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key/i;
  export function redactText(value) {
    return String(value ?? "")
      .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
      .replace(/((?:token|secret|password|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  }
  export function redactValue(value) {
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(child)]));
    return typeof value === "string" ? redactText(value) : value;
  }
  ```

- [ ] **Step 3: Implement `runProcess` (4 minutes).** Validate `Array.isArray(argv)`, a non-empty first string, and every non-empty string part. Call `spawnSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], shell: false, maxBuffer: 64 * 1024, ...options })`. Return only redacted, capped strings and `timedOut: result.error?.code === "ETIMEDOUT"`; do not expose `spawnSync`’s raw object. Keep `runArgv` as `return runProcess(command, options)` for existing callers.

- [ ] **Step 4: Preserve the narrow Windows exception (2 minutes).** Keep `runCommand()` only for the existing Skills/command-existence compatibility path. Add a comment directly above it: `// Never use this shell-shim helper for collection adapters.` Do not change `runProcess` to call `runCommand`.

- [ ] **Step 5: Verify and commit (3 minutes).** Run `node --test tests/run.test.mjs`; expect **PASS**. Run `grep -n "shell: false" src/lib/run.mjs`; expect a `runProcess` match. Commit exactly:

  ```bash
  git add src/lib/run.mjs tests/run.test.mjs
  git commit -m "feat(core): centralize safe process execution"
  ```

### Task 3: Strictly validate adapter responses and prevent result spoofing

**Create:** none.

**Modify:** `src/lib/adapters.mjs`, `src/lib/plan.mjs`, `src/lib/apply.mjs`, `src/lib/doctor.mjs`, `tests/adapters.test.mjs`, `tests/fixtures/harness-adapter.mjs`.

**Test:** `tests/adapters.test.mjs`, `tests/cli.test.mjs`.

**Interfaces Consumes:** `runProcess`, protocol-v1 request from `adapterRequest`, and adapter stdout.

**Interfaces Produces:** allowlisted safe adapter responses and Agentfolio-owned apply/plan/doctor result identities.

- [ ] **Step 1: Add malformed-response fixture modes (3 minutes).** In `tests/fixtures/harness-adapter.mjs`, add modes `extra-field` and `secret-detail` that write respectively:

  ```js
  JSON.stringify({ ok: true, summary: "ok", executor: "spoofed" })
  JSON.stringify({ ok: true, detail: { token: "sentinel-secret-42" } })
  ```

  In `tests/adapters.test.mjs`, add `assert.throws(() => runAdapter(...), /unexpected field/)` and `assert.throws(() => runAdapter(...), /sensitive/)`. Run `node --test tests/adapters.test.mjs`; expect **FAIL** because unknown fields and sensitive `detail` are accepted.

- [ ] **Step 2: Require one safe response shape (4 minutes).** In `src/lib/adapters.mjs`, replace `runArgv` import with `runProcess` and import `containsSensitiveKey` from `./schema.mjs`. Define:

  ```js
  const RESPONSE_FIELDS = {
    plan: new Set(["ok", "summary", "changed", "status", "command", "detail"]),
    apply: new Set(["ok", "summary", "changed", "status", "command", "detail"]),
    doctor: new Set(["ok", "summary", "status", "detail", "checks"]),
  };
  ```

  After parsing, reject `Object.keys(response)` not in `RESPONSE_FIELDS[operation]`; reject `containsSensitiveKey(response.detail)`; retain the existing type checks and doctor checks. Invoke `runProcess(adapter.command, { cwd: collection.root, input: `${JSON.stringify(request)}\n`, timeout })`.

- [ ] **Step 3: Construct safe responses (3 minutes).** Replace `return response;` with a field-by-field object:

  ```js
  const safe = { ok: true };
  for (const key of RESPONSE_FIELDS[request.operation]) {
    if (key !== "ok" && response[key] !== undefined) safe[key] = response[key];
  }
  return safe;
  ```

  Ensure all failure detail uses `redactText` from `run.mjs`; do not include raw output in thrown messages.

- [ ] **Step 4: Prove apply identity cannot be overwritten (3 minutes).** Extend the existing fixture `spoof` case test in `tests/adapters.test.mjs` by calling `applyCollection(current, { dryRun: true })` and asserting:

  ```js
  assert.equal(report.results[0].executor, "adapter");
  assert.equal(report.results[0].adapter, "fixture");
  assert.equal(report.results[0].dryRun, true);
  ```

  In `src/lib/apply.mjs`, replace `{ ...response, kind: ... }` with `{ ok: response.ok, summary: ..., status: ..., changed: response.changed, kind: ..., executor: "adapter", adapter: ..., harness: ..., action: ..., command: ..., dryRun }`, deleting undefined optional fields afterward.

- [ ] **Step 5: Verify and commit (3 minutes).** Run `node --test tests/adapters.test.mjs tests/cli.test.mjs`; expect **PASS**. Commit exactly:

  ```bash
  git add src/lib/adapters.mjs src/lib/plan.mjs src/lib/apply.mjs src/lib/doctor.mjs tests/adapters.test.mjs tests/fixtures/harness-adapter.mjs
  git commit -m "feat(adapters): validate and redact responses"
  ```

### Task 4: Pin and locally execute Skills CLI

**Create:** none.

**Modify:** `package.json`, `package-lock.json`, `src/backends/skills-cli.mjs`, `src/lib/doctor.mjs`, `tests/skills-cli.test.mjs`.

**Test:** `tests/skills-cli.test.mjs`.

**Interfaces Consumes:** collection `skills` configuration and installed package binary.

**Interfaces Produces:** `skillsCommand()` literal argv, one pinned `skills@1.5.23` dependency, and doctor checks for that local command.

- [ ] **Step 1: Add pinned-command tests (3 minutes).** In `tests/skills-cli.test.mjs`, import `skillsCommand` and assert:

  ```js
  assert.deepEqual(skillsCommand(["add", "./skills", "--global"]), [
    process.platform === "win32" ? "node_modules/.bin/skills.cmd" : "node_modules/.bin/skills",
    "add", "./skills", "--global",
  ]);
  assert.equal(planSkills({ root: demoRoot, doc: { skills: { local: "./skills" } } })[0].command[0].includes("npx"), false);
  ```

  Run `node --test tests/skills-cli.test.mjs`; expect **FAIL** because `skillsCommand` does not exist and plans start with `npx`.

- [ ] **Step 2: Pin the direct dependency (2 minutes).** In `package.json`, add exactly `"skills": "1.5.23"` in `dependencies` beside `yaml`. Run `npm install --package-lock-only --ignore-scripts`; expect lockfile updates and no source-file changes.

- [ ] **Step 3: Build one reusable argv (4 minutes).** In `src/backends/skills-cli.mjs`, remove the `npx` import. Add:

  ```js
  const skillsBin = process.platform === "win32" ? "node_modules/.bin/skills.cmd" : "node_modules/.bin/skills";
  export function skillsCommand(args) { return [skillsBin, ...args]; }
  ```

  Build local action commands as `skillsCommand(["add", local ?? skills.local])`, then append existing scope/agent/skill/copy flags. Use that same `action.command` in `applySkills`; do not reconstruct a different command or use `npx --yes`.

- [ ] **Step 4: Probe the same binary (3 minutes).** In `src/lib/doctor.mjs`, replace `npx` imports/probe with `skillsCommand(["--version"])` and `runProcess`. Add check id `skills-cli` whose detail is `Skills CLI reachable via pinned local binary` on status 0. Keep the selected-profile gate; `catalog` must not probe it.

- [ ] **Step 5: Verify and commit (3 minutes).** Run `npm ls skills --depth=0`; expect `skills@1.5.23`. Run `node --test tests/skills-cli.test.mjs`; expect **PASS**. Commit exactly:

  ```bash
  git add package.json package-lock.json src/backends/skills-cli.mjs src/lib/doctor.mjs tests/skills-cli.test.mjs
  git commit -m "fix(skills): pin local skills cli execution"
  ```

### Task 5: Add the non-mutating generic adapter example

**Create:** `examples/demo-collection/scripts/demo-adapter.mjs`, `examples/demo-collection/README.md`, `tests/demo-adapter.test.mjs`.

**Modify:** `examples/demo-collection/collection.yaml`.

**Test:** `tests/demo-adapter.test.mjs`.

**Interfaces Consumes:** one protocol-v1 JSON request on stdin.

**Interfaces Produces:** one valid JSON plan/apply/doctor response, no filesystem mutation, and generic `configure-project` action semantics.

- [ ] **Step 1: Write the failing adapter integration test (4 minutes).** Create `tests/demo-adapter.test.mjs`. Snapshot `readdirSync(demoRoot, { recursive: true }).sort()` before execution, use `spawnSync(process.execPath, [adapter], { input: JSON.stringify(request), encoding: "utf8" })`, and assert:

  ```js
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.deepEqual(readdirSync(demoRoot, { recursive: true }).sort(), before);
  ```

  Test `operation: "plan"`, `operation: "apply", dryRun: true`, and `operation: "doctor"`. Run `node --test tests/demo-adapter.test.mjs`; expect **FAIL** because the script does not exist.

- [ ] **Step 2: Declare the generic adapter (2 minutes).** Replace `examples/demo-collection/collection.yaml` contents with a v1 mapping containing `skills`, `tools`, and:

  ```yaml
  adapters:
    demo:
      command: [node, ./scripts/demo-adapter.mjs]
  harnesses:
    project:
      adapter: demo
      actions:
        - action: configure-project
          summary: Report project configuration
  profiles:
    default: { skills: true, harnesses: [project] }
    skills: { skills: true, harnesses: [] }
    catalog: { skills: false, harnesses: [] }
  ```

- [ ] **Step 3: Implement non-mutation (4 minutes).** Create `examples/demo-collection/scripts/demo-adapter.mjs` with stdin parsing and exact operation branches:

  ```js
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  if (request.operation === "doctor") {
    process.stdout.write(JSON.stringify({ ok: true, checks: [{ id: "demo", ok: true, required: true, detail: "non-mutating adapter available" }] }));
  } else {
    process.stdout.write(JSON.stringify({ ok: true, summary: "Would configure project-local settings", changed: false, command: ["node", "./scripts/demo-adapter.mjs"] }));
  }
  ```

  Do not import `node:fs` or write any file.

- [ ] **Step 4: Document trust and dry-run behavior (2 minutes).** Create `examples/demo-collection/README.md` stating that the collection adapter is trusted executable code, receives JSON over stdin, and intentionally reports rather than writes project-local configuration. Include exact commands `node ../../bin/agentfolio.mjs plan --collection .` and `node ../../bin/agentfolio.mjs apply --dry-run --collection .`.

- [ ] **Step 5: Verify and commit (3 minutes).** Run `node --test tests/demo-adapter.test.mjs && node bin/agentfolio.mjs verify --collection examples/demo-collection`; expect **PASS** and no changed example files. Commit exactly:

  ```bash
  git add examples/demo-collection/collection.yaml examples/demo-collection/scripts/demo-adapter.mjs examples/demo-collection/README.md tests/demo-adapter.test.mjs
  git commit -m "docs(example): add non-mutating generic adapter"
  ```

### Task 6: Align CLI, scaffold, package metadata, and public docs

**Create:** none.

**Modify:** `README.md`, `docs/architecture.md`, `docs/collection-schema.md`, `src/commands/init.mjs`, `bin/agentfolio.mjs`, `package.json`, `tests/cli.test.mjs`.

**Test:** `tests/cli.test.mjs`.

**Interfaces Consumes:** CLI help text, init scaffold strings, schema/protocol implementation from Tasks 1–5.

**Interfaces Produces:** accurate root-discovery, trust-boundary, redaction, pinned-Skills documentation and neutral package metadata.

- [ ] **Step 1: Add failing user-facing assertions (3 minutes).** Extend `tests/cli.test.mjs` help test with:

  ```js
  assert.match(result.stdout, /external collection/i);
  assert.match(result.stdout, /argv/i);
  assert.match(result.stdout, /trust/i);
  assert.doesNotMatch(result.stdout, /pi|cursor|provider|systemd|chezmoi/i);
  ```

  Run `node --test tests/cli.test.mjs`; expect **FAIL** because current help lacks the required boundary language.

- [ ] **Step 2: Update exact CLI/scaffold strings (3 minutes).** In `bin/agentfolio.mjs`, change the help description to `Plan and apply generic external collections through trusted executable adapters.` Add to global options `--collection DIRECTORY     Collection root; package root is not a collection`. In `src/commands/init.mjs`, change scaffold README title to `# Agentfolio Collection` and add `This directory is a collection because it contains collection.yaml.` Keep init skills-only.

- [ ] **Step 3: Rewrite README and architecture (5 minutes).** In `README.md`, use `agentfolio init ./my-collection`, then explicitly `cd ./my-collection`; state root discovery order and that the CLI repository is not a collection. Include this adapter snippet and warning:

  ```yaml
  adapters:
    local:
      command: [node, ./scripts/adapter.mjs]
  ```

  State “Agentfolio executes this literal argv without a shell; running it trusts collection code.” In `docs/architecture.md`, document plan/apply/doctor flow, inherited auth/no credential storage, response allowlisting/redaction, and the no-target-knowledge boundary.

- [ ] **Step 4: Rewrite schema docs and metadata (4 minutes).** In `docs/collection-schema.md`, document safe relative paths, sensitive-key rejection, protocol response allowed fields, `doctor.checks`, and the pinned local Skills binary. In `package.json`, set description to `Safely plan and apply generic agent collections` and remove `workflow-adapters`, `harness`, and `agent-configuration` keywords; retain `agentfolio`, `agent-skills`, and `skills-cli`.

- [ ] **Step 5: Verify and commit (3 minutes).** Run `node --test tests/cli.test.mjs`; expect **PASS**. Run `grep -RniE 'pi|cursor|provider|systemd|chezmoi' README.md docs src bin examples package.json`; expect exit status 1 and no matches. Commit exactly:

  ```bash
  git add README.md docs/architecture.md docs/collection-schema.md src/commands/init.mjs bin/agentfolio.mjs package.json tests/cli.test.mjs
  git commit -m "docs: clarify collection and adapter boundaries"
  ```

### Task 7: Add CI, dependency policy, package smoke, and secret scan

**Create:** `.github/workflows/ci.yml`, `scripts/check-dependencies.mjs`, `scripts/secret-scan.mjs`, `tests/package-smoke.test.mjs`, `tests/scripts.test.mjs`.

**Modify:** `package.json`.

**Test:** `tests/scripts.test.mjs`, `tests/package-smoke.test.mjs`.

**Interfaces Consumes:** `package.json`, tracked files from `git ls-files`, npm tarball output.

**Interfaces Produces:** `check:dependencies`, `check:secrets`, `package:smoke` scripts and Node 20/current CI enforcement.

- [ ] **Step 1: Add failing policy/scanner tests (4 minutes).** Create `tests/scripts.test.mjs` that writes temp package JSON files and invokes the scripts with `spawnSync(process.execPath, [script, file])`. Assert `{"dependencies":{"yaml":"^2.9.0"}}` exits nonzero with `/exact/`; assert `{"scripts":{"postinstall":"x"}}` exits nonzero with `/lifecycle/`; write `API_KEY=sentinel-secret-42` and assert scanner exits nonzero while `API_KEY=[REDACTED]` exits 0. Run `node --test tests/scripts.test.mjs`; expect **FAIL** because scripts do not exist.

- [ ] **Step 2: Implement dependency policy (3 minutes).** Create `scripts/check-dependencies.mjs` reading `process.argv[2] ?? "package.json"`. Require each `dependencies` version to match `/^\d+\.\d+\.\d+$/`; reject `preinstall`, `install`, and `postinstall`; print only `package.json dependencies.<name> must use exact semver` or `package.json scripts.<name> is disallowed`; exit 1 on any error. Add `"check:dependencies": "node scripts/check-dependencies.mjs"` to `package.json`.

- [ ] **Step 3: Implement safe tracked-file scan (4 minutes).** Create `scripts/secret-scan.mjs` using `spawnSync("git", ["ls-files"], { encoding: "utf8", shell: false })`. Ignore `package-lock.json` integrity text and `[REDACTED]`; fail on `/-----BEGIN [A-Z ]*PRIVATE KEY-----/`, `/Bearer\s+[A-Za-z0-9._-]{12,}/i`, and `/(API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*(?!\[REDACTED\])[A-Za-z0-9._-]{12,}/i`. Print `${file}:${line}: secret-pattern` without captured values. Add `"check:secrets": "node scripts/secret-scan.mjs"`.

- [ ] **Step 4: Add package smoke (4 minutes).** Create `tests/package-smoke.test.mjs` that runs `npm pack --json`, parses `JSON.parse(result.stdout)[0].filename`, runs `tar -tf` on it, asserts `package/bin/agentfolio.mjs`, `package/src/lib/run.mjs`, and `package/docs/architecture.md` are present and `package/tests/fixtures/harness-adapter.mjs` is absent, then deletes the tarball in `finally`. Add `"package:smoke": "node --test tests/package-smoke.test.mjs"`.

- [ ] **Step 5: Add the exact CI matrix (3 minutes).** Create `.github/workflows/ci.yml`:

  ```yaml
  name: CI
  on: [push, pull_request]
  jobs:
    test:
      runs-on: ubuntu-latest
      strategy: { matrix: { node: [20, current] } }
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: ${{ matrix.node }}, cache: npm }
        - run: npm ci --ignore-scripts
        - run: npm run check:dependencies
        - run: npm run check:secrets
        - run: npm test
        - run: npm run package:smoke
  ```

- [ ] **Step 6: Verify and commit (4 minutes).** Run `node --test tests/scripts.test.mjs && npm run check:dependencies && npm run check:secrets && npm run package:smoke`; expect **PASS**. Commit exactly:

  ```bash
  git add .github/workflows/ci.yml scripts/check-dependencies.mjs scripts/secret-scan.mjs tests/package-smoke.test.mjs tests/scripts.test.mjs package.json
  git commit -m "ci: verify package dependencies and secrets"
  ```

### Task 8: Run full verification and perform self-review

**Create:** none.

**Modify:** only files needed to correct a verified defect, with a focused regression test in the appropriate existing test file.

**Test:** all `tests/**/*.test.mjs`, package smoke, policy, scan, and static boundary checks.

**Interfaces Consumes:** completed Tasks 1–7 and packaged repository contents.

**Interfaces Produces:** a clean tree and evidence that the generic/safe boundaries hold end to end.

- [ ] **Step 1: Run repository checks (4 minutes).** Execute:

  ```bash
  git diff --check
  npm ci --ignore-scripts
  npm run check:dependencies
  npm run check:secrets
  npm test
  npm run package:smoke
  ```

  Expect every command to exit 0. If any command fails, reproduce with its named test file before changing code.

- [ ] **Step 2: Run executable-boundary checks (3 minutes).** Execute:

  ```bash
  grep -n "runCommand" src/lib/adapters.mjs
  grep -n "shell: false" src/lib/run.mjs
  grep -RniE 'pi|cursor|provider|systemd|chezmoi' README.md docs src bin examples package.json
  ```

  Expect no `runCommand` match in `src/lib/adapters.mjs`, at least one `shell: false` match in `src/lib/run.mjs`, and no target-specific matches from the final grep.

- [ ] **Step 3: Inspect safe output behavior (3 minutes).** Execute the exact fixture test and JSON CLI check:

  ```bash
  node --test tests/adapters.test.mjs
  node bin/agentfolio.mjs apply --dry-run --json --collection examples/demo-collection
  ```

  Expect tests to pass and JSON containing `"executor": "adapter"`, `"dryRun": true`, and no `sentinel-secret-42` text.

- [ ] **Step 4: Review package contents and status (2 minutes).** Execute:

  ```bash
  npm pack --dry-run
  git status --short
  ```

  Expect package output to include `bin`, `src`, `docs`, `examples`, `README.md`, and `LICENSE`; expect no uncommitted files before any defect correction.

- [ ] **Step 5: Commit only an actual review correction (2 minutes).** If a check exposed a defect, add its regression assertion and commit exactly:

  ```bash
  git add -u
  git commit -m "fix: address full-polish review finding"
  ```

  If all checks pass, make no empty commit. End with `git status --short`; expect no output.

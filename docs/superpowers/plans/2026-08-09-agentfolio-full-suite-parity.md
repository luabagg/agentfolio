# Agentfolio Full Suite Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agentfolio fully replace the `agent-skills` CLI while `agent-skills` becomes a data-only Agentfolio collection.

**Architecture:** Agentfolio will load a version 2 collection, produce typed actions, filter them through profiles, and execute them through one state-aware engine. Core inventory planners will own skills, instructions, models, and harnesses. First-party integrations will own the Cursor bridge and Memory Palace configuration. The collection will contain policy and source files only; it will not contain executable setup scripts.

**Tech Stack:** Node.js 20+, ESM, Node test runner, YAML, skills-cli through `npx`, chezmoi, Pi CLI, systemd user services, and `jsonc-parser` for comment-preserving OpenCode configuration edits.

## Global Constraints

- Require Node.js `>=20`.
- Use ESM only.
- Use argv arrays for child processes. Do not execute collection-provided shell strings.
- Keep skills-cli as the skill transport. Do not reimplement skill installation.
- Keep chezmoi as the static file-placement backend.
- Preserve unrelated user configuration in JSON and JSONC files.
- Refuse to overwrite unmanaged files unless `--force` is present.
- Make `--dry-run` perform no file, package, service, or collection mutation.
- Stop on the first failed apply action.
- Keep credentials and private paths outside collection repositories.
- Make model discovery an explicit refresh operation. Normal apply must consume the committed lock.
- Record ownership for every non-chezmoi mutation.
- Remove stale managed values only when ownership is proven.
- Do not preserve the version 1 `plugins.backend: none` API. Agentfolio is not production-stable yet.
- Do not delete `agent-skills/scripts/` until the parity test and one real-machine apply pass.

---

## Source and Target Ownership

### Agentfolio product repository owns

```text
bin/agentfolio.mjs
src/actions/
src/backends/
src/commands/
src/harnesses/
src/integrations/
src/inventories/
src/lib/
tests/
docs/
```

### The `agent-skills` collection owns

```text
collection.yaml
AGENTS.global.md
skills/
curated-skills.json
curated-tools.json
harnesses/
chezmoi/
imports/
```

### The `agent-skills` collection must not own after cutover

```text
scripts/
tests/cli.test.mjs
package.json bin.agent-skills
agent-skills command routing
```

---

## Required Legacy Parity

| Legacy behavior | Agentfolio owner |
| --- | --- |
| Install local personal skills | `src/inventories/skills.mjs` |
| Install curated third-party skills | `src/inventories/skills.mjs` |
| List local, installed, curated, and plugin-reference skills | `src/inventories/skills.mjs` plus CLI |
| Update installed skills globally | `src/commands/update.mjs` |
| Install global instructions | `src/inventories/instructions.mjs` |
| Install Cursor agents | `src/harnesses/cursor.mjs` |
| Render and install OpenCode agents | `src/harnesses/opencode.mjs` |
| Merge OpenCode plugins and instructions | `src/harnesses/opencode.mjs` |
| Install Pi packages | `src/harnesses/pi.mjs` |
| Install Pi local extensions | `src/harnesses/pi.mjs` |
| Merge Pi model providers and Scope models | `src/harnesses/pi.mjs` |
| Install the catalog lock into Pi | `src/harnesses/pi.mjs` |
| Discover, validate, diff, and refresh models | `src/inventories/models.mjs` plus CLI |
| Configure and manage the Cursor ACP bridge | `src/integrations/cursor-bridge.mjs` |
| Configure the Memory Palace vault | `src/integrations/memory-palace.mjs` |
| Verify the complete collection | `src/lib/verify.mjs` |
| Apply subsets such as Pi catalog-only | profiles plus action scopes |

---

## Target `collection.yaml` Version 2

```yaml
name: personal-agent-skills
version: 2

skills:
  local: ./skills
  mode: symlink
  agents: [claude-code, codex, github-copilot, opencode, pi]
  imports:
    catalog: ./curated-skills.json

instructions:
  source: ./AGENTS.global.md
  targets: [codex, claude, copilot, opencode, pi]

models:
  policy: ./harnesses/catalog.yaml
  lock: ./harnesses/catalog.lock.json

harnesses:
  pi:
    manifest: ./harnesses/pi.json
  cursor:
    manifest: ./harnesses/cursor.json
  opencode:
    manifest: ./harnesses/opencode.json

integrations:
  cursorBridge:
    enabled: true
    manifest: ./harnesses/pi.json
  memoryPalace:
    enabled: true
    configPath: ~/.agents/memory-palace/config.json
    vaultEnv: MEMORY_PALACE_VAULT

tools:
  catalog: ./tools/catalog.json
  mode: reference

chezmoi:
  sourceDir: ./chezmoi
  destinationDir: ~

profiles:
  default:
    include:
      - skills.*
      - instructions.*
      - models.apply
      - harness.*
      - integration.*

  pi-catalog:
    include:
      - models.apply
      - harness.pi.models

  pi-no-bridge:
    include:
      - skills.*
      - instructions.*
      - models.apply
      - harness.pi.*
    exclude:
      - integration.cursor-bridge

  opencode-recommended:
    include:
      - instructions.opencode
      - harness.opencode.*
    options:
      enableRecommended: true
```

## Typed Action Contract

```js
/**
 * @typedef {object} Action
 * @property {string} id
 * @property {string} owner
 * @property {number} phase
 * @property {string} scope
 * @property {"command"|"managed-file"|"managed-symlink"|"json-merge"|"jsonc-merge"|"systemd-user-service"|"chezmoi"} kind
 * @property {string} summary
 * @property {object} desired
 * @property {boolean} [sensitive]
 */
```

Action phases are fixed:

```js
export const PHASE = Object.freeze({
  SKILLS_LOCAL: 10,
  SKILLS_IMPORTS: 20,
  INSTRUCTIONS: 30,
  CHEZMOI: 40,
  MODELS_APPLY: 50,
  HARNESSES: 60,
  INTEGRATIONS: 70,
  LOCAL_CONFIG: 80,
});
```

---

## File Structure

### Create in Agentfolio

```text
src/actions/constants.mjs
src/actions/executor.mjs
src/actions/handlers/chezmoi.mjs
src/actions/handlers/command.mjs
src/actions/handlers/json-merge.mjs
src/actions/handlers/jsonc-merge.mjs
src/actions/handlers/managed-file.mjs
src/actions/handlers/managed-symlink.mjs
src/actions/handlers/systemd-user-service.mjs
src/actions/profile.mjs
src/actions/state.mjs
src/actions/types.mjs
src/commands/models.mjs
src/commands/remove.mjs
src/commands/update.mjs
src/harnesses/cursor.mjs
src/harnesses/opencode.mjs
src/harnesses/pi.mjs
src/integrations/cursor-bridge.mjs
src/integrations/memory-palace.mjs
src/inventories/instructions.mjs
src/inventories/models.mjs
src/inventories/skills.mjs
src/lib/json-path.mjs
src/lib/jsonc.mjs
src/lib/verify.mjs
tests/actions-executor.test.mjs
tests/actions-profile.test.mjs
tests/actions-state.test.mjs
tests/full-suite.test.mjs
tests/harness-cursor.test.mjs
tests/harness-opencode.test.mjs
tests/harness-pi.test.mjs
tests/instructions.test.mjs
tests/integration-cursor-bridge.test.mjs
tests/integration-memory-palace.test.mjs
tests/models.test.mjs
tests/skills.test.mjs
tests/fixtures/full-suite-collection/
```

### Modify in Agentfolio

```text
bin/agentfolio.mjs
package.json
src/commands/init.mjs
src/lib/apply.mjs
src/lib/collection.mjs
src/lib/doctor.mjs
src/lib/plan.mjs
src/lib/schema.mjs
src/backends/chezmoi.mjs
src/backends/skills-cli.mjs
tests/cli.test.mjs
tests/collection.test.mjs
tests/schema.test.mjs
README.md
docs/architecture.md
docs/collection-schema.md
```

---

### Task 1: Define Collection Schema Version 2

**Files:**
- Modify: `src/lib/schema.mjs`
- Modify: `src/lib/collection.mjs`
- Modify: `src/commands/init.mjs`
- Modify: `tests/schema.test.mjs`
- Modify: `tests/collection.test.mjs`
- Modify: `docs/collection-schema.md`
- Create: `tests/fixtures/full-suite-collection/collection.yaml`

**Interfaces:**
- Consumes: parsed YAML object from `loadCollection()`
- Produces: `validateCollection(doc, root)` returning `{ ok, errors, warnings }`
- Produces: normalized version 2 collection data from `normalizeCollection(doc)`

- [ ] **Step 1: Write failing version 2 schema tests**

Add these cases to `tests/schema.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { validateCollection } from "../src/lib/schema.mjs";

const validV2 = {
  name: "full-suite",
  version: 2,
  skills: {
    local: "./skills",
    mode: "symlink",
    agents: ["claude-code", "codex", "github-copilot", "opencode", "pi"],
    imports: { catalog: "./curated-skills.json" },
  },
  instructions: {
    source: "./AGENTS.global.md",
    targets: ["codex", "claude", "copilot", "opencode", "pi"],
  },
  models: {
    policy: "./harnesses/catalog.yaml",
    lock: "./harnesses/catalog.lock.json",
  },
  harnesses: {
    pi: { manifest: "./harnesses/pi.json" },
    cursor: { manifest: "./harnesses/cursor.json" },
    opencode: { manifest: "./harnesses/opencode.json" },
  },
  integrations: {
    cursorBridge: { enabled: true, manifest: "./harnesses/pi.json" },
    memoryPalace: {
      enabled: true,
      configPath: "~/.agents/memory-palace/config.json",
      vaultEnv: "MEMORY_PALACE_VAULT",
    },
  },
  profiles: {
    default: { include: ["skills.*", "harness.*"] },
  },
};

test("accepts the full version 2 collection schema", () => {
  const result = validateCollection(validV2, "/tmp/full-suite");
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("rejects collection schema version 1", () => {
  const result = validateCollection({ name: "old", version: 1 }, "/tmp/old");
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("version must be 2"));
});

test("rejects unknown instruction targets", () => {
  const result = validateCollection({
    ...validV2,
    instructions: { source: "./AGENTS.global.md", targets: ["unknown"] },
  }, "/tmp/full-suite");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.includes("instructions.targets")));
});

test("rejects profiles without include entries", () => {
  const result = validateCollection({
    ...validV2,
    profiles: { empty: { include: [] } },
  }, "/tmp/full-suite");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.includes("profiles.empty.include")));
});
```

- [ ] **Step 2: Run the schema tests and confirm failure**

Run:

```bash
node --test tests/schema.test.mjs tests/collection.test.mjs
```

Expected: FAIL because version 2 fields are not accepted.

- [ ] **Step 3: Implement strict version 2 validation**

Implement these exported constants and functions in `src/lib/schema.mjs`:

```js
export const COLLECTION_VERSION = 2;
export const INSTRUCTION_TARGETS = new Set([
  "codex",
  "claude",
  "copilot",
  "opencode",
  "pi",
]);
export const SKILL_MODES = new Set(["symlink", "copy"]);

export function validateCollection(doc, root = process.cwd()) {
  const errors = [];
  const warnings = [];

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, errors: ["collection.yaml must contain a mapping"], warnings };
  }
  if (typeof doc.name !== "string" || doc.name.trim() === "") {
    errors.push("name is required");
  }
  if (doc.version !== COLLECTION_VERSION) {
    errors.push(`version must be ${COLLECTION_VERSION}`);
  }

  validateSkills(doc.skills, errors);
  validateInstructions(doc.instructions, errors);
  validateModels(doc.models, errors);
  validateHarnesses(doc.harnesses, errors);
  validateIntegrations(doc.integrations, errors);
  validateTools(doc.tools, errors);
  validateChezmoi(doc.chezmoi, errors);
  validateProfiles(doc.profiles, errors);

  return { ok: errors.length === 0, errors, warnings, root };
}
```

Use dedicated private validators. Reject unknown keys in each mapping. Require every configured path to be a non-empty string. Require profile patterns to match `^[a-z0-9.*-]+$`.

- [ ] **Step 4: Normalize defaults in `src/lib/collection.mjs`**

Add:

```js
export function normalizeCollection(doc) {
  return {
    ...doc,
    skills: doc.skills ? {
      mode: "symlink",
      agents: [],
      ...doc.skills,
    } : null,
    instructions: doc.instructions ? {
      targets: [],
      ...doc.instructions,
    } : null,
    integrations: doc.integrations ?? {},
    profiles: doc.profiles ?? {
      default: { include: ["*"] },
    },
    chezmoi: doc.chezmoi ? {
      destinationDir: "~",
      ...doc.chezmoi,
    } : null,
  };
}
```

Call `normalizeCollection()` after validation in `loadCollection()`.

- [ ] **Step 5: Update `agentfolio init` output**

Make `src/commands/init.mjs` create version 2 YAML with local skills, instructions, chezmoi, tools, and a default profile. Do not add Pi, Cursor, OpenCode, or integrations to a generic new collection.

- [ ] **Step 6: Run tests and confirm pass**

Run:

```bash
node --test tests/schema.test.mjs tests/collection.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schema.mjs src/lib/collection.mjs src/commands/init.mjs tests/schema.test.mjs tests/collection.test.mjs tests/fixtures/full-suite-collection/collection.yaml docs/collection-schema.md
git commit -m "feat(schema): define collection version 2"
```

---

### Task 2: Add Typed Actions and Profile Selection

**Files:**
- Create: `src/actions/types.mjs`
- Create: `src/actions/constants.mjs`
- Create: `src/actions/profile.mjs`
- Create: `tests/actions-profile.test.mjs`

**Interfaces:**
- Produces: `defineAction(value)`
- Produces: `matchesScope(pattern, scope)`
- Produces: `selectActions(actions, { profile, only, exclude, profiles })`
- Produces: `sortActions(actions)`

- [ ] **Step 1: Write failing profile tests**

Create `tests/actions-profile.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { matchesScope, selectActions, sortActions } from "../src/actions/profile.mjs";

const actions = [
  { id: "skills.local", phase: 10, scope: "skills.local" },
  { id: "models.apply", phase: 50, scope: "models.apply" },
  { id: "pi.models", phase: 60, scope: "harness.pi.models" },
  { id: "pi.packages", phase: 60, scope: "harness.pi.packages" },
  { id: "bridge", phase: 70, scope: "integration.cursor-bridge" },
];

const profiles = {
  "pi-catalog": {
    include: ["models.apply", "harness.pi.models"],
  },
  "pi-no-bridge": {
    include: ["harness.pi.*", "integration.*"],
    exclude: ["integration.cursor-bridge"],
  },
};

test("scope wildcard matches one or more suffix segments", () => {
  assert.equal(matchesScope("harness.pi.*", "harness.pi.models"), true);
  assert.equal(matchesScope("harness.pi.*", "harness.cursor.agents"), false);
  assert.equal(matchesScope("*", "skills.local"), true);
});

test("profile selects only declared scopes", () => {
  const selected = selectActions(actions, { profile: "pi-catalog", profiles });
  assert.deepEqual(selected.map((item) => item.id), ["models.apply", "pi.models"]);
});

test("exclude wins over include", () => {
  const selected = selectActions(actions, { profile: "pi-no-bridge", profiles });
  assert.deepEqual(selected.map((item) => item.id), ["pi.models", "pi.packages"]);
});

test("sortActions uses phase then id", () => {
  const sorted = sortActions([actions[4], actions[3], actions[0], actions[2]]);
  assert.deepEqual(sorted.map((item) => item.id), [
    "skills.local",
    "pi.models",
    "pi.packages",
    "bridge",
  ]);
});
```

- [ ] **Step 2: Run the profile test and confirm failure**

Run:

```bash
node --test tests/actions-profile.test.mjs
```

Expected: FAIL because the action modules do not exist.

- [ ] **Step 3: Implement action validation**

Create `src/actions/types.mjs` with `defineAction(value)`. Require `id`, `owner`, `phase`, `scope`, `kind`, `summary`, and `desired`. Reject unknown action kinds.

Use this exact kind set:

```js
export const ACTION_KINDS = new Set([
  "command",
  "managed-file",
  "managed-symlink",
  "json-merge",
  "jsonc-merge",
  "systemd-user-service",
  "chezmoi",
]);
```

- [ ] **Step 4: Implement profile selection**

Create `src/actions/profile.mjs`:

```js
export function matchesScope(pattern, scope) {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return scope.startsWith(pattern.slice(0, -1));
  }
  return pattern === scope;
}

export function sortActions(actions) {
  return [...actions].sort((left, right) =>
    left.phase - right.phase || left.id.localeCompare(right.id));
}

export function selectActions(actions, { profile = "default", only = [], exclude = [], profiles }) {
  const selectedProfile = profiles[profile];
  if (!selectedProfile) throw new Error(`Unknown profile: ${profile}`);
  const includes = only.length > 0 ? only : selectedProfile.include;
  const excludes = [...(selectedProfile.exclude ?? []), ...exclude];
  return sortActions(actions.filter((action) =>
    includes.some((pattern) => matchesScope(pattern, action.scope)) &&
    !excludes.some((pattern) => matchesScope(pattern, action.scope))));
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run:

```bash
node --test tests/actions-profile.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/actions tests/actions-profile.test.mjs
git commit -m "feat(actions): add typed actions and profiles"
```

---

### Task 3: Add Managed State and the Central Executor

**Files:**
- Create: `src/actions/state.mjs`
- Create: `src/actions/executor.mjs`
- Create: `src/actions/handlers/command.mjs`
- Create: `src/actions/handlers/managed-file.mjs`
- Create: `src/actions/handlers/managed-symlink.mjs`
- Create: `src/actions/handlers/chezmoi.mjs`
- Create: `tests/actions-state.test.mjs`
- Create: `tests/actions-executor.test.mjs`

**Interfaces:**
- Produces: `statePathFor(collection, env)`
- Produces: `loadState(collection, env)`
- Produces: `saveState(collection, state, env)`
- Produces: `executeActions(collection, actions, options)`
- Produces: `diffActions(collection, actions, options)`
- Produces: `removeStaleArtifacts(collection, activeActionIds, options)`

- [ ] **Step 1: Write failing state tests**

Create `tests/actions-state.test.mjs` with a temporary `XDG_STATE_HOME`. Verify:

```js
test("state path uses XDG_STATE_HOME and collection name", () => {
  const path = statePathFor(
    { root: "/tmp/demo", doc: { name: "personal-agent-skills" } },
    { XDG_STATE_HOME: "/tmp/state" },
  );
  assert.equal(path, "/tmp/state/agentfolio/personal-agent-skills/state.json");
});

test("missing state loads an empty versioned document", async () => {
  const state = await loadState(collection, env);
  assert.deepEqual(state, {
    version: 1,
    collection: "personal-agent-skills",
    artifacts: {},
  });
});
```

- [ ] **Step 2: Write failing managed-file executor tests**

Create `tests/actions-executor.test.mjs`. Test these cases:

1. Dry-run does not create the target.
2. First apply writes the target and records its SHA-256 digest.
3. Second apply reports `unchanged`.
4. A changed unmanaged target fails without `--force`.
5. A stale managed target is deleted only when its digest still matches state.
6. A modified stale target is retained and reported as drift.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
node --test tests/actions-state.test.mjs tests/actions-executor.test.mjs
```

Expected: FAIL because state and handlers do not exist.

- [ ] **Step 4: Implement state persistence**

Use this state shape:

```json
{
  "version": 1,
  "collection": "personal-agent-skills",
  "artifacts": {
    "instructions.codex": {
      "kind": "managed-file",
      "target": "/home/user/.codex/AGENTS.md",
      "digest": "sha256:...",
      "managedValues": []
    }
  }
}
```

Write state atomically through a sibling temporary file and `rename()`. Sort artifact keys before serialization.

- [ ] **Step 5: Implement managed-file ownership rules**

The handler must:

1. Calculate the desired content digest.
2. Treat a missing target as writable.
3. Treat a matching target as unchanged.
4. Treat a target recorded by the same action as managed.
5. Refuse to replace a different target unless `force` is true.
6. Create a timestamped backup before a forced replacement.
7. Return `{ status, changed, drift, artifact }` without writing during dry-run.

- [ ] **Step 6: Implement managed-symlink and command handlers**

The symlink handler must compare resolved source paths. The command handler must call the existing `runCommand()` with an argv array and return `formatCommandResult()` output. During dry-run it must return the printable command without spawning it.

- [ ] **Step 7: Implement the executor dispatch table**

Use:

```js
const HANDLERS = new Map([
  ["command", handleCommand],
  ["managed-file", handleManagedFile],
  ["managed-symlink", handleManagedSymlink],
  ["chezmoi", handleChezmoi],
]);
```

Add JSON and systemd handlers to this map in later tasks. The executor must stop after the first non-zero result.

- [ ] **Step 8: Run tests and confirm pass**

Run:

```bash
node --test tests/actions-state.test.mjs tests/actions-executor.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/actions tests/actions-state.test.mjs tests/actions-executor.test.mjs
git commit -m "feat(actions): add managed state and executor"
```

---

### Task 4: Refactor Plan, Apply, Diff, Remove, and CLI Selection

**Files:**
- Modify: `src/lib/plan.mjs`
- Modify: `src/lib/apply.mjs`
- Modify: `src/lib/doctor.mjs`
- Create: `src/commands/remove.mjs`
- Modify: `bin/agentfolio.mjs`
- Modify: `tests/cli.test.mjs`
- Create: `tests/plan-actions.test.mjs`

**Interfaces:**
- `buildPlan(collection, selection)` returns `{ actions, inventory, selection }`
- `applyCollection(collection, options)` executes the selected plan
- `diffCollection(collection, options)` diffs the selected plan
- `removeCollection(collection, options)` removes proven managed artifacts

- [ ] **Step 1: Write failing CLI tests**

Add tests for:

```bash
agentfolio plan --profile pi-catalog
agentfolio apply --only harness.pi.* --exclude harness.pi.packages --dry-run
agentfolio diff --profile default
agentfolio remove --dry-run
agentfolio update skills --dry-run
agentfolio models check
agentfolio models diff
agentfolio models refresh --dry-run
```

Reject these combinations:

```text
--only with an unknown scope
--profile with an unknown profile
--dry-run on models check
remove without --collection discovery
```

- [ ] **Step 2: Run CLI tests and confirm failure**

Run:

```bash
node --test tests/cli.test.mjs tests/plan-actions.test.mjs
```

Expected: FAIL because the new options and commands are absent.

- [ ] **Step 3: Make plan generation inventory-based**

In `src/lib/plan.mjs`, gather actions from these planners in this order:

```js
const planners = [
  planLocalSkills,
  planImportedSkills,
  planInstructions,
  planChezmoi,
  planModelApply,
  planPiHarness,
  planCursorHarness,
  planOpenCodeHarness,
  planCursorBridge,
  planMemoryPalace,
];
```

Flatten, validate through `defineAction()`, filter through `selectActions()`, and sort through `sortActions()`.

- [ ] **Step 4: Replace backend-specific apply sequencing**

Make `src/lib/apply.mjs` call `buildPlan()` once and pass the resulting actions to `executeActions()`. Remove hard-coded skills-then-chezmoi execution from this file.

- [ ] **Step 5: Add CLI selection parsing**

Support repeatable `--only <scope>` and `--exclude <scope>`. Support one `--profile <name>`. Forward the same selection object to plan, apply, diff, doctor, verify, and remove.

- [ ] **Step 6: Add remove semantics**

`agentfolio remove` must inspect state and remove only artifacts owned by the selected collection. It must not uninstall external skills or Pi packages in version 1 of removal. Report those command-owned resources as retained external resources.

- [ ] **Step 7: Run tests and confirm pass**

Run:

```bash
node --test tests/cli.test.mjs tests/plan-actions.test.mjs tests/actions-executor.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib src/commands/remove.mjs bin/agentfolio.mjs tests/cli.test.mjs tests/plan-actions.test.mjs
git commit -m "feat(cli): execute selected typed action plans"
```

---

### Task 5: Implement Complete Skills Management

**Files:**
- Create: `src/inventories/skills.mjs`
- Create: `src/commands/update.mjs`
- Modify: `src/backends/skills-cli.mjs`
- Modify: `bin/agentfolio.mjs`
- Create: `tests/skills.test.mjs`

**Interfaces:**
- Produces: `planLocalSkills(collection)`
- Produces: `planImportedSkills(collection)`
- Produces: `listSkills(collection, options)`
- Produces: `updateSkills({ dryRun })`

- [ ] **Step 1: Write failing local and imported skill tests**

Use a temporary catalog with one GitHub source and one plugin reference. Assert the exact local command:

```js
[
  npx,
  "--yes",
  "skills",
  "add",
  collection.root,
  "--global",
  "--agent", "claude-code",
  "--agent", "codex",
  "--agent", "github-copilot",
  "--agent", "opencode",
  "--agent", "pi",
  "--skill", "*",
  "--yes",
]
```

Assert the imported source command includes each selected `--skill`, `--agent`, optional `--full-depth`, and optional `--copy`.

- [ ] **Step 2: Run the skills test and confirm failure**

Run:

```bash
node --test tests/skills.test.mjs
```

Expected: FAIL because the inventory module does not exist.

- [ ] **Step 3: Port curated source selection**

Move the installable-source rules from `agent-skills/scripts/install-curated-skills.mjs` into `src/inventories/skills.mjs`:

```js
const INSTALLABLE_SOURCE_TYPES = new Set(["github", "git"]);

export function installableSources(catalog) {
  return (catalog.sources ?? []).filter((source) =>
    source.preferredInstall === "skills-cli" &&
    INSTALLABLE_SOURCE_TYPES.has(source.sourceType));
}
```

Keep `pluginReferences` list-only.

- [ ] **Step 4: Implement local and imported action planners**

Return one `command` action for local skills and one action per imported source. Use scopes `skills.local` and `skills.imports.<source-name>`.

- [ ] **Step 5: Implement skill update**

Use this command:

```js
[npx, "--yes", "skills", "update", "--global", "--yes"]
```

Expose it as `agentfolio update skills [--dry-run]`.

- [ ] **Step 6: Implement skill listing**

Support:

```bash
agentfolio list skills
agentfolio list skills --installed
agentfolio list skills --imports
agentfolio list skills --plugin-references
agentfolio list skills --json
```

Use `npx skills add <collection-root> --list` for local package discovery and `npx skills list --global` for installed state.

- [ ] **Step 7: Run tests and confirm pass**

Run:

```bash
node --test tests/skills.test.mjs tests/cli.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/inventories/skills.mjs src/commands/update.mjs src/backends/skills-cli.mjs bin/agentfolio.mjs tests/skills.test.mjs tests/cli.test.mjs
git commit -m "feat(skills): manage local curated and installed skills"
```

---

### Task 6: Add Instructions and Comment-Preserving Config Merges

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/inventories/instructions.mjs`
- Create: `src/lib/json-path.mjs`
- Create: `src/lib/jsonc.mjs`
- Create: `src/actions/handlers/json-merge.mjs`
- Create: `src/actions/handlers/jsonc-merge.mjs`
- Modify: `src/actions/executor.mjs`
- Create: `tests/instructions.test.mjs`
- Create: `tests/json-merge.test.mjs`
- Create: `tests/jsonc-merge.test.mjs`

**Interfaces:**
- Produces: `planInstructions(collection)`
- Produces: `applyJsonOperations(document, operations, ownership)`
- Produces: `applyJsoncOperations(text, operations, formattingOptions)`

- [ ] **Step 1: Add `jsonc-parser`**

Run:

```bash
npm install jsonc-parser
```

Expected: `package.json` and `package-lock.json` include `jsonc-parser`.

- [ ] **Step 2: Write failing instruction rendering tests**

Assert these desired contents:

```js
const source = "# Global instructions\n\nUse short sentences.\n";

assert.equal(renderInstructionTarget("codex", source), source);
assert.equal(renderInstructionTarget("claude-agents", source), source);
assert.equal(renderInstructionTarget("claude-wrapper", source), "@AGENTS.md\n");
assert.equal(renderInstructionTarget("copilot-agents", source), source);
assert.equal(
  renderInstructionTarget("copilot-wrapper", source),
  '---\napplyTo: "**"\n---\n\n# Global instructions\n\nUse short sentences.\n',
);
assert.equal(renderInstructionTarget("opencode", source), source);
assert.equal(renderInstructionTarget("pi", source), source);
```

- [ ] **Step 3: Write failing JSON and JSONC merge tests**

Cover:

1. Add an OpenCode `instructions` array entry without deleting comments.
2. Add plugin names without removing existing plugins.
3. Reconcile Pi `enabledModels` only for managed provider prefixes.
4. Add Pi package sources without deleting unrelated packages.
5. Remove stale managed array values while retaining user-owned values.
6. Add a provider object at `providers.cursor` without replacing other providers.

- [ ] **Step 4: Run tests and confirm failure**

Run:

```bash
node --test tests/instructions.test.mjs tests/json-merge.test.mjs tests/jsonc-merge.test.mjs
```

Expected: FAIL because the planners and handlers do not exist.

- [ ] **Step 5: Implement instruction actions**

Map target IDs to these paths:

```js
export function instructionTargets(home) {
  return {
    codex: `${home}/.codex/AGENTS.md`,
    "claude-agents": `${home}/.claude/AGENTS.md`,
    "claude-wrapper": `${home}/.claude/CLAUDE.md`,
    "copilot-agents": `${home}/.copilot/AGENTS.md`,
    "copilot-wrapper": `${home}/.copilot/instructions/global-agent.instructions.md`,
    opencode: `${home}/.config/opencode/AGENTS.md`,
    pi: `${home}/.pi/agent/AGENTS.md`,
  };
}
```

Produce managed-file actions with scopes `instructions.<target>`.

- [ ] **Step 6: Implement JSON operation semantics**

Support these operation forms:

```js
{ op: "set", path: ["providers", "cursor"], value: provider }
{ op: "add-array-values", path: ["packages"], values: ["npm:context-mode"] }
{ op: "reconcile-array-values", path: ["enabledModels"], managedPrefixes: ["cursor/"], values: ["cursor/auto"] }
{ op: "remove-array-values", path: ["plugin"], values: ["old-managed-plugin"] }
```

Record inserted or reconciled values under the action artifact’s `managedValues` field.

- [ ] **Step 7: Implement JSONC edits with `jsonc-parser`**

Use `modify()` and `applyEdits()` from `jsonc-parser`. Detect indentation and end-of-line style from the current file. Apply operations one at a time against the updated text so later edits use current offsets.

- [ ] **Step 8: Register JSON handlers in the executor**

Add `json-merge` and `jsonc-merge` to the dispatch map. Both handlers must create timestamped backups before a write and return no mutation during dry-run.

- [ ] **Step 9: Run tests and confirm pass**

Run:

```bash
node --test tests/instructions.test.mjs tests/json-merge.test.mjs tests/jsonc-merge.test.mjs tests/actions-executor.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/inventories/instructions.mjs src/lib/json-path.mjs src/lib/jsonc.mjs src/actions tests/instructions.test.mjs tests/json-merge.test.mjs tests/jsonc-merge.test.mjs
git commit -m "feat(config): manage instructions and structured config"
```

---

### Task 7: Port the Model Catalog into Agentfolio

**Files:**
- Create: `src/inventories/models.mjs`
- Create: `src/commands/models.mjs`
- Modify: `bin/agentfolio.mjs`
- Create: `tests/models.test.mjs`
- Create: `tests/fixtures/full-suite-collection/harnesses/catalog.yaml`
- Create: `tests/fixtures/full-suite-collection/harnesses/catalog.lock.json`

**Interfaces:**
- Produces: `validatePolicy(policy)`
- Produces: `validateLock(policy, lock)`
- Produces: `discoverProviders(policy, oldLock, dependencies)`
- Produces: `buildLock(policy, providerModels)`
- Produces: `expectedGeneratedTargets(collection, policy, lock)`
- Produces: `checkModels(collection)`
- Produces: `diffModels(collection)`
- Produces: `refreshModels(collection, { dryRun })`
- Produces: `planModelApply(collection)`

- [ ] **Step 1: Write failing catalog tests**

Port the catalog validation cases from `agent-skills/scripts/catalog.mjs`. Add deterministic dependency injection for:

```js
{
  fetchModels: async (providerId) => discoveredByProvider[providerId],
  listPiModels: async (providerId) => discoveredByProvider[providerId],
  now: () => "2026-08-09T00:00:00.000Z",
}
```

Test:

1. Policy digest stability.
2. Lock snapshot digest validation.
3. Exact selector resolution.
4. Numeric dotted `familyLatest` resolution.
5. Ambiguous latest candidate rejection.
6. Discovery fallback to an unchanged committed lock.
7. Refusal to bless fallback data when policy changed.
8. Generated Cursor provider content.
9. OpenCode role placeholder validation.
10. Refresh writes lock and generated targets atomically.

- [ ] **Step 2: Run the model tests and confirm failure**

Run:

```bash
node --test tests/models.test.mjs
```

Expected: FAIL because the model inventory is absent.

- [ ] **Step 3: Move catalog logic into focused exports**

Port these functions from `agent-skills/scripts/catalog.mjs` without behavior changes:

```text
assertKeys
assertId
validateModel
validatePolicy
sorted
canonical
digest
parseCompactNumber
titleFromId
applyMetadata
compareVersions
resolveSelectors
buildLock
validateLockSnapshots
validateLock
resolvedModelId
buildCursorProvider
```

Replace direct `repoRoot` usage with `collection.root`. Replace direct process calls with injected discovery dependencies.

- [ ] **Step 4: Implement model commands**

Expose:

```bash
agentfolio models check
agentfolio models diff
agentfolio models refresh
agentfolio models refresh --dry-run
```

`check` is offline. `diff` performs live discovery without writing. `refresh` performs live discovery and writes the lock and generated targets atomically.

- [ ] **Step 5: Implement model apply planning**

Normal apply must not discover models. It must validate the committed policy and lock, then produce actions used by Pi and OpenCode planners.

- [ ] **Step 6: Run tests and confirm pass**

Run:

```bash
node --test tests/models.test.mjs tests/cli.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/inventories/models.mjs src/commands/models.mjs bin/agentfolio.mjs tests/models.test.mjs tests/fixtures/full-suite-collection/harnesses
git commit -m "feat(models): add catalog check diff and refresh"
```

---

### Task 8: Implement the Complete Pi Harness

**Files:**
- Create: `src/harnesses/pi.mjs`
- Create: `tests/harness-pi.test.mjs`
- Modify: `src/lib/doctor.mjs`

**Interfaces:**
- Produces: `validatePiManifest(manifest, collection)`
- Produces: `planPiHarness(collection, context)`
- Produces scopes:
  - `harness.pi.models`
  - `harness.pi.packages`
  - `harness.pi.extensions`

- [ ] **Step 1: Write failing Pi harness tests**

Use a fixture manifest containing one package, one extension, one provider, and one catalog scope. Assert actions for:

1. Merge selected package sources into `~/.pi/agent/settings.json`.
2. Reconcile managed model prefixes in `enabledModels`.
3. Merge the generated Cursor provider into `~/.pi/agent/models.json`.
4. Install `catalog.lock.json` as a managed file.
5. Run `pi install npm:context-mode` only when the source is not already configured.
6. Install the extension source as a managed file.
7. Skip packages and extensions under profile `pi-catalog`.
8. Retain unrelated Pi settings, packages, providers, and enabled models.

- [ ] **Step 2: Run the Pi test and confirm failure**

Run:

```bash
node --test tests/harness-pi.test.mjs
```

Expected: FAIL because the Pi planner does not exist.

- [ ] **Step 3: Port manifest validation and selection**

Move these rules from `agent-skills/scripts/setup-pi.mjs`:

- Manifest version is `1`.
- Harness ID is `pi`.
- Package entries require `name`, `kind: pi-package`, `source`, and boolean `defaultEnabled`.
- Extension entries require `name`, `kind: local-extension`, `sourceFile`, `path`, and boolean `defaultEnabled`.
- Model providers require `name`, `sourceFile`, and boolean `defaultEnabled`.
- `settings.catalogScope` must reference the model policy.

- [ ] **Step 4: Produce structured actions**

Use JSON merge actions for settings and models. Use managed-file actions for extensions and the installed lock. Use command actions for missing packages. Resolve `~` against the executor home, not `process.env.HOME` captured at module load.

- [ ] **Step 5: Add Pi doctor checks**

Check:

```text
pi command exists
manifest exists
policy and lock pass offline validation
all selected extension source files exist
all selected provider source files exist
```

Do not require the Cursor bridge commands in the Pi harness doctor.

- [ ] **Step 6: Run tests and confirm pass**

Run:

```bash
node --test tests/harness-pi.test.mjs tests/models.test.mjs tests/json-merge.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/harnesses/pi.mjs src/lib/doctor.mjs tests/harness-pi.test.mjs
git commit -m "feat(pi): manage packages extensions and models"
```

---

### Task 9: Implement Cursor and OpenCode Harnesses

**Files:**
- Create: `src/harnesses/cursor.mjs`
- Create: `src/harnesses/opencode.mjs`
- Create: `tests/harness-cursor.test.mjs`
- Create: `tests/harness-opencode.test.mjs`
- Modify: `src/lib/doctor.mjs`

**Interfaces:**
- Produces: `planCursorHarness(collection, context)`
- Produces: `planOpenCodeHarness(collection, context)`
- Produces: `resolveOpenCodeRoleModel(policy, lock, role)`

- [ ] **Step 1: Write failing Cursor tests**

Assert:

1. Default-enabled agents are selected.
2. Symlink mode creates managed-symlink actions.
3. Copy mode creates managed-file actions.
4. Matching content is unchanged.
5. An unmanaged conflicting target fails without force.

- [ ] **Step 2: Write failing OpenCode tests**

Assert:

1. Agent templates render exactly one `{{catalogRole:<role>}}` placeholder.
2. The rendered model uses the policy provider’s OpenCode harness ID and lock selector.
3. Recommended agents and plugins are selected only when profile option `enableRecommended` is true.
4. Existing JSONC comments survive plugin and instruction changes.
5. Existing user plugin entries remain present.
6. Manual installer commands appear in plan output but are never executed.

- [ ] **Step 3: Run harness tests and confirm failure**

Run:

```bash
node --test tests/harness-cursor.test.mjs tests/harness-opencode.test.mjs
```

Expected: FAIL because the harness planners do not exist.

- [ ] **Step 4: Port Cursor agent installation rules**

Move normalization, content comparison, and selected-agent rules from `agent-skills/scripts/setup-cursor.mjs`. Produce scopes `harness.cursor.agents.<name>`.

- [ ] **Step 5: Port OpenCode rendering and selection rules**

Move these functions from `agent-skills/scripts/setup-opencode.mjs` into the new module:

```text
validateManifest
pluginsToEnable
agentsToInstall
resolvedRoleModel
renderAgentTemplate
```

Replace direct writes with managed-file and JSONC merge actions.

- [ ] **Step 6: Add OpenCode instruction registration**

Ensure the OpenCode config `instructions` array contains the managed `~/.config/opencode/AGENTS.md` path. Use the same JSONC merge action as plugin registration.

- [ ] **Step 7: Add doctor checks**

Check manifests, source templates, role selectors, generated lock data, and target configuration parseability. Report missing manual installers as informational checks.

- [ ] **Step 8: Run tests and confirm pass**

Run:

```bash
node --test tests/harness-cursor.test.mjs tests/harness-opencode.test.mjs tests/jsonc-merge.test.mjs tests/models.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/harnesses/cursor.mjs src/harnesses/opencode.mjs src/lib/doctor.mjs tests/harness-cursor.test.mjs tests/harness-opencode.test.mjs
git commit -m "feat(harnesses): manage Cursor and OpenCode"
```

---

### Task 10: Implement Cursor Bridge and Memory Palace Integrations

**Files:**
- Create: `src/integrations/cursor-bridge.mjs`
- Create: `src/integrations/memory-palace.mjs`
- Create: `src/actions/handlers/systemd-user-service.mjs`
- Modify: `src/actions/executor.mjs`
- Create: `tests/integration-cursor-bridge.test.mjs`
- Create: `tests/integration-memory-palace.test.mjs`

**Interfaces:**
- Produces: `planCursorBridge(collection, context)`
- Produces: `planMemoryPalace(collection, context)`
- Produces: `normalizeVaultPath(value, environment)`
- Produces: `validateVaultPath(path)`

- [ ] **Step 1: Write failing Cursor bridge tests**

Inject command discovery and service status. Assert actions for:

1. Install the exact configured OpenCursor npm package.
2. Create isolated OpenCursor configuration.
3. Create the Cursor auth-directory symlink.
4. Render the systemd unit with escaped environment values.
5. Install the refresh script with mode `0755`.
6. Reload and enable the service only when files or service state changed.
7. Bind only to the manifest’s `127.0.0.1` URLs.
8. Report missing `npm`, `npx`, `opencode`, `cursor-agent`, `curl`, or `systemctl` as doctor failures when the integration is enabled.

- [ ] **Step 2: Write failing Memory Palace tests**

Port cases for:

```text
Windows path under WSL
home-relative Linux path
missing directory
.obsidian marker
wiki plus raw markers
wiki plus AGENTS.md markers
wiki/index.md marker
config JSON content
```

The integration must use `config.vault`, then the configured `vaultEnv`, and never prompt.

- [ ] **Step 3: Run integration tests and confirm failure**

Run:

```bash
node --test tests/integration-cursor-bridge.test.mjs tests/integration-memory-palace.test.mjs
```

Expected: FAIL because the integrations do not exist.

- [ ] **Step 4: Port Cursor bridge behavior**

Move these behaviors from `agent-skills/scripts/setup-pi.mjs`:

```text
commandPath
replaceTemplate
systemdEnvironmentValue
commandSucceeds
symlinkMatches
packageParts
globalPackageMatches
OpenCursor installation
isolated config creation
Cursor auth symlink
service rendering
refresh script installation
service reload and restart
```

Convert every mutation into a typed action. The integration planner must not execute commands.

- [ ] **Step 5: Implement the systemd action handler**

The handler must:

1. Write the unit through managed-file semantics.
2. Run `systemctl --user daemon-reload` when unit content changed.
3. Run `systemctl --user enable <unit>` when not enabled.
4. Run `systemctl --user restart <unit>` when the unit changed or is inactive.
5. Perform no command during dry-run.

- [ ] **Step 6: Port Memory Palace behavior**

Move path normalization and vault-marker validation from `agent-skills/scripts/configure-memory-palace.mjs`. Write the managed configuration as:

```json
{
  "vaultPath": "/resolved/path",
  "configuredAt": "2026-08-09T00:00:00.000Z",
  "sourceInput": "original input"
}
```

Inject the clock for deterministic tests.

- [ ] **Step 7: Run integration tests and confirm pass**

Run:

```bash
node --test tests/integration-cursor-bridge.test.mjs tests/integration-memory-palace.test.mjs tests/actions-executor.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/integrations src/actions/handlers/systemd-user-service.mjs src/actions/executor.mjs tests/integration-cursor-bridge.test.mjs tests/integration-memory-palace.test.mjs
git commit -m "feat(integrations): add Cursor bridge and Memory Palace"
```

---

### Task 11: Add Full Doctor, Verify, Drift, and End-to-End Coverage

**Files:**
- Create: `src/lib/verify.mjs`
- Modify: `src/lib/doctor.mjs`
- Modify: `src/lib/plan.mjs`
- Modify: `bin/agentfolio.mjs`
- Create: `tests/full-suite.test.mjs`
- Populate: `tests/fixtures/full-suite-collection/`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/collection-schema.md`

**Interfaces:**
- Produces: `verifyCollection(collection, options)`
- Produces: stable machine-readable doctor and verify reports

- [ ] **Step 1: Build the full-suite fixture**

The fixture must contain:

```text
collection.yaml
AGENTS.global.md
skills/hello-skill/SKILL.md
curated-skills.json
curated-tools.json
harnesses/catalog.yaml
harnesses/catalog.lock.json
harnesses/pi.json
harnesses/pi/variants.ts
harnesses/pi/cursor-provider.json
harnesses/cursor.json
harnesses/cursor/agents/coder.md
harnesses/opencode.json
harnesses/opencode/agents/coder.md
chezmoi/dot_test/static.txt
vault/.obsidian/
```

Use fake executable scripts for `npx`, `pi`, `chezmoi`, `npm`, `opencode`, `cursor-agent`, `curl`, and `systemctl`. Each fake command must append its argv to a log file.

- [ ] **Step 2: Write the end-to-end test**

Use a temporary HOME and XDG state directory. Verify:

1. `plan --profile default --json` contains every expected scope.
2. `apply --dry-run` changes no file and runs no fake command.
3. First apply creates every managed artifact.
4. First apply invokes expected external commands in phase order.
5. Second apply is idempotent.
6. `diff` reports clean state after the second apply.
7. User-owned JSON and JSONC values remain present.
8. Removing a managed array value from the collection removes only that value.
9. Modifying a managed file produces drift and blocks removal.
10. `verify` fails when the model lock is stale.
11. `doctor` fails when a required enabled integration command is missing.
12. `remove --dry-run` changes nothing.

- [ ] **Step 3: Run the end-to-end test and confirm failure**

Run:

```bash
node --test tests/full-suite.test.mjs
```

Expected: FAIL until all report and drift paths are connected.

- [ ] **Step 4: Implement verify composition**

`verifyCollection()` must run:

```text
schema validation
offline model check
source path checks
manifest checks
selected command availability checks
plan generation
non-mutating action diff
```

Return `{ ok, checks, drift, plan }` under `--json`.

- [ ] **Step 5: Make doctor selection-aware**

Only require commands used by selected actions. For example, `--profile pi-catalog` must not require `systemctl` or `cursor-agent`.

- [ ] **Step 6: Run the complete Agentfolio test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Update documentation**

Document:

```text
version 2 schema
action phases
profiles and scope selection
state and ownership
model refresh versus apply
remove limitations
full agent-skills migration mapping
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/verify.mjs src/lib/doctor.mjs src/lib/plan.mjs bin/agentfolio.mjs tests/full-suite.test.mjs tests/fixtures/full-suite-collection README.md docs
git commit -m "test: verify full Agentfolio suite parity"
```

---

### Task 12: Migrate `agent-skills` and Remove the Legacy CLI

**Files in `agent-skills`:**
- Modify: `collection.yaml`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `chezmoi/` sources where wrappers are currently incorrect
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete: `scripts/cli.mjs`
- Delete: `scripts/install-agents.mjs`
- Delete: `scripts/install-curated-skills.mjs`
- Delete: `scripts/install-personal-skills.mjs`
- Delete: `scripts/setup-pi.mjs`
- Delete: `scripts/setup-cursor.mjs`
- Delete: `scripts/setup-opencode.mjs`
- Delete: `scripts/configure-memory-palace.mjs`
- Delete: `scripts/catalog.mjs`
- Delete: `scripts/lib/`
- Delete: `tests/cli.test.mjs`

**Interfaces:**
- Consumes: released or linked Agentfolio with all prior tasks
- Produces: a data-only collection that passes Agentfolio verify

- [ ] **Step 1: Convert `collection.yaml` to version 2**

Use the target schema in this plan. Keep all current paths repository-relative. Configure the existing local skill agents, curated catalog, instructions, model policy and lock, harness manifests, Cursor bridge, Memory Palace, tools catalog, and profiles.

- [ ] **Step 2: Correct instruction placement sources**

Ensure Agentfolio renders:

```text
~/.claude/CLAUDE.md containing @AGENTS.md
~/.copilot/instructions/global-agent.instructions.md with applyTo frontmatter
~/.config/opencode/opencode.jsonc instructions registration
```

Do not keep direct symlinks that produce the wrong wrapper content.

- [ ] **Step 3: Run collection verification from the `agent-skills` repository root**

Run:

```bash
agentfolio models check --collection .
agentfolio doctor --collection .
agentfolio verify --collection .
agentfolio plan --profile default --collection .
agentfolio apply --dry-run --profile default --collection .
```

Expected: all commands succeed. The dry-run lists local skills, curated skills, instructions, models, all harnesses, the Cursor bridge, and Memory Palace.

- [ ] **Step 4: Run safe subset applies**

Run:

```bash
agentfolio apply --profile pi-catalog --collection .
agentfolio apply --only instructions.* --collection .
agentfolio apply --only harness.cursor.* --collection .
agentfolio apply --only harness.opencode.* --collection .
```

Expected: each command changes only its selected scope.

- [ ] **Step 5: Run one real default apply**

Run:

```bash
agentfolio apply --profile default --collection .
agentfolio diff --profile default --collection .
```

Expected: apply succeeds and diff reports clean state.

- [ ] **Step 6: Verify installed behavior manually**

Check:

```text
Pi starts and loads packages, extensions, providers, and Scope models.
Cursor lists the managed user agents.
OpenCode lists rendered agents and preserved user plugins.
The Cursor bridge service is active and its health endpoint responds.
Memory Palace resolves the configured vault.
Claude, Codex, Copilot, OpenCode, and Pi load global instructions.
```

- [ ] **Step 7: Delete legacy implementation files**

Remove the files listed in this task. Remove the `agent-skills` bin entry and YAML dependency from `package.json`. Retain package metadata only if it still supports repository validation scripts. Otherwise remove `package.json` and `package-lock.json` together.

- [ ] **Step 8: Update repository documentation**

Replace every `agent-skills install`, `agent-skills setup`, `agent-skills models`, and `agent-skills config` example with its Agentfolio equivalent. State that the repository is a collection and Agentfolio is the required orchestrator.

- [ ] **Step 9: Run final verification**

Run in Agentfolio:

```bash
npm test
```

Run in `agent-skills`:

```bash
agentfolio verify --collection .
agentfolio plan --profile default --collection .
git grep -n "agent-skills \(install\|setup\|models\|config\)" -- ':!docs/archive/**'
```

Expected: tests and verification pass. The grep returns no active legacy command documentation.

- [ ] **Step 10: Commit Agentfolio**

```bash
git add .
git commit -m "feat: complete Agentfolio suite parity"
```

- [ ] **Step 11: Commit `agent-skills` cutover**

```bash
git add -A
git commit -m "refactor: make repository Agentfolio-only"
```

---

## Acceptance Criteria

- `agentfolio apply --profile default` replaces `agent-skills install all` plus all harness setup commands.
- `agentfolio apply --profile pi-catalog` replaces `agent-skills setup pi --catalog-only`.
- `agentfolio models check|diff|refresh` replaces the legacy model commands.
- `agentfolio update skills` replaces the legacy update command.
- Agentfolio preserves unrelated JSON and JSONC settings.
- Agentfolio detects drift for every managed non-chezmoi artifact.
- A second apply is idempotent.
- Dry-run performs no mutation or external install command.
- The full-suite test passes under a temporary HOME.
- A real-machine apply succeeds before legacy deletion.
- `agent-skills` contains policy and source data only after cutover.

## Self-Review

1. **Spec coverage:** Tasks 5 through 10 cover every legacy command and setup surface. Task 11 covers idempotency, drift, dry-run, and ownership. Task 12 covers cutover and deletion.
2. **Placeholder scan:** The plan contains no deferred implementation item. Every behavior has an owning task, target file, test command, and acceptance condition.
3. **Type consistency:** All planners return the `Action` contract. Selection uses `scope`. Ordering uses `phase`. State uses `action.id`. JSON ownership uses `managedValues`.
4. **Safety:** Collection code is never executed. External commands use argv arrays. Unmanaged files are protected. Secrets remain local.
5. **Migration safety:** Legacy code remains until Agentfolio tests and one real apply pass.

## Execution Handoff

Plan implementation should use one isolated Agentfolio worktree. Execute Tasks 1 through 11 in Agentfolio. Then execute Task 12 in a separate `agent-skills` worktree.

Recommended execution mode: **Subagent-Driven Development**, with one implementation subagent and one independent review gate per task.

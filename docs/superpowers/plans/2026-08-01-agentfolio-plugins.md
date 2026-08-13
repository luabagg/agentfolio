# Agentfolio Configurable Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agentfolio apply/plan/doctor extensible via configurable plugins so packages, Cursor bridge, curated skills, memory-palace config (and future setup) leave `agent-skills` CLI and live as collection-declared plugin steps.

**Architecture:** Keep core orchestration (skills-cli + chezmoi) as built-in backends. Replace today's inert `plugins: { backend: none }` with a **plugin registry**: each plugin is a module with `id`, schema validation, `plan()`, `apply()`, `doctor()`, and optional `diff()`. Collections declare plugin instances under `collection.yaml` → `plugins.entries[]`. First-party plugins ship in-repo under `src/plugins/`; unknown ids fail loudly unless `plugins.allowUnknown: true` (default false).

**Tech Stack:** Node.js ESM (existing Agentfolio), `yaml`, Node test runner, skills-cli via `npx`, chezmoi CLI, `pi install` for Pi packages, systemd user units for Cursor bridge.

## Global Constraints

- Node `>=20`; ESM only; no new runtime deps unless unavoidable.
- Chezmoi remains required for harness/instruction file placement.
- Skills transport stays `npx skills` (no reimplementation of skills-cli).
- Plugin apply is fail-fast and supports `--dry-run`.
- Secrets never written into the collection repo (auth stays in `~/.pi/agent/auth.json`, etc.).
- After plugins cover personal setup, `agent-skills` may shrink to a thin collection; do not delete legacy CLI until plugins verify on a real machine.
- Exact backend names and plugin ids use kebab-case strings.

---

## Spec (source of truth for this plan)

### Problem

Agentfolio v0.1 only applies:

1. local skills (`skills-cli`)
2. chezmoi file placement

`agent-skills` still owns:

| Surface | Legacy owner | Target plugin id |
| --- | --- | --- |
| Pi npm packages + local extensions | `setup-pi.mjs` + `harnesses/pi.json` | `pi-packages` |
| Cursor ACP bridge (open-cursor, systemd) | `setup-pi.mjs` `cursorBridge` | `cursor-bridge` |
| Curated third-party skills | `install-curated-skills.mjs` + `curated-skills.json` | `curated-skills` |
| Memory Palace vault config | `configure-memory-palace.mjs` | `memory-palace` |
| Model catalog Scope/lock (optional follow-on) | `catalog.mjs` | `model-catalog` (v2; out of critical path) |

### Target `collection.yaml` shape

```yaml
name: personal-agent-skills
version: 1

skills:
  backend: skills-cli
  local: ./skills

tools:
  backend: reference
  catalog: ./tools/catalog.json
  apply: reference

harnesses:
  - id: pi
    source: ./harnesses/pi
    backend: chezmoi
  - id: cursor
    source: ./harnesses/cursor
    backend: chezmoi
  - id: opencode
    source: ./harnesses/opencode
    backend: chezmoi

instructions:
  global: ./AGENTS.global.md
  backend: chezmoi

# NEW: real plugin system (replaces hint-only plugins mapping)
plugins:
  allowUnknown: false
  entries:
    - id: curated-skills
      enabled: true
      config:
        catalog: ./curated-skills.json
        # optional overrides:
        # copy: false
        # agents: [claude-code, codex, opencode, pi, github-copilot]

    - id: pi-packages
      enabled: true
      config:
        manifest: ./harnesses/pi.json
        # enableRecommended: false
        # skipPackages: false
        # skipLocalExtensions: false

    - id: cursor-bridge
      enabled: true
      config:
        manifest: ./harnesses/pi.json
        # skip: false
        # workspace: null   # else $PI_CURSOR_WORKSPACE or $HOME

    - id: memory-palace
      enabled: true
      config:
        # vault from env MEMORY_PALACE_VAULT if omitted
        # vault: /mnt/c/Users/.../obsidian-vault
        configPath: ~/.agents/memory-palace/config.json

chezmoi:
  sourceDir: ./chezmoi
```

### Plugin contract

Every plugin module exports:

```js
/**
 * @typedef {object} PluginContext
 * @property {string} root                 // collection root
 * @property {object} doc                  // parsed collection.yaml
 * @property {object} entry                // this plugins.entries[] item
 * @property {object} config               // entry.config (validated)
 * @property {boolean} dryRun
 * @property {(cmd: string[], opts?: object) => object} runCommand
 */

/**
 * @typedef {object} PlanAction
 * @property {string} kind                 // e.g. "plugin.pi-packages.install"
 * @property {string} backend              // plugin id
 * @property {string} summary
 * @property {string[] | null} command
 * @property {object} [detail]
 */

export const id = "pi-packages";
export const description = "Install Pi packages and local extensions from a harness manifest";

/** Validate entry.config; push strings onto errors/warnings arrays. */
export function validateConfig(config, { errors, warnings, root }) {}

/** @returns {PlanAction[]} */
export function plan(ctx) {}

/** @returns {Array<PlanAction & { status: number, stdout?: string, stderr?: string }>} */
export function apply(ctx) {}

/** @returns {Array<{ id: string, ok: boolean, required?: boolean, detail: string }>} */
export function doctor(ctx) {}
```

### Apply order (updated)

1. Validate collection + plugin configs
2. Built-in: local skills (`skills-cli`)
3. Plugin: `curated-skills` (external skill sources)
4. Built-in: chezmoi apply
5. Plugin: `pi-packages`
6. Plugin: `cursor-bridge`
7. Plugin: `memory-palace`
8. Tools remain reference-only

Order is fixed in core for v1 (deterministic). Later: optional `plugins.entries[].phase` if needed — YAGNI until then.

### Non-goals (this plan)

- Porting full OpenCode `opencode.jsonc` merge logic (chezmoi already places agents; jsonc merge can be a later `opencode-config` plugin).
- Replacing `catalog.mjs` model discovery in v1 (`model-catalog` plugin deferred).
- Marketplace / remote plugin install from npm in v1 (in-repo first-party plugins only).
- Deleting `agent-skills/scripts/*` in the same PR as the registry (separate strip PR after verification).

---

### Task 1: Plugin registry + schema

**Files:**
- Create: `src/plugins/types.mjs`
- Create: `src/plugins/registry.mjs`
- Create: `src/plugins/builtin.mjs` (re-export first-party plugins once they exist; empty map ok initially)
- Modify: `src/lib/schema.mjs`
- Modify: `docs/collection-schema.md`
- Modify: `docs/architecture.md`
- Test: `tests/schema.test.mjs`
- Test: `tests/plugins-registry.test.mjs`

**Interfaces:**
- Consumes: existing `validateCollection(doc)`
- Produces:
  - `loadPlugins()` → `Map<string, PluginModule>`
  - `getPlugin(id)` → module or throw
  - `validatePluginEntries(doc, root, errors, warnings)`
  - Schema accepts `plugins.entries` array; `plugins.backend: none` remains valid for backward compat (warn deprecated)

- [ ] **Step 1: Write failing schema tests**

```js
// tests/schema.test.mjs — add:
test("accepts plugins.entries with known ids after registry exists", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    plugins: {
      entries: [{ id: "memory-palace", enabled: true, config: {} }],
    },
  });
  // Until registry wires known ids, this may warn; after Task 1+memory stub, ok:true
  assert.equal(result.ok, true);
});

test("rejects unknown plugin id when allowUnknown is false", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    plugins: {
      allowUnknown: false,
      entries: [{ id: "does-not-exist", enabled: true, config: {} }],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("does-not-exist")));
});
```

- [ ] **Step 2: Run tests — expect FAIL** (unknown-id path / missing registry)

Run: `node --test tests/schema.test.mjs tests/plugins-registry.test.mjs`

- [ ] **Step 3: Implement registry + schema**

`src/plugins/registry.mjs` sketch:

```js
import * as curatedSkills from "./curated-skills.mjs";
import * as piPackages from "./pi-packages.mjs";
import * as cursorBridge from "./cursor-bridge.mjs";
import * as memoryPalace from "./memory-palace.mjs";

const BUILTIN = new Map([
  [curatedSkills.id, curatedSkills],
  [piPackages.id, piPackages],
  [cursorBridge.id, cursorBridge],
  [memoryPalace.id, memoryPalace],
]);

export function getPlugin(id) {
  const plugin = BUILTIN.get(id);
  if (!plugin) throw new Error(`Unknown plugin id: ${id}`);
  return plugin;
}

export function listPluginIds() {
  return [...BUILTIN.keys()].sort();
}
```

Update `validatePlugins` in `src/lib/schema.mjs`:

- If `plugins.entries` present: require array; each item needs `id: string`; `enabled` defaults true; `config` defaults `{}`.
- For each enabled entry: if `allowUnknown !== true` and id not in registry → error.
- Call `plugin.validateConfig(config, { errors, warnings, root })` when module exists.
- If only `plugins.backend: none` (old shape): keep accepting; push warning `"plugins.backend=none is deprecated; use plugins.entries"`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/plugins src/lib/schema.mjs docs/collection-schema.md docs/architecture.md tests/
git commit -m "feat(plugins): add registry and collection.entries schema"
```

---

### Task 2: Wire plugins into plan / apply / doctor / list

**Files:**
- Modify: `src/lib/plan.mjs`
- Modify: `src/lib/apply.mjs`
- Modify: `src/lib/doctor.mjs`
- Modify: `bin/agentfolio.mjs` (`list plugins` shows entries)
- Test: `tests/plan-plugins.test.mjs`

**Interfaces:**
- Consumes: `getPlugin`, `buildPlan` action list
- Produces: plan actions with `backend: <plugin-id>`; apply runs enabled plugins in fixed order after skills / around chezmoi as specified in Spec

- [ ] **Step 1: Failing test — plan includes plugin actions from fixture**

Create `tests/fixtures/plugin-collection/` with minimal `collection.yaml` declaring `memory-palace` only (stub returns one plan action).

```js
test("buildPlan includes enabled plugin actions", () => {
  const collection = loadCollection(fixtureRoot);
  const plan = buildPlan(collection);
  assert.ok(plan.actions.some((a) => a.backend === "memory-palace"));
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement orchestration**

In `plan.mjs`:

```js
function planPlugins(collection) {
  const entries = collection.doc.plugins?.entries ?? [];
  const actions = [];
  for (const entry of entries) {
    if (entry.enabled === false) continue;
    const plugin = getPlugin(entry.id);
    const ctx = makePluginContext(collection, entry, { dryRun: true });
    actions.push(...plugin.plan(ctx));
  }
  return actions;
}
```

Apply order helper in `apply.mjs`:

```js
const PLUGIN_ORDER = ["curated-skills", "pi-packages", "cursor-bridge", "memory-palace"];

function enabledPlugins(doc) {
  const entries = (doc.plugins?.entries ?? []).filter((e) => e.enabled !== false);
  return entries.sort(
    (a, b) => PLUGIN_ORDER.indexOf(a.id) - PLUGIN_ORDER.indexOf(b.id),
  );
}
```

Sequence: skills → curated-skills plugin → chezmoi → remaining plugins (`pi-packages`, `cursor-bridge`, `memory-palace`).

Doctor: run each enabled plugin's `doctor()` and merge checks.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(plugins): wire plan/apply/doctor to plugin registry"
```

---

### Task 3: Plugin `curated-skills`

**Files:**
- Create: `src/plugins/curated-skills.mjs`
- Test: `tests/plugins-curated-skills.test.mjs`
- Port behavior from: `agent-skills/scripts/install-curated-skills.mjs`

**Interfaces:**
- Consumes: `config.catalog` path (default `./curated-skills.json`), `runCommand`, `npx`
- Produces: one plan/apply action per installable source (`preferredInstall === "skills-cli"` and `sourceType` in `github|git`)

- [ ] **Step 1: Failing unit test with temp catalog**

```js
test("curated-skills plans npx skills add per source", () => {
  const actions = plan(makeCtx({
    catalog: tempCatalogPath, // one github source, skills: ["caveman"]
  }));
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].command.slice(0, 5), ["npx", "--yes", "skills", "add", "obra/superpowers"]);
});
```

(Use a tiny fixture catalog, not the full personal file.)

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement** — mirror legacy loop:

```js
const command = [
  npx, "--yes", "skills", "add", source.source,
  "--global",
  ...agents.flatMap((a) => ["--agent", a]),
  ...source.skills.flatMap((s) => ["--skill", s]),
  "--yes",
];
if (source.fullDepth) command.push("--full-depth");
if (config.copy) command.push("--copy");
```

Dry-run: do not spawn; return actions with `dryRun: true`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(plugins): add curated-skills plugin"
```

---

### Task 4: Plugin `pi-packages`

**Files:**
- Create: `src/plugins/pi-packages.mjs`
- Test: `tests/plugins-pi-packages.test.mjs`
- Port from: `agent-skills/scripts/setup-pi.mjs` package + localExtensions phases; config from `harnesses/pi.json`

**Interfaces:**
- Consumes: `config.manifest` → `{ packages[], localExtensions[] }`
- Produces:
  - plan actions: `pi install <source>` per `defaultEnabled` (or `enableRecommended`) package
  - plan actions: copy/symlink each `localExtensions[].sourceFile` → expanded `path`

- [ ] **Step 1: Failing test with truncated manifest fixture**

```js
test("pi-packages plans pi install for defaultEnabled packages", () => {
  const actions = plan(ctxFromManifest({
    packages: [{
      name: "context-mode",
      source: "npm:context-mode",
      defaultEnabled: true,
      install: "pi install npm:context-mode",
    }],
    localExtensions: [],
  }));
  assert.ok(actions.some((a) => a.command?.includes("pi")));
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

Rules:

- Skip when `config.skipPackages: true`.
- Package selection: `defaultEnabled === true` OR (`enableRecommended && recommended`).
- Prefer splitting `install` string safely; if `install` is `pi install npm:X`, run `["pi", "install", "npm:X"]` via `runCommand` (argv array, no shell).
- Local extensions: read file from `join(dirname(manifest), sourceFile)` or `harnesses/pi/<sourceFile>`; write to `expandTilde(path)` with backup if content differs (match setup-pi backup behavior at high level: write only when changed).
- Doctor: `commandExists("pi")`; manifest path exists; list selected package names.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(plugins): add pi-packages plugin"
```

---

### Task 5: Plugin `cursor-bridge`

**Files:**
- Create: `src/plugins/cursor-bridge.mjs`
- Test: `tests/plugins-cursor-bridge.test.mjs`
- Port from: `setup-pi.mjs` `setupCursorBridge` + `harnesses/pi.json` `cursorBridge` + templates `pi-cursor-provider.service.template`, `pi-cursor-provider-refresh.template`

**Interfaces:**
- Consumes: `cursorBridge` block from manifest
- Produces: plan/apply steps — install npm package `@rama_nigg/open-cursor@…`, render systemd unit + refresh script, `systemctl --user enable --now`

- [ ] **Step 1: Failing test — disabled when `cursorBridge.enabled: false`**

```js
test("cursor-bridge plans nothing when disabled", () => {
  assert.deepEqual(plan(ctxEnabled(false)), []);
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

Doctor checks: `cursor-agent` or documented binary, `opencode` on PATH, `systemctl --user` available (warn on macOS/non-systemd instead of hard fail unless apply requested).

Apply (Linux/systemd):

1. `npm install -g` or documented open-cursor install from `package` field
2. Write unit from template with `providerUrl` / `controlUrl` / workspace
3. Write refresh script to `refreshPath`
4. `systemctl --user daemon-reload && enable --now pi-cursor-provider.service`

Dry-run prints those commands without executing.

- [ ] **Step 4: PASS** (unit tests; integration optional)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(plugins): add cursor-bridge plugin"
```

---

### Task 6: Plugin `memory-palace`

**Files:**
- Create: `src/plugins/memory-palace.mjs`
- Test: `tests/plugins-memory-palace.test.mjs`
- Port from: `agent-skills/scripts/configure-memory-palace.mjs`

**Interfaces:**
- Consumes: `config.vault` or `MEMORY_PALACE_VAULT`; writes `~/.agents/memory-palace/config.json`
- Produces: validate vault dir (markers `.obsidian` / `wiki` / `raw` — keep same rules as legacy); WSL Windows path normalization

- [ ] **Step 1: Failing test — normalize `C:\Users\...` under WSL**

```js
test("memory-palace normalizes Windows path on WSL", async () => {
  const path = await normalizeVaultPath("C:\\Users\\luanb\\Documentos\\Obsidian Vaults\\obsidian-vault", {
    isWsl: true,
  });
  assert.equal(
    path,
    "/mnt/c/Users/luanb/Documentos/Obsidian Vaults/obsidian-vault",
  );
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement** port of `normalizeVaultPath`, `validateVaultPath`, write:

```js
{
  vaultPath: normalizedPath,
  configuredAt: new Date().toISOString(),
  sourceInput: providedRaw,
}
```

Doctor: config exists; `vaultPath` is directory.

If no vault configured and not dry-run apply: fail with message to pass `config.vault` or env — do not prompt interactively inside Agentfolio (non-interactive tool).

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(plugins): add memory-palace plugin"
```

---

### Task 7: Demo + personal collection wiring docs

**Files:**
- Modify: `examples/demo-collection/collection.yaml` (optional tiny plugin stub or document-only)
- Modify: `README.md`
- Create: `docs/plugins.md`
- Modify: `agent-skills` branch `feat/agentfolio-collection` → update `collection.yaml` `plugins.entries` (separate commit in that repo after Agentfolio ships)

**Interfaces:**
- Consumes: shipped plugins
- Produces: documented apply path that replaces `agent-skills setup pi` / `install curated` / `config memory-palace`

- [ ] **Step 1: Write `docs/plugins.md`** describing contract + four first-party plugins + order

- [ ] **Step 2: Update README architecture section** — plugins are real apply backends

- [ ] **Step 3: Manual verify**

```bash
node ./bin/agentfolio.mjs doctor
node ./bin/agentfolio.mjs plan --collection /mnt/c/Users/luanb/Documentos/agent-skills
node ./bin/agentfolio.mjs apply --dry-run --collection /mnt/c/Users/luanb/Documentos/agent-skills
npm test
```

Expected: plan lists curated-skills / pi-packages / cursor-bridge / memory-palace actions; dry-run does not mutate.

- [ ] **Step 4: Commit Agentfolio docs**

```bash
git commit -m "docs: document configurable apply plugins"
```

- [ ] **Step 5: Follow-up in agent-skills (same session or next)** — set `plugins.entries` on `feat/agentfolio-collection`, then open strip-CLI PR only after real `apply` succeeds on your machine.

---

## Self-review

1. **Spec coverage:** packages → Task 4; bridge → Task 5; curated skills → Task 3; memory-palace → Task 6; extensibility/registry → Task 1–2; docs/port path → Task 7. Deferred: `model-catalog`, OpenCode jsonc plugin — called out in non-goals.
2. **Placeholders:** none intentional; plugin modules have concrete command shapes from legacy scripts.
3. **Type consistency:** plugin `id` strings and `PlanAction.backend` use the same ids throughout (`curated-skills`, `pi-packages`, `cursor-bridge`, `memory-palace`).

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-08-01-agentfolio-plugins.md`.

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  

**2. Inline Execution** — run tasks in this session with executing-plans checkpoints  

Which approach?

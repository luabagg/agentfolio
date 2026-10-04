# Remote collections implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Agentfolio use a collection from a git source. An explicit `sync` command fetches the source to one commit and runs the collection's `prepare` step. All other commands stay offline.

**Architecture:** `src/lib/source.mjs` parses a source and derives its managed clone path. `src/lib/git.mjs` wraps the git commands through `runProcess()`. `src/lib/sync-state.mjs` records a completed sync inside `.git/`. `findCollectionRoot()` uses that state to resolve a source offline. `src/lib/sync.mjs` fetches, checks out, validates, prepares, and records state. `bin/agentfolio.mjs` adds `sync`, and `plan` and `doctor` show the source commit.

**Tech Stack:** Node.js ESM on Node 20 and current Node, `node:test`, `node:assert/strict`, `node:child_process` through `runProcess()`, pinned `yaml@2.9.0`, and `git` on `PATH`. No new npm dependencies.

**Spec:** [2026-10-04-remote-collections-design.md](../specs/2026-10-04-remote-collections-design.md)

## Global Constraints

- The schema stays `COLLECTION_SCHEMA_VERSION = 1`. `prepare` is optional. Do not change other schema messages.
- Run every process through `runProcess()` in `src/lib/run.mjs`: literal argv, `shell: false`. Never build a command string.
- Only `sync` uses the network. `plan`, `apply`, `doctor`, `verify`, and `list` must never fetch.
- Never accept, store, or print credentials. Refuse URLs with credentials. Set `GIT_TERMINAL_PROMPT=0` for every git call.
- Agentfolio knows nothing about npm or any target system. The `prepare` argv belongs to the collection.
- Help text must not match `/pi|cursor|provider|systemd|chezmoi/i` or `/\bdiff\b|\bstatus\b/i` (`tests/cli.test.mjs`, test "help describes harness workflow commands"). The word "pin" contains "pi", so do not use it in help text.
- No new dependencies. `npm run check:dependencies`, `npm run check:secrets`, `npm test`, and `npm run package:smoke` must pass after each task.
- Docs use ASD-STE100 Simplified Technical English and no em dashes.
- Windows support for `prepare` and `file://` sources is out of scope.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/source.mjs` (new) | Detect and parse git sources. Derive the managed clone path. Pure functions. |
| `src/lib/git.mjs` (new) | The git commands that sync and lookup need. |
| `src/lib/sync-state.mjs` (new) | Read, write, and clear `.git/agentfolio-sync.json`. Resolve a source to its synced root offline. |
| `src/lib/sync.mjs` (new) | `syncSource()`, `syncLocal()`, `prepareCollection()`, `formatSyncText()`. |
| `src/lib/schema.mjs` | Add `prepare`. Share one command validator with adapters. |
| `src/lib/collection.mjs` | Resolve sources in `findCollectionRoot()`. Attach `source` in `loadCollection()`. |
| `src/lib/plan.mjs`, `src/lib/doctor.mjs` | Show `Source: <url> @ <commit>`. |
| `bin/agentfolio.mjs` | `sync` command and help text. |
| `tests/fixtures/git-source.mjs` (new) | Local git repositories as `file://` sources. Not a test file: `node --test` matches only `*.test.mjs` here. |
| `tests/source.test.mjs`, `tests/git.test.mjs`, `tests/sync.test.mjs` (new) | Unit tests for the new modules. |
| `README.md`, `docs/architecture.md`, `docs/collection-schema.md` | User docs. |

---

### Task 1: Parse git sources and derive managed roots

**Files:**
- Create: `src/lib/source.mjs`
- Test: `tests/source.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isSourceSpec(value: string): boolean`
  - `parseSource(spec: string): { spec: string, url: string, ref: string | null, key: string[] }`
  - `managedRoot(source, env = process.env): string`

- [ ] **Step 1: Write the failing test.** Create `tests/source.test.mjs`:

```js
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { isSourceSpec, managedRoot, parseSource } from "../src/lib/source.mjs";

test("directories are not git sources", () => {
  for (const value of [".", "./collection", "/abs/collection", "collection#main"]) {
    assert.equal(isSourceSpec(value), false, value);
  }
});

test("GitHub shorthand, https, ssh, and scp-like forms share one managed key", () => {
  const specs = [
    "github:luabagg/agent-skills",
    "https://github.com/luabagg/agent-skills.git",
    "ssh://git@github.com/luabagg/agent-skills.git",
    "git@github.com:luabagg/agent-skills.git",
  ];
  for (const spec of specs) {
    assert.equal(isSourceSpec(spec), true, spec);
    assert.deepEqual(parseSource(spec).key, ["github.com", "luabagg", "agent-skills"], spec);
  }
  assert.equal(parseSource("github:luabagg/agent-skills").url, "https://github.com/luabagg/agent-skills.git");
});

test("a #ref suffix selects a branch, tag, or commit", () => {
  assert.equal(parseSource("github:o/r#v1.2.0").ref, "v1.2.0");
  assert.equal(parseSource("github:o/r#feature/x").ref, "feature/x");
  assert.equal(parseSource("github:o/r").ref, null);
});

test("refs that git could read as options or ranges are rejected", () => {
  for (const ref of ["-upload-pack=x", "a..b", "v1^{}", "x y"]) {
    assert.throws(() => parseSource(`github:o/r#${ref}`), /Invalid source ref/, ref);
  }
});

test("URLs with embedded credentials are rejected", () => {
  assert.throws(() => parseSource("https://user@github.com/o/r.git"), /credentials/);
  assert.throws(() => parseSource("https://user:pass@github.com/o/r.git"), /credentials/);
});

test("malformed GitHub shorthand is rejected", () => {
  assert.throws(() => parseSource("github:only-owner"), /github:<owner>\/<repo>/);
});

test("file sources map under a file host, and AGENTFOLIO_HOME moves managed roots", () => {
  const source = parseSource("file:///srv/collections/demo.git#main");
  assert.deepEqual(source.key, ["file", "srv", "collections", "demo"]);
  assert.equal(
    managedRoot(source, { AGENTFOLIO_HOME: "/data/agentfolio" }),
    join("/data/agentfolio", "collections", "file", "srv", "collections", "demo"),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test tests/source.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/source.mjs`.

- [ ] **Step 3: Write the implementation.** Create `src/lib/source.mjs`:

```js
import { homedir } from "node:os";
import { join } from "node:path";

const URL_SCHEME = /^(?:https|ssh|file):\/\//;
const SCP_LIKE = /^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):(?!\/)(.+)$/;
const GITHUB_SHORTHAND = /^github:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;
// Refuse refs that git could read as an option (-x) or a range (a..b).
const SAFE_REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const SAFE_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** True when a collection value names a git source instead of a directory. */
export function isSourceSpec(value) {
  return typeof value === "string"
    && (value.startsWith("github:") || URL_SCHEME.test(value) || SCP_LIKE.test(value));
}

function splitRef(spec) {
  const index = spec.indexOf("#");
  if (index === -1) return { base: spec, ref: null };
  const ref = spec.slice(index + 1);
  if (!SAFE_REF.test(ref)) throw new Error(`Invalid source ref: ${JSON.stringify(ref)}`);
  return { base: spec.slice(0, index), ref };
}

function managedKey(host, path) {
  const segments = [host.toLowerCase(), ...path.replace(/\.git$/, "").split("/").filter(Boolean)];
  if (segments.length < 2 || !segments.every((segment) => SAFE_SEGMENT.test(segment))) {
    throw new Error(`Unsupported source path: ${JSON.stringify(path)}`);
  }
  return segments;
}

function parseUrl(base) {
  const url = new URL(base);
  if (url.password || (url.protocol === "https:" && url.username)) {
    throw new Error("Source URLs must not contain credentials. Configure git credentials instead.");
  }
  const host = url.protocol === "file:" ? "file" : url.hostname;
  return { url: base, key: managedKey(host, decodeURIComponent(url.pathname)) };
}

/**
 * Parse a git collection source such as `github:owner/repo#v1`.
 * @returns {{ spec: string, url: string, ref: string | null, key: string[] }}
 */
export function parseSource(spec) {
  if (!isSourceSpec(spec)) throw new Error(`Not a git source: ${JSON.stringify(spec)}`);
  const { base, ref } = splitRef(spec);
  if (base.startsWith("github:")) {
    const match = GITHUB_SHORTHAND.exec(base);
    if (!match) throw new Error("GitHub sources use github:<owner>/<repo>");
    const repo = match[2].replace(/\.git$/, "");
    return {
      spec,
      url: `https://github.com/${match[1]}/${repo}.git`,
      ref,
      key: managedKey("github.com", `${match[1]}/${repo}`),
    };
  }
  const scp = SCP_LIKE.exec(base);
  if (scp) return { spec, url: base, ref, key: managedKey(scp[1], scp[2]) };
  return { spec, ref, ...parseUrl(base) };
}

/** Managed clone directory for a source. The ref is not part of the path, so adapter links stay valid. */
export function managedRoot(source, env = process.env) {
  const home = env.AGENTFOLIO_HOME?.trim() || join(homedir(), ".agentfolio");
  return join(home, "collections", ...source.key);
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `node --test tests/source.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/source.mjs tests/source.test.mjs
git commit -m "feat(source): parse git collection sources"
```

---

### Task 2: Wrap the git commands that sync needs

**Files:**
- Create: `src/lib/git.mjs`, `tests/fixtures/git-source.mjs`
- Test: `tests/git.test.mjs`

**Interfaces:**
- Consumes: `runProcess(argv, { cwd, env, timeout })` from `src/lib/run.mjs`.
- Produces:
  - `resolveRemoteCommit(url: string, ref: string | null): string`
  - `cloneSource(url: string, dir: string): void`
  - `fetchSource(dir: string): void`
  - `checkoutCommit(dir: string, commit: string): void`
  - `headCommit(dir: string): string`
  - `originUrl(dir: string): string`
  - `hasTrackedChanges(dir: string): boolean`
  - Test fixture: `git(cwd, ...args): string`, `commitFiles(repo, files, message): string`, `makeSourceRepo(files): { repo, url }`

`git ls-remote <url> refs/tags/v1` returns only the tag object for an annotated tag. The commit appears only when the peeled name `refs/tags/v1^{}` is passed explicitly (checked with git 2.53).

- [ ] **Step 1: Write the test fixture.** Create `tests/fixtures/git-source.mjs`:

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Run git with a fixed test identity and return trimmed stdout. */
export function git(cwd, ...args) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=Agentfolio Test", "-c", "user.email=test@example.invalid", ...args],
    { cwd, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** Write files into a repository, commit them, and return the new commit. */
export function commitFiles(repo, files, message) {
  for (const [name, content] of Object.entries(files)) writeFileSync(join(repo, name), content);
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

/** Create a local repository with one commit. Its file:// URL works as a collection source. */
export function makeSourceRepo(files) {
  const repo = mkdtempSync(join(tmpdir(), "agentfolio-source-"));
  git(repo, "init", "--quiet", "--initial-branch=main");
  commitFiles(repo, files, "initial");
  return { repo, url: `file://${repo}` };
}
```

- [ ] **Step 2: Write the failing test.** Create `tests/git.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkoutCommit,
  cloneSource,
  fetchSource,
  hasTrackedChanges,
  headCommit,
  originUrl,
  resolveRemoteCommit,
} from "../src/lib/git.mjs";
import { commitFiles, git, makeSourceRepo } from "./fixtures/git-source.mjs";

test("resolveRemoteCommit resolves HEAD, branches, annotated tags, and full SHAs to commits", () => {
  const { repo, url } = makeSourceRepo({ "a.txt": "one" });
  try {
    const first = git(repo, "rev-parse", "HEAD");
    git(repo, "tag", "-a", "v1", "-m", "v1");
    const second = commitFiles(repo, { "b.txt": "two" }, "second");
    assert.equal(resolveRemoteCommit(url, null), second);
    assert.equal(resolveRemoteCommit(url, "main"), second);
    assert.equal(resolveRemoteCommit(url, "v1"), first);
    assert.equal(resolveRemoteCommit(url, first), first);
    assert.throws(() => resolveRemoteCommit(url, "missing"), /Cannot resolve missing/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("clone, fetch, and detached checkout move a managed clone between commits", () => {
  const { repo, url } = makeSourceRepo({ "a.txt": "one" });
  const parent = mkdtempSync(join(tmpdir(), "agentfolio-managed-"));
  const dir = join(parent, "clone");
  try {
    const first = git(repo, "rev-parse", "HEAD");
    cloneSource(url, dir);
    assert.equal(originUrl(dir), url);
    const second = commitFiles(repo, { "b.txt": "two" }, "second");
    fetchSource(dir);
    checkoutCommit(dir, second);
    assert.equal(headCommit(dir), second);
    checkoutCommit(dir, first);
    assert.equal(headCommit(dir), first);
    assert.throws(() => checkoutCommit(dir, "f".repeat(40)), /not on any fetched branch or tag/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test("hasTrackedChanges ignores untracked files and reports edited tracked files", () => {
  const { repo, url } = makeSourceRepo({ "a.txt": "one" });
  const parent = mkdtempSync(join(tmpdir(), "agentfolio-managed-"));
  const dir = join(parent, "clone");
  try {
    cloneSource(url, dir);
    writeFileSync(join(dir, "untracked.txt"), "installed dependency");
    assert.equal(hasTrackedChanges(dir), false);
    writeFileSync(join(dir, "a.txt"), "edited");
    assert.equal(hasTrackedChanges(dir), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `node --test tests/git.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/git.mjs`.

- [ ] **Step 4: Write the implementation.** Create `src/lib/git.mjs`:

```js
import { runProcess } from "./run.mjs";

const GIT_TIMEOUT = 300_000;
const FULL_SHA = /^[0-9a-f]{40}$/;

function git(args, cwd) {
  const result = runProcess(["git", ...args], {
    cwd,
    timeout: GIT_TIMEOUT,
    // Fail instead of waiting for a credential prompt that nobody can answer.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) throw new Error(`git ${args[0]} could not run: ${result.error}`);
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  return result.stdout.trim();
}

/** Resolve a ref on the remote to a commit without cloning. A tag wins over a branch, as in git rev-parse. */
export function resolveRemoteCommit(url, ref) {
  if (ref && FULL_SHA.test(ref)) return ref;
  // An annotated tag lists its commit only under the explicit peeled name `<tag>^{}`.
  const names = ref ? [`refs/tags/${ref}^{}`, `refs/tags/${ref}`, `refs/heads/${ref}`] : ["HEAD"];
  const commits = new Map();
  for (const line of git(["ls-remote", url, ...names]).split("\n").filter(Boolean)) {
    const [commit, name] = line.split("\t");
    commits.set(name, commit);
  }
  const name = names.find((candidate) => commits.has(candidate));
  if (!name) throw new Error(`Cannot resolve ${ref ?? "HEAD"} in ${url}. Use a branch, a tag, or a full commit SHA.`);
  return commits.get(name);
}

export function cloneSource(url, dir) {
  git(["clone", "--quiet", "--", url, dir]);
}

export function fetchSource(dir) {
  git(["fetch", "--quiet", "--prune", "--tags", "origin"], dir);
}

export function checkoutCommit(dir, commit) {
  try {
    git(["cat-file", "-e", `${commit}^{commit}`], dir);
  } catch {
    throw new Error(`Commit ${commit} is not on any fetched branch or tag`);
  }
  git(["checkout", "--quiet", "--detach", commit], dir);
}

export function headCommit(dir) {
  return git(["rev-parse", "HEAD"], dir);
}

export function originUrl(dir) {
  return git(["remote", "get-url", "origin"], dir);
}

/** True when a tracked file has local changes. Untracked files, such as installed dependencies, do not count. */
export function hasTrackedChanges(dir) {
  return git(["status", "--porcelain", "--untracked-files=no"], dir) !== "";
}
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `node --test tests/git.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/git.mjs tests/git.test.mjs tests/fixtures/git-source.mjs
git commit -m "feat(git): add git commands for managed clones"
```

---

### Task 3: Accept an optional `prepare` command in the schema

**Files:**
- Modify: `src/lib/schema.mjs` (`ALLOWED_TOP_LEVEL`, `validateCollection()`, `validateAdapters()`)
- Test: `tests/schema.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `doc.prepare: { executable: string, args: string[], timeout?: number } | undefined` on a valid collection.

- [ ] **Step 1: Write the failing test.** Append to `tests/schema.test.mjs`:

```js
test("accepts an optional prepare command with adapter-style validation", () => {
  const valid = { name: "demo", version: 1, prepare: { executable: "npm", args: ["ci", "--ignore-scripts"], timeout: 600000 } };
  assert.equal(validateCollection(valid).ok, true);
  const result = validateCollection({
    name: "demo",
    version: 1,
    prepare: { executable: "", args: [""], timeout: 0, shell: "npm ci" },
  });
  assert.equal(result.ok, false);
  for (const fragment of ["prepare.executable", "prepare.args", "prepare.timeout", "prepare.shell is not allowed"]) {
    assert.ok(result.errors.some((error) => error.includes(fragment)), fragment);
  }
  assert.ok(validateCollection({ name: "demo", version: 1, prepare: ["npm", "ci"] }).errors.includes("prepare must be a mapping"));
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test tests/schema.test.mjs`
Expected: FAIL in the new test, because `validateCollection()` reports `unknown top-level field: prepare`.

- [ ] **Step 3: Write the implementation.** In `src/lib/schema.mjs`:

Add `"prepare"` as the last entry of `ALLOWED_TOP_LEVEL`:

```js
const ALLOWED_TOP_LEVEL = new Set([
  "name",
  "version",
  "skills",
  "tools",
  "adapters",
  "harnesses",
  "profiles",
  "prepare",
]);
```

In `validateCollection()`, after the `doc.profiles` line, add:

```js
  if (doc.prepare !== undefined) validateCommand(doc.prepare, "prepare", errors);
```

Replace the loop in `validateAdapters()` and add `validateCommand()` after that function. The error messages stay the same, so the existing adapter test still passes:

```js
  for (const [id, adapter] of Object.entries(adapters)) {
    if (!id) errors.push("adapter ids must be non-empty");
    validateCommand(adapter, `adapters.${id}`, errors);
  }
}

/** Validate a literal argv command: an adapter or the collection prepare step. */
function validateCommand(command, path, errors) {
  if (!isMapping(command)) {
    errors.push(`${path} must be a mapping`);
    return;
  }
  rejectUnknownKeys(command, new Set(["executable", "args", "timeout"]), path, errors);
  if (typeof command.executable !== "string" || !command.executable) {
    errors.push(`${path}.executable must be a non-empty string`);
  }
  if (!Array.isArray(command.args) || command.args.some((part) => typeof part !== "string" || !part)) {
    errors.push(`${path}.args must be an array of non-empty strings`);
  }
  if (command.timeout !== undefined && (!Number.isInteger(command.timeout) || command.timeout <= 0)) {
    errors.push(`${path}.timeout must be a positive integer in milliseconds`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `node --test tests/schema.test.mjs`
Expected: PASS, 11 tests, including "requires executable and args, rejects command, and validates timeout".

- [ ] **Step 5: Commit.**

```bash
git add src/lib/schema.mjs tests/schema.test.mjs
git commit -m "feat(schema): accept optional prepare command"
```

---

### Task 4: Resolve git sources offline to a synced managed clone

**Files:**
- Create: `src/lib/sync-state.mjs`
- Modify: `src/lib/collection.mjs` (imports, `findCollectionRoot()`, `loadCollection()`)
- Test: `tests/collection.test.mjs`

**Interfaces:**
- Consumes: `isSourceSpec`, `parseSource`, `managedRoot` (Task 1). `headCommit`, `cloneSource`, `fetchSource`, `checkoutCommit` (Task 2). Test fixture (Task 2).
- Produces:
  - `syncStatePath(root): string`
  - `readSyncState(root): { url, ref, commit, syncedAt } | null`
  - `writeSyncState(root, state): void`
  - `clearSyncState(root): void`
  - `syncedRoot(source, env = process.env): string`
  - `loadCollection(root).source`: the sync state, or `null` for a local collection.

- [ ] **Step 1: Write the failing test.** In `tests/collection.test.mjs`, add these imports after the existing `../src/lib/collection.mjs` import:

```js
import { checkoutCommit, cloneSource, fetchSource, headCommit } from "../src/lib/git.mjs";
import { managedRoot, parseSource } from "../src/lib/source.mjs";
import { writeSyncState } from "../src/lib/sync-state.mjs";
import { commitFiles, git, makeSourceRepo } from "./fixtures/git-source.mjs";
```

Append these tests:

```js
test("git sources resolve offline to a synced managed clone", () => {
  const home = mkdtempSync(join(tmpdir(), "agentfolio-home-"));
  const { repo, url } = makeSourceRepo({ "collection.yaml": "name: remote\nversion: 1\n" });
  const previousHome = process.env.AGENTFOLIO_HOME;
  process.env.AGENTFOLIO_HOME = home;
  try {
    assert.throws(() => findCollectionRoot(process.cwd(), url), /not synced\. Run: agentfolio sync/);
    const root = managedRoot(parseSource(url));
    mkdirSync(dirname(root), { recursive: true });
    cloneSource(url, root);
    writeSyncState(root, { url, ref: null, commit: headCommit(root), syncedAt: new Date().toISOString() });
    assert.equal(findCollectionRoot(process.cwd(), url), root);
    assert.equal(loadCollection(root).source.commit, headCommit(root));
    assert.throws(() => findCollectionRoot(process.cwd(), `${url}#v2`), /synced at HEAD, not v2/);

    commitFiles(repo, { "b.txt": "two" }, "second");
    fetchSource(root);
    checkoutCommit(root, git(repo, "rev-parse", "HEAD"));
    assert.throws(() => findCollectionRoot(process.cwd(), url), /not at its synced commit/);
  } finally {
    if (previousHome === undefined) delete process.env.AGENTFOLIO_HOME;
    else process.env.AGENTFOLIO_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("local collections have no source", () => {
  assert.equal(loadCollection(demoRoot).source, null);
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test tests/collection.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/sync-state.mjs`.

- [ ] **Step 3: Write `src/lib/sync-state.mjs`.**

```js
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { headCommit } from "./git.mjs";
import { managedRoot } from "./source.mjs";

/** The state file lives inside .git, so it is never part of the collection tree. */
export function syncStatePath(root) {
  return join(root, ".git", "agentfolio-sync.json");
}

/** @returns {{ url: string, ref: string | null, commit: string, syncedAt: string } | null} */
export function readSyncState(root) {
  const path = syncStatePath(root);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function writeSyncState(root, state) {
  writeFileSync(syncStatePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

export function clearSyncState(root) {
  rmSync(syncStatePath(root), { force: true });
}

/**
 * Root of a managed clone whose last sync completed. Never uses the network.
 * A source with a ref must match the synced ref. A source without a ref accepts any synced ref.
 */
export function syncedRoot(source, env = process.env) {
  const root = managedRoot(source, env);
  const state = existsSync(root) ? readSyncState(root) : null;
  if (!state) throw new Error(`Collection source is not synced. Run: agentfolio sync ${source.spec}`);
  if (source.ref && source.ref !== state.ref) {
    throw new Error(`Managed collection ${root} is synced at ${state.ref ?? "HEAD"}, not ${source.ref}. Run: agentfolio sync ${source.spec}`);
  }
  if (headCommit(root) !== state.commit) {
    throw new Error(`Managed collection ${root} is not at its synced commit. Run: agentfolio sync ${source.spec}`);
  }
  return root;
}
```

- [ ] **Step 4: Change `src/lib/collection.mjs`.**

After `import { validateCollection } from "./schema.mjs";`, add:

```js
import { isSourceSpec, parseSource } from "./source.mjs";
import { readSyncState, syncedRoot } from "./sync-state.mjs";
```

Replace the start of `findCollectionRoot()` and its comment:

```js
/**
 * Resolve collection root from cwd, --collection, or AGENTFOLIO_COLLECTION.
 * A git source resolves to its synced managed clone. Walks up looking for collection.yaml.
 */
export function findCollectionRoot(startDir = process.cwd(), explicit) {
  if (explicit && isSourceSpec(explicit)) return syncedRoot(parseSource(explicit));
  if (explicit) {
```

In the same function, replace the environment lines:

```js
  const env = process.env.AGENTFOLIO_COLLECTION?.trim();
  if (env && isSourceSpec(env)) return syncedRoot(parseSource(env));
  if (env) {
```

In `loadCollection()`, add `source` to the returned object:

```js
  return {
    root,
    file,
    doc,
    warnings: validation.warnings,
    source: readSyncState(root),
  };
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `node --test tests/collection.test.mjs`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/sync-state.mjs src/lib/collection.mjs tests/collection.test.mjs
git commit -m "feat(collection): resolve git sources to synced clones"
```

---

### Task 5: Sync a source or prepare a local collection

**Files:**
- Create: `src/lib/sync.mjs`
- Test: `tests/sync.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 to 4, plus `loadCollection(root)` and `runProcess()`.
- Produces:
  - `DEFAULT_PREPARE_TIMEOUT = 600_000`
  - `prepareCollection(collection, { dryRun = false }): string[] | null`: the argv, or `null` when none is declared.
  - `syncSource(source, { dryRun = false, env = process.env }): { source, url, root, previous, commit, prepare, dryRun }`
  - `syncLocal(collection, { dryRun = false }): { root, prepare, dryRun }`
  - `formatSyncText(report): string`

`runProcess()` captures at most 64 KiB per stream. Output above that limit stops the child process. The docs task tells collections to use quiet flags.

- [ ] **Step 1: Write the failing test.** Create `tests/sync.test.mjs`:

```js
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCollection } from "../src/lib/collection.mjs";
import { hasTrackedChanges, headCommit } from "../src/lib/git.mjs";
import { managedRoot, parseSource } from "../src/lib/source.mjs";
import { readSyncState, syncedRoot } from "../src/lib/sync-state.mjs";
import { syncLocal, syncSource } from "../src/lib/sync.mjs";
import { commitFiles, git, makeSourceRepo } from "./fixtures/git-source.mjs";

const WRITE_MARKER = ["-e", "require('node:fs').writeFileSync('prepared.txt', 'ok')"];

function collectionYaml(prepareArgs = WRITE_MARKER) {
  return JSON.stringify({ name: "remote-demo", version: 1, prepare: { executable: process.execPath, args: prepareArgs } });
}

function withSource(files, body) {
  const { repo, url } = makeSourceRepo(files);
  const env = { AGENTFOLIO_HOME: mkdtempSync(join(tmpdir(), "agentfolio-home-")) };
  try {
    body({ repo, source: parseSource(url), env });
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.AGENTFOLIO_HOME, { recursive: true, force: true });
  }
}

test("sync clones the source, checks out the resolved commit, runs prepare, and records state", () => {
  withSource({ "collection.yaml": collectionYaml() }, ({ repo, source, env }) => {
    const report = syncSource(source, { env });
    const root = managedRoot(source, env);
    assert.equal(report.root, root);
    assert.equal(report.previous, null);
    assert.equal(report.commit, git(repo, "rev-parse", "HEAD"));
    assert.equal(headCommit(root), report.commit);
    assert.equal(readFileSync(join(root, "prepared.txt"), "utf8"), "ok");
    assert.equal(readSyncState(root).commit, report.commit);
    assert.equal(hasTrackedChanges(root), false);
    assert.equal(syncedRoot(source, env), root);
  });
});

test("sync --dry-run resolves the target commit and writes no files", () => {
  withSource({ "collection.yaml": collectionYaml() }, ({ repo, source, env }) => {
    const report = syncSource(source, { dryRun: true, env });
    assert.equal(report.commit, git(repo, "rev-parse", "HEAD"));
    assert.equal(existsSync(managedRoot(source, env)), false);
  });
});

test("a second sync moves to the new commit and reports the last synced commit", () => {
  withSource({ "collection.yaml": collectionYaml() }, ({ repo, source, env }) => {
    const first = syncSource(source, { env }).commit;
    const second = commitFiles(repo, { "notes.md": "two" }, "second");
    const report = syncSource(source, { env });
    assert.equal(report.previous, first);
    assert.equal(report.commit, second);
    assert.equal(headCommit(managedRoot(source, env)), second);
  });
});

test("a #tag source checks out the tagged commit", () => {
  withSource({ "collection.yaml": collectionYaml() }, ({ repo, source, env }) => {
    const tagged = git(repo, "rev-parse", "HEAD");
    git(repo, "tag", "-a", "v1", "-m", "v1");
    commitFiles(repo, { "notes.md": "two" }, "second");
    const pinned = parseSource(`${source.url}#v1`);
    assert.equal(syncSource(pinned, { env }).commit, tagged);
    assert.equal(headCommit(managedRoot(pinned, env)), tagged);
  });
});

test("sync refuses a managed clone with changes to tracked files", () => {
  withSource({ "collection.yaml": collectionYaml() }, ({ source, env }) => {
    syncSource(source, { env });
    writeFileSync(join(managedRoot(source, env), "collection.yaml"), "name: edited\nversion: 1\n");
    assert.throws(() => syncSource(source, { env }), /changes to tracked files/);
  });
});

test("a failed prepare leaves no sync state, so other commands refuse the clone", () => {
  withSource({ "collection.yaml": collectionYaml(["-e", "process.exit(3)"]) }, ({ source, env }) => {
    assert.throws(() => syncSource(source, { env }), /sync did not complete: prepare failed/);
    assert.equal(readSyncState(managedRoot(source, env)), null);
    assert.throws(() => syncedRoot(source, env), /not synced/);
  });
});

test("syncLocal runs prepare for a local collection, and a dry run only reports the argv", () => {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-local-"));
  try {
    writeFileSync(join(root, "collection.yaml"), collectionYaml());
    const collection = loadCollection(root);
    assert.deepEqual(syncLocal(collection, { dryRun: true }).prepare, [process.execPath, ...WRITE_MARKER]);
    assert.equal(existsSync(join(root, "prepared.txt")), false);
    syncLocal(collection);
    assert.equal(readFileSync(join(root, "prepared.txt"), "utf8"), "ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test tests/sync.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/sync.mjs`.

- [ ] **Step 3: Write the implementation.** Create `src/lib/sync.mjs`:

```js
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { loadCollection } from "./collection.mjs";
import {
  checkoutCommit,
  cloneSource,
  fetchSource,
  hasTrackedChanges,
  originUrl,
  resolveRemoteCommit,
} from "./git.mjs";
import { runProcess } from "./run.mjs";
import { managedRoot } from "./source.mjs";
import { clearSyncState, readSyncState, writeSyncState } from "./sync-state.mjs";

export const DEFAULT_PREPARE_TIMEOUT = 600_000;

/** Run the collection's prepare argv from its root. Returns that argv, or null when none is declared. */
export function prepareCollection(collection, { dryRun = false } = {}) {
  const prepare = collection.doc.prepare;
  if (!prepare) return null;
  const argv = [prepare.executable, ...prepare.args];
  if (dryRun) return argv;
  const result = runProcess(argv, { cwd: collection.root, timeout: prepare.timeout ?? DEFAULT_PREPARE_TIMEOUT });
  if (result.error || result.status !== 0) {
    throw new Error(`prepare failed: ${result.error ?? (result.stderr.trim() || `exit ${result.status}`)}`);
  }
  return argv;
}

function assertReusable(root, url) {
  const tracked = originUrl(root);
  if (tracked !== url) {
    throw new Error(`${root} tracks ${tracked}. Sync that URL, or delete the directory to switch sources.`);
  }
  if (hasTrackedChanges(root)) {
    throw new Error(`${root} has changes to tracked files. Commit, stash, or discard them before sync.`);
  }
}

function cloneInto(url, root) {
  mkdirSync(dirname(root), { recursive: true });
  const staging = `${root}.partial-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  try {
    cloneSource(url, staging);
    renameSync(staging, root);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Fetch a git source into its managed clone, check out the resolved commit, and run prepare.
 * A failed sync leaves no sync state, so other commands refuse the clone until a sync succeeds.
 */
export function syncSource(source, { dryRun = false, env = process.env } = {}) {
  const root = managedRoot(source, env);
  const exists = existsSync(root);
  if (exists) assertReusable(root, source.url);
  const previous = exists ? readSyncState(root)?.commit ?? null : null;
  const commit = resolveRemoteCommit(source.url, source.ref);
  const report = { source: source.spec, url: source.url, root, previous, commit, prepare: null, dryRun };
  if (dryRun) return report;

  if (exists) fetchSource(root);
  else cloneInto(source.url, root);
  clearSyncState(root);
  try {
    checkoutCommit(root, commit);
    report.prepare = prepareCollection(loadCollection(root));
  } catch (error) {
    const back = previous ? ` To return to the last synced commit, run: agentfolio sync ${source.url}#${previous}` : "";
    throw new Error(`sync did not complete: ${error.message}.${back}`);
  }
  writeSyncState(root, { url: source.url, ref: source.ref, commit, syncedAt: new Date().toISOString() });
  return report;
}

/** Run prepare for a local collection. */
export function syncLocal(collection, { dryRun = false } = {}) {
  return { root: collection.root, prepare: prepareCollection(collection, { dryRun }), dryRun };
}

export function formatSyncText(report) {
  const lines = [];
  if (report.url) {
    lines.push(`Source: ${report.url}`);
    lines.push(`Root: ${report.root}`);
    lines.push(`Commit: ${report.previous ?? "(none)"} -> ${report.commit}`);
  } else {
    lines.push(`Root: ${report.root}`);
  }
  if (!report.dryRun || !report.url) {
    lines.push(`Prepare: ${report.prepare ? report.prepare.join(" ") : "(none declared)"}`);
  }
  if (report.dryRun) lines.push("Dry run: no files changed.");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `node --test tests/sync.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/sync.mjs tests/sync.test.mjs
git commit -m "feat(sync): sync git sources and run prepare"
```

---

### Task 6: Add the `sync` command and show the source in plan and doctor

**Files:**
- Modify: `bin/agentfolio.mjs` (imports, `printHelp()`, new `runSync()`, `main()` switch), `src/lib/plan.mjs` (`buildPlan()`, `formatPlanText()`), `src/lib/doctor.mjs` (`runDoctor()`)
- Test: `tests/cli.test.mjs`

**Interfaces:**
- Consumes: `isSourceSpec`, `parseSource` (Task 1), `syncSource`, `syncLocal`, `formatSyncText` (Task 5), `collection.source` (Task 4).
- Produces: `agentfolio sync [source] [--dry-run] [--json]`. `plan.collection.source` in plan JSON. Doctor check `collection.source`.

- [ ] **Step 1: Write the failing test.** In `tests/cli.test.mjs`, add this import after the `node:url` import:

```js
import { git, makeSourceRepo } from "./fixtures/git-source.mjs";
```

After `const node = process.execPath;`, add:

```js
const WRITE_MARKER = ["-e", "require('node:fs').writeFileSync('prepared.txt', 'ok')"];
```

Append these tests:

```js
test("plan, sync, and plan again: a git source is used only after sync", () => {
  const { repo, url } = makeSourceRepo({
    "collection.yaml": JSON.stringify({ name: "remote-demo", version: 1, prepare: { executable: node, args: WRITE_MARKER } }),
  });
  const env = { AGENTFOLIO_HOME: mkdtempSync(join(tmpdir(), "agentfolio-cli-home-")) };
  try {
    const before = run(["plan", "--collection", url], { env });
    assert.notEqual(before.status, 0);
    assert.match(before.stderr, /Run: agentfolio sync/);

    const dry = run(["sync", url, "--dry-run"], { env });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Dry run: no files changed/);

    const commit = git(repo, "rev-parse", "HEAD");
    const synced = run(["sync", url], { env });
    assert.equal(synced.status, 0, synced.stderr);
    assert.ok(synced.stdout.includes(`Commit: (none) -> ${commit}`), synced.stdout);

    const plan = run(["plan", "--collection", url], { env });
    assert.equal(plan.status, 0, plan.stderr);
    assert.ok(plan.stdout.includes(`Source: ${url} @ ${commit}`), plan.stdout);

    const doctor = run(["doctor", "--collection", url], { env });
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.ok(doctor.stdout.includes(`collection.source: ${url} @ ${commit}`), doctor.stdout);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.AGENTFOLIO_HOME, { recursive: true, force: true });
  }
});

test("sync without a source runs prepare for a local collection", () => {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-cli-prepare-"));
  try {
    writeFileSync(join(root, "collection.yaml"), JSON.stringify({
      name: "local",
      version: 1,
      prepare: { executable: node, args: WRITE_MARKER },
    }));
    const dry = run(["sync", "--dry-run", "--collection", root]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(existsSync(join(root, "prepared.txt")), false);
    const result = run(["sync", "--collection", root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, "prepared.txt"), "utf8"), "ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync rejects a directory as its positional source", () => {
  const result = run(["sync", "./some-dir"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sync takes a git source/);
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test tests/cli.test.mjs`
Expected: FAIL in the three new tests with `Unknown command: sync`.

- [ ] **Step 3: Change `bin/agentfolio.mjs`.**

After the `resolveProfile` import, add:

```js
import { isSourceSpec, parseSource } from "../src/lib/source.mjs";
import { formatSyncText, syncLocal, syncSource } from "../src/lib/sync.mjs";
```

In `printHelp()`, add a command line after `verify`, replace the `--collection` line, and add one example after `agentfolio doctor`:

```text
  sync [source]           Fetch a git collection at one commit and run its prepare step
```

```text
  --collection DIR|SOURCE Collection root or synced git source; package root is not a collection
```

```text
  agentfolio sync github:owner/repo#v1
```

After `loadFromFlags()`, add:

```js
function runSync(positional, flags) {
  if (positional && !isSourceSpec(positional)) {
    fail(`sync takes a git source such as github:owner/repo. For a directory, use --collection ${positional}`);
  }
  const candidate = positional ?? flags.collection ?? process.env.AGENTFOLIO_COLLECTION?.trim();
  if (candidate && isSourceSpec(candidate)) return syncSource(parseSource(candidate), { dryRun: flags.dryRun });
  return syncLocal(loadFromFlags(flags), { dryRun: flags.dryRun });
}
```

In `main()`, add this case before `case "verify":`:

```js
      case "sync": {
        const report = runSync(positionals[1], flags);
        console.log(flags.json ? JSON.stringify(report, null, 2) : formatSyncText(report));
        return;
      }
```

- [ ] **Step 4: Show the source in plan and doctor.**

In `src/lib/plan.mjs` `buildPlan()`, replace the `collection` field:

```js
    collection: { name: doc.name, version: doc.version, root, source: collection.source ?? null },
```

In `formatPlanText()`, after the `Root:` line, add:

```js
  if (plan.collection.source) lines.push(`Source: ${plan.collection.source.url} @ ${plan.collection.source.commit}`);
```

In `src/lib/doctor.mjs` `runDoctor()`, after the `collection` check, add:

```js
    if (collection.source) {
      checks.push({
        id: "collection.source",
        ok: true,
        required: true,
        detail: `${collection.source.url} @ ${collection.source.commit}`,
      });
    }
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `node --test tests/cli.test.mjs`
Expected: PASS, 17 tests, including "help describes harness workflow commands".

Run: `npm test && npm run check:dependencies && npm run check:secrets && npm run package:smoke`
Expected: all pass. The scratch implementation passed 86 tests.

- [ ] **Step 6: Commit.**

```bash
git add bin/agentfolio.mjs src/lib/plan.mjs src/lib/doctor.mjs tests/cli.test.mjs
git commit -m "feat(cli): add sync command and show collection source"
```

---

### Task 7: Document remote collections

**Files:**
- Modify: `README.md`, `docs/architecture.md`, `docs/collection-schema.md`

**Interfaces:** none.

- [ ] **Step 1: Update `README.md`.** Replace the discovery paragraph with:

```markdown
Collection discovery is, in order: `--collection`, `AGENTFOLIO_COLLECTION`, then the nearest ancestor that physically contains `collection.yaml`. The first two accept a directory or a synced git source.
```

Add this section after "Adapter boundary":

````markdown
## Remote collections

`agentfolio sync` fetches a git collection into a managed clone at one commit. Then it runs the collection's `prepare` step.

```sh
agentfolio sync github:owner/repo#v1 --dry-run
agentfolio sync github:owner/repo#v1
agentfolio plan --collection github:owner/repo#v1
agentfolio apply --collection github:owner/repo#v1
```

A source is `github:<owner>/<repo>`, an `https://`, `ssh://`, or `file://` URL, or `user@host:path`. An optional `#<ref>` selects a branch, a tag, or a full commit SHA. The managed clone is `$AGENTFOLIO_HOME/collections/<host>/<path>`. `AGENTFOLIO_HOME` defaults to `~/.agentfolio`.

Only `sync` uses the network. Other commands use the managed clone and fail until a sync completes. When a command names a ref, the clone must be synced at that ref. To sync a source is to trust its code, the same as when you clone it by hand. Git uses your SSH agent or credential helper. Agentfolio refuses URLs that contain credentials.

Without a source, `agentfolio sync` runs `prepare` for a local collection.

Requires `git` on `PATH`.
````

Add `agentfolio sync [source] [--dry-run]` to the "Commands" block.

- [ ] **Step 2: Update `docs/architecture.md`.** Add this section after "Execution flow":

```markdown
## Sources and sync

`sync` is the only command that uses the network. It resolves a git source to one commit with `git ls-remote`, then clones or fetches into `$AGENTFOLIO_HOME/collections/<host>/<path>`. It checks out that commit as a detached `HEAD`, validates `collection.yaml`, runs `prepare`, and writes `.git/agentfolio-sync.json`.

Other commands read that file and refuse the clone when the file is missing or does not match `HEAD`. Thus a failed or interrupted sync is never used. The path does not include the ref, because adapters can link files into the collection root.

Git uses the inherited SSH agent or credential helper. Agentfolio sets `GIT_TERMINAL_PROMPT=0` and refuses source URLs that contain credentials.
```

- [ ] **Step 3: Update `docs/collection-schema.md`.** Add this section after "Adapters and actions":

````markdown
## Prepare

```yaml
prepare:
  executable: npm
  args: [ci, --ignore-scripts, --no-audit, --no-fund]
  timeout: 600000
```

`prepare` is optional. It has the same fields and validation as an adapter. Agentfolio runs it as literal argv without a shell from the collection root, only during `agentfolio sync`. The default timeout is 600000 ms. Agentfolio captures at most 64 KiB per output stream and stops a command that writes more, so use quiet flags. Agentfolio 0.1.x rejects a collection that declares `prepare`. It requires Agentfolio 0.2.0 or later.
````

- [ ] **Step 4: Verify.**

Run: `npm test && npm run check:secrets && npm run package:smoke`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add README.md docs/architecture.md docs/collection-schema.md
git commit -m "docs: document remote collections"
```

---

## Verification evidence

The code in Tasks 1 to 6 ran in a scratch worktree from `main` at `b60df24`:

- `npm test`: 86 tests pass.
- `npm run check:dependencies`, `check:secrets`, and `package:smoke`: pass.
- Smoke test against GitHub with a scratch `AGENTFOLIO_HOME`. `sync github:luabagg/agent-skills --dry-run` resolved the commit and wrote no files. `sync` cloned it. `plan --profile pi --collection github:luabagg/agent-skills` printed `Source: https://github.com/luabagg/agent-skills.git @ 20565a7…`.

## After merge

1. Release `@luabagg/agentfolio` 0.2.0.
2. Remove `docs/superpowers/` before the release, as in `7c612ae docs: remove implementation planning artifacts`. `package.json` publishes `docs/`.
3. Do the `luabagg/agent-skills` follow-up in the spec.

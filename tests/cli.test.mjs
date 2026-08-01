import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const bin = join(repoRoot, "bin", "agentfolio.mjs");
const demoRoot = join(repoRoot, "examples", "demo-collection");
const node = process.execPath;

function run(args, options = {}) {
  return spawnSync(node, [bin, ...args], {
    encoding: "utf8",
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

test("help exits 0", () => {
  const result = run(["help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /agentfolio/);
  assert.match(result.stdout, /plan/);
});

test("version prints semver", () => {
  const result = run(["version"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("plan against demo collection", () => {
  const result = run(["plan", "--collection", demoRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Collection: demo/);
  assert.match(result.stdout, /skills-cli/);
  assert.match(result.stdout, /chezmoi/);
});

test("verify against demo collection", () => {
  const result = run(["verify", "--collection", demoRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verify: OK/);
});

test("list skills --json", () => {
  const result = run(["list", "skills", "--collection", demoRoot, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.local[0].id, "hello-skill");
});

test("apply --dry-run against demo (local destination)", () => {
  const result = run(["apply", "--dry-run", "--collection", demoRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Apply: OK \(dry-run\)/);
});

test("init scaffolds a new collection", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentfolio-init-"));
  try {
    const result = run(["init", dir]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(dir, "collection.yaml")));
    assert.ok(existsSync(join(dir, "skills", "hello-skill", "SKILL.md")));
    assert.ok(existsSync(join(dir, "chezmoi", "dot_pi", "agent", "AGENTS.md")));
    const yaml = readFileSync(join(dir, "collection.yaml"), "utf8");
    assert.match(yaml, /backend: skills-cli/);
    assert.match(yaml, /backend: chezmoi/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown command exits non-zero", () => {
  const result = run(["not-a-command"]);
  assert.notEqual(result.status, 0);
});

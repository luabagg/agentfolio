import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const bin = join(repoRoot, "bin", "agentfolio.mjs");
const demoRoot = join(repoRoot, "examples", "demo-collection");
const fixtureAdapter = join(here, "fixtures", "harness-adapter.mjs");
const node = process.execPath;

function run(args, options = {}) {
  return spawnSync(node, [bin, ...args], {
    encoding: "utf8",
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function makeHarnessCollection(executable = node, args = [fixtureAdapter]) {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-cli-harness-"));
  writeFileSync(join(root, "collection.yaml"), JSON.stringify({
    name: "adapter-demo",
    version: 1,
    adapters: { local: { executable, args } },
    harnesses: {
      terminal: {
        adapter: "local",
        actions: [{ action: "add-agents", summary: "Install terminal agents" }],
      },
    },
    profiles: { default: { skills: false, harnesses: ["terminal"] } },
  }));
  return root;
}

test("help describes harness workflow commands", () => {
  const result = run(["help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /agentfolio/);
  assert.match(result.stdout, /--profile <name>/);
  assert.match(result.stdout, /harness/i);
  assert.match(result.stdout, /external collection/i);
  assert.match(result.stdout, /literal argv/i);
  assert.match(result.stdout, /trust/i);
  assert.doesNotMatch(result.stdout, /pi|cursor|provider|systemd|chezmoi/i);
  assert.doesNotMatch(result.stdout, /setup pi|models check|catalog-only|cursor-bridge|chezmoi|\bdiff\b|\bstatus\b/i);
});

test("version prints semver", () => {
  const result = run(["version"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("plan against generic demo collection", () => {
  const result = run(["plan", "--collection", demoRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Collection: demo/);
  assert.match(result.stdout, /skills-cli/);
  assert.match(result.stdout, /project:configure-project/);
  assert.doesNotMatch(result.stdout, /chezmoi/);
});

test("plan accepts collection-defined profile", () => {
  const result = run(["plan", "--profile", "skills", "--collection", demoRoot, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.profile, { name: "skills", skills: true, harnesses: [] });
  assert.ok(plan.actions.every((action) => action.executor === "skills-cli"));
});

test("list harnesses reports mapping ids and actions", () => {
  const root = makeHarnessCollection();
  try {
    const result = run(["list", "harnesses", "--collection", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const harnesses = JSON.parse(result.stdout);
    assert.equal(harnesses.terminal.adapter, "local");
    assert.equal(harnesses.terminal.actions[0].action, "add-agents");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify invokes selected adapter doctor", () => {
  const root = makeHarnessCollection();
  try {
    const result = run(["verify", "--collection", root]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /adapter\.local\.fixture/);
    assert.match(result.stdout, /Verify: OK/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify checks only dependencies selected by profile", () => {
  const result = run(["verify", "--profile", "catalog", "--collection", demoRoot], {
    env: { PATH: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verify: OK/);
  assert.doesNotMatch(result.stdout, /skills-cli:|npx:|adapter\./);
});

test("doctor fails when selected adapter executable is missing", () => {
  const root = makeHarnessCollection("definitely-missing-agentfolio-adapter", []);
  try {
    const result = run(["doctor", "--collection", root]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /\[FAIL\] adapter\.local\.executable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("list skills --json", () => {
  const result = run(["list", "skills", "--collection", demoRoot, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.local[0].id, "hello-skill");
});

test("apply --dry-run against demo", () => {
  const result = run(["apply", "--dry-run", "--collection", demoRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Apply: OK \(dry-run\)/);
});

test("apply --dry-run invokes adapter", () => {
  const root = makeHarnessCollection();
  try {
    const result = run(["apply", "--dry-run", "--collection", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.profile, "default");
    assert.equal(report.results[0].executor, "adapter");
    assert.equal(report.results[0].dryRun, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init scaffolds a neutral Skills CLI collection", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentfolio-init-"));
  try {
    const result = run(["init", dir]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(dir, "collection.yaml")));
    assert.ok(existsSync(join(dir, "skills", "hello-skill", "SKILL.md")));
    assert.equal(existsSync(join(dir, "harnesses")), false);
    assert.equal(existsSync(join(dir, "chezmoi")), false);
    const yaml = readFileSync(join(dir, "collection.yaml"), "utf8");
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    assert.match(yaml, /skills:/);
    assert.match(readme, /executable.*args/);
    assert.doesNotMatch(yaml, /backend:|pi|cursor|chezmoi/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown command exits non-zero", () => {
  const result = run(["not-a-command"]);
  assert.notEqual(result.status, 0);
});

test("unknown profile exits non-zero", () => {
  const result = run(["apply", "--profile", "nope", "--collection", demoRoot]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown profile/);
});

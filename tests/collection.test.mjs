import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCollectionRoot, loadCollection, listLocalSkills, resolveCollectionPath } from "../src/lib/collection.mjs";
import { applyCollection } from "../src/lib/apply.mjs";
import { buildPlan } from "../src/lib/plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const demoRoot = join(repoRoot, "examples", "demo-collection");
const fixtureAdapter = join(here, "fixtures", "harness-adapter.mjs");

function harnessCollection(actions = [{ action: "setup" }], profiles) {
  return {
    root: repoRoot,
    warnings: [],
    doc: {
      name: "harness-demo",
      version: 1,
      adapters: { fixture: { executable: process.execPath, args: [fixtureAdapter] } },
      harnesses: { terminal: { adapter: "fixture", actions } },
      ...(profiles ? { profiles } : {}),
    },
  };
}

test("findCollectionRoot discovers demo collection", () => {
  assert.equal(findCollectionRoot(demoRoot), demoRoot);
});

test("findCollectionRoot accepts explicit path", () => {
  assert.equal(findCollectionRoot(process.cwd(), demoRoot), demoRoot);
});

test("findCollectionRoot discovers ancestors and collection paths stay contained", () => {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-discovery-"));
  try {
    mkdirSync(join(root, "child"), { recursive: true });
    writeFileSync(join(root, "collection.yaml"), "name: demo\nversion: 1\n");
    assert.equal(findCollectionRoot(join(root, "child")), root);
    assert.throws(() => resolveCollectionPath(root, "../escape"), /relative path/);
    assert.throws(() => resolveCollectionPath(root, "/tmp/escape"), /relative path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveCollectionPath rejects symlink escapes including nonexistent children", () => {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-collection-"));
  const outside = mkdtempSync(join(tmpdir(), "agentfolio-outside-"));
  try {
    symlinkSync(outside, join(root, "outside-link"), "dir");
    assert.throws(() => resolveCollectionPath(root, "outside-link"), /real collection root/);
    assert.throws(() => resolveCollectionPath(root, "outside-link/missing"), /real collection root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("loadCollection loads generic demo adapter", () => {
  const collection = loadCollection(demoRoot);
  assert.equal(collection.doc.name, "demo");
  assert.equal(collection.doc.version, 1);
  assert.ok(collection.doc.skills?.local);
  assert.equal(collection.doc.harnesses.project.adapter, "demo");
  assert.equal(collection.doc.harnesses.project.actions[0].action, "configure-project");
});

test("listLocalSkills finds hello-skill", () => {
  const skills = listLocalSkills(demoRoot, "./skills");
  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, "hello-skill");
});

test("default demo plan includes native Skills CLI and adapter actions", () => {
  const plan = buildPlan(loadCollection(demoRoot));
  assert.equal(plan.collection.name, "demo");
  assert.deepEqual(plan.profile, { name: "default", skills: true, harnesses: ["project"] });
  assert.ok(plan.actions.some((action) => action.executor === "skills-cli"));
  assert.ok(plan.actions.some((action) => action.executor === "adapter"));
});

test("applies the already-built skills command", () => {
  const collection = loadCollection(demoRoot);
  const planned = buildPlan(collection).actions.find((action) => action.executor === "skills-cli");
  const report = applyCollection(collection, { dryRun: true });
  assert.deepEqual(report.results.find((result) => result.executor === "skills-cli").command, planned.command);
});

test("plan invokes adapter actions in declared order", () => {
  const plan = buildPlan(harnessCollection([
    { action: "first", summary: "First" },
    { action: "second", summary: "Second" },
  ]));
  assert.deepEqual(plan.actions.map((action) => action.action), ["first", "second"]);
  assert.ok(plan.actions.every((action) => action.executor === "adapter"));
  assert.deepEqual(plan.actions[0].command, ["fixture", "terminal", "first"]);
});

test("profile filters skills and harnesses", () => {
  const plan = buildPlan(harnessCollection([{ action: "setup" }], {
    none: { skills: false, harnesses: [] },
  }), { profile: "none" });
  assert.deepEqual(plan.profile, { name: "none", skills: false, harnesses: [] });
  assert.deepEqual(plan.actions, []);
});

test("apply propagates dry-run to adapter", () => {
  const report = applyCollection(harnessCollection(), { dryRun: true });
  assert.equal(report.ok, true);
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].executor, "adapter");
  assert.equal(report.results[0].adapter, "fixture");
  assert.equal(report.results[0].dryRun, true);
});

test("apply fails fast when an adapter action rejects", () => {
  const report = applyCollection(harnessCollection([
    { action: "first" },
    { action: "reject" },
    { action: "third" },
  ]));
  assert.equal(report.ok, false);
  assert.equal(report.results.length, 2);
  assert.match(report.results[1].stderr, /rejected request/);
  assert.equal(Object.hasOwn(report.results[1], "changed"), false);
  assert.equal(Object.hasOwn(report.results[1], "changed"), false);
});

test("adapter responses cannot overwrite orchestration metadata", () => {
  const report = applyCollection(harnessCollection([{ action: "spoof" }]), { dryRun: true });
  const [result] = report.results;
  assert.equal(result.kind, "harness.action");
  assert.equal(result.executor, "adapter");
  assert.equal(result.adapter, "fixture");
  assert.equal(result.harness, "terminal");
  assert.equal(result.action, "spoof");
  assert.equal(result.dryRun, true);
  assert.equal(result.changed, true);
});

test("apply with no selected actions succeeds", () => {
  const report = applyCollection({
    root: demoRoot,
    doc: { name: "empty", version: 1 },
    warnings: [],
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.results, []);
});

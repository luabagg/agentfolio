import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findCollectionRoot,
  loadCollection,
  listLocalSkills,
} from "../src/lib/collection.mjs";
import { buildPlan } from "../src/lib/plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const demoRoot = join(repoRoot, "examples", "demo-collection");

test("findCollectionRoot discovers demo collection", () => {
  const root = findCollectionRoot(demoRoot);
  assert.equal(root, demoRoot);
});

test("findCollectionRoot accepts explicit path", () => {
  const root = findCollectionRoot(process.cwd(), demoRoot);
  assert.equal(root, demoRoot);
});

test("loadCollection loads demo", () => {
  const collection = loadCollection(demoRoot);
  assert.equal(collection.doc.name, "demo");
  assert.equal(collection.doc.version, 1);
  assert.ok(collection.doc.skills?.local);
  assert.ok(Array.isArray(collection.doc.harnesses));
});

test("listLocalSkills finds hello-skill", () => {
  const skills = listLocalSkills(demoRoot, "./skills");
  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, "hello-skill");
});

test("buildPlan includes skills-cli and chezmoi actions", () => {
  const collection = loadCollection(demoRoot);
  const plan = buildPlan(collection);
  assert.equal(plan.collection.name, "demo");
  assert.ok(plan.actions.some((a) => a.backend === "skills-cli"));
  assert.ok(plan.actions.some((a) => a.backend === "chezmoi"));
  assert.ok(plan.actions.some((a) => a.kind === "tools.reference"));
  assert.equal(plan.chezmoiRequired, false);
});

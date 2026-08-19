import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCollection } from "../src/lib/collection.mjs";
import { PI_PROFILES, loadPiContext, planPiSetup } from "../src/harnesses/pi.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const bin = join(repoRoot, "bin", "agentfolio.mjs");
const collectionRoot = join(repoRoot, "..", "agent-skills");
const node = process.execPath;

function run(args) {
  return spawnSync(node, [bin, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
  });
}

test("pi-catalog profile is catalog-only and skips the Cursor bridge", () => {
  assert.equal(PI_PROFILES["pi-catalog"].catalogOnly, true);
  assert.equal(PI_PROFILES["pi-catalog"].skipCursorBridge, true);
});

test("planPiSetup catalog-only skips packages and extensions", async () => {
  const collection = loadCollection(collectionRoot);
  const context = await loadPiContext(collection);
  const plan = planPiSetup(context, { catalogOnly: true });
  assert.deepEqual(plan.phases, ["catalog"]);
  assert.equal(plan.packages.length, 0);
  assert.equal(plan.extensions.length, 0);
  assert.ok(plan.providers.length >= 1);
});

test("setup pi --catalog-only --dry-run does not fail", () => {
  const result = run([
    "setup",
    "pi",
    "--catalog-only",
    "--dry-run",
    "--collection",
    collectionRoot,
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Pi setup: OK \(dry-run\)/);
  assert.match(result.stdout, /Phases: catalog/);
});

test("apply --profile pi-catalog --dry-run uses Pi setup", () => {
  const result = run([
    "apply",
    "--profile",
    "pi-catalog",
    "--dry-run",
    "--collection",
    collectionRoot,
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Pi setup: OK \(dry-run\)/);
});

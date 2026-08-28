import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const demoRoot = join(repoRoot, "examples", "demo-collection");
const adapter = join(demoRoot, "scripts", "demo-adapter.mjs");

for (const request of [
  { protocolVersion: 1, operation: "plan", action: { name: "configure-project", config: {} } },
  { protocolVersion: 1, operation: "apply", dryRun: true, action: { name: "configure-project", config: {} } },
  { protocolVersion: 1, operation: "doctor", action: null },
]) {
  test(`demo adapter ${request.operation} does not mutate the collection`, () => {
    const before = readdirSync(demoRoot, { recursive: true }).sort();
    const result = spawnSync(process.execPath, [adapter], { input: JSON.stringify(request), encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.deepEqual(readdirSync(demoRoot, { recursive: true }).sort(), before);
  });
}

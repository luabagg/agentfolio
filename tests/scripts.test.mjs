import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dependencies = join(root, "scripts", "check-dependencies.mjs");
const secrets = join(root, "scripts", "secret-scan.mjs");

function run(script, file) {
  return spawnSync(process.execPath, [script, file], { encoding: "utf8" });
}

test("dependency policy requires exact versions and disallows lifecycle scripts", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentfolio-policy-"));
  try {
    const file = join(dir, "package.json");
    writeFileSync(file, JSON.stringify({ dependencies: { yaml: "^2.9.0" } }));
    assert.notEqual(run(dependencies, file).status, 0);
    assert.match(run(dependencies, file).stderr, /exact/);
    writeFileSync(file, JSON.stringify({ scripts: { postinstall: "x" } }));
    assert.notEqual(run(dependencies, file).status, 0);
    assert.match(run(dependencies, file).stderr, /disallowed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("secret scanner permits only documented placeholders", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentfolio-secret-"));
  try {
    const file = join(dir, "fixture.env");
    writeFileSync(file, "API_KEY=" + ["test", "credential", "123456789012"].join("-"));
    assert.notEqual(run(secrets, file).status, 0);
    writeFileSync(file, "API_KEY=[REDACTED]");
    assert.equal(run(secrets, file).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

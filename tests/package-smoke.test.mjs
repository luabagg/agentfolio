import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("packed package contains public runtime files but no test fixtures", () => {
  let tarball;
  try {
    const packed = spawnSync("npm", ["pack", "--json"], { cwd: root, encoding: "utf8", shell: false });
    assert.equal(packed.status, 0, packed.stderr);
    tarball = JSON.parse(packed.stdout)[0].filename;
    const contents = spawnSync("tar", ["-tf", tarball], { cwd: root, encoding: "utf8", shell: false });
    assert.equal(contents.status, 0, contents.stderr);
    assert.match(contents.stdout, /package\/bin\/agentfolio\.mjs/);
    assert.match(contents.stdout, /package\/src\/lib\/run\.mjs/);
    assert.match(contents.stdout, /package\/docs\/architecture\.md/);
    assert.doesNotMatch(contents.stdout, /package\/tests\/fixtures\/harness-adapter\.mjs/);
  } finally {
    if (tarball) rmSync(join(root, tarball), { force: true });
  }
});

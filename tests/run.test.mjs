import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { redactText, redactValue, runProcess } from "../src/lib/run.mjs";

test("redacts sensitive inherited environment output without options.env", () => {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-run-inherited-"));
  const previous = process.env.AGENTFOLIO_INHERITED_TOKEN;
  const rawSentinel = ["test", "credential", "123456789012"].join("-");
  try {
    const child = join(root, "child.mjs");
    writeFileSync(child, "console.log(process.env.AGENTFOLIO_INHERITED_TOKEN)");
    process.env.AGENTFOLIO_INHERITED_TOKEN = rawSentinel;
    const result = runProcess([process.execPath, child]);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, new RegExp(rawSentinel));
    assert.match(result.stdout, /\[REDACTED\]/);
  } finally {
    if (previous === undefined) delete process.env.AGENTFOLIO_INHERITED_TOKEN;
    else process.env.AGENTFOLIO_INHERITED_TOKEN = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs literal argv with inherited environment and redacts sensitive output", () => {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-run-"));
  try {
    const child = join(root, "child.mjs");
    writeFileSync(child, `
if (process.argv[2] === "sleep") await new Promise((resolve) => setTimeout(resolve, 200));
console.log([process.argv.slice(2).join("|"), process.env.VISIBLE_VALUE, process.env.AGENTFOLIO_TEST_TOKEN].join("|"));
`);
    const rawSentinel = ["test", "credential", "123456789012"].join("-");
    const result = runProcess([process.execPath, child, "literal&value"], {
      env: { ...process.env, VISIBLE_VALUE: "visible", AGENTFOLIO_TEST_TOKEN: rawSentinel },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /literal&value\|visible/);
    assert.doesNotMatch(result.stdout, new RegExp(rawSentinel));
    assert.match(result.stdout, /\[REDACTED\]/);
    assert.throws(() => runProcess([]), /non-empty argv/);
    assert.equal(redactText('"authorization":"value-123456789012"'), '"authorization":"[REDACTED]"');
    assert.equal(redactText('cookie="value-123456789012" key=value-123456789012'), 'cookie="[REDACTED]" key=[REDACTED]');
    assert.deepEqual(redactValue({ nested: { apiKey: "[REDACTED]" }, ok: true }), { nested: { apiKey: "[REDACTED]" }, ok: true });
    assert.equal(runProcess([process.execPath, child, "sleep"], { timeout: 10 }).timedOut, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

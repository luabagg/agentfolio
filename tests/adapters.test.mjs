import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { adapterRequest, runAdapter } from "../src/lib/adapters.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixtureAdapter = join(fixtures, "harness-adapter.mjs");

function collection(action = "setup", timeout = 1_000, adapterArg) {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-adapter-"));
  const command = [process.execPath, fixtureAdapter];
  if (adapterArg) command.push(adapterArg);
  return {
    root,
    warnings: [],
    doc: {
      name: "demo",
      version: 1,
      adapters: { fixture: { command, timeout } },
      harnesses: {
        terminal: {
          adapter: "fixture",
          actions: [{ action, summary: "Fixture action", value: 42 }],
        },
      },
    },
  };
}

test("runs adapter with protocol JSON on stdin from collection root", () => {
  const current = collection();
  const config = current.doc.harnesses.terminal.actions[0];
  const request = adapterRequest(current, "plan", "terminal", { index: 0, config });
  const response = runAdapter(current, "fixture", request);

  assert.equal(response.ok, true);
  assert.deepEqual(response.command, ["fixture", "terminal", "setup"]);
  assert.equal(response.observed.cwd, current.root);
  assert.equal(response.observed.request.protocolVersion, 1);
  assert.equal(response.observed.request.action.name, "setup");
  assert.equal(response.observed.request.action.config.value, 42);
});

test("passes adapter argv literally without shell expansion", () => {
  const current = collection("setup", 1_000, "literal&value");
  const config = current.doc.harnesses.terminal.actions[0];
  const request = adapterRequest(current, "plan", "terminal", { index: 0, config });
  const response = runAdapter(current, "fixture", request);
  assert.deepEqual(response.observed.argv, ["literal&value"]);
});

test("builds doctor request with harness actions and no action", () => {
  const current = collection();
  const request = adapterRequest(current, "doctor", "terminal", null);
  const response = runAdapter(current, "fixture", request);

  assert.equal(request.action, null);
  assert.deepEqual(request.harness.actions, current.doc.harnesses.terminal.actions);
  assert.equal(response.checks[0].id, "fixture");
});

test("rejects malformed optional response fields", () => {
  const current = collection("setup", 1_000, "bad-command");
  const config = current.doc.harnesses.terminal.actions[0];
  const request = adapterRequest(current, "plan", "terminal", { index: 0, config });
  assert.throws(() => runAdapter(current, "fixture", request), /response.command/);
});

test("requires valid doctor checks", () => {
  const missing = collection("setup", 1_000, "missing-checks");
  const malformed = collection("setup", 1_000, "bad-checks");
  assert.throws(
    () => runAdapter(missing, "fixture", adapterRequest(missing, "doctor", "terminal", null)),
    /response.checks/,
  );
  assert.throws(
    () => runAdapter(malformed, "fixture", adapterRequest(malformed, "doctor", "terminal", null)),
    /checks\[0\]\.ok/,
  );
});

test("rejects invalid adapter JSON", () => {
  const current = collection("invalid-json");
  const config = current.doc.harnesses.terminal.actions[0];
  const request = adapterRequest(current, "plan", "terminal", { index: 0, config });
  assert.throws(() => runAdapter(current, "fixture", request), /invalid JSON/);
});

test("rejects non-zero adapter exit", () => {
  const current = collection("exit");
  const config = current.doc.harnesses.terminal.actions[0];
  const request = adapterRequest(current, "apply", "terminal", { index: 0, config });
  assert.throws(() => runAdapter(current, "fixture", request), /adapter exploded/);
});

test("rejects adapter response with ok false", () => {
  const current = collection("reject");
  const config = current.doc.harnesses.terminal.actions[0];
  const request = adapterRequest(current, "apply", "terminal", { index: 0, config });
  assert.throws(() => runAdapter(current, "fixture", request), /action rejected/);
});

test("rejects timed out adapter", () => {
  const current = collection("sleep", 10);
  const config = current.doc.harnesses.terminal.actions[0];
  const request = adapterRequest(current, "plan", "terminal", { index: 0, config });
  assert.throws(() => runAdapter(current, "fixture", request), /timed out/);
});

test("rejects undeclared adapter", () => {
  const current = collection();
  const request = adapterRequest(current, "doctor", "terminal", null);
  assert.throws(() => runAdapter(current, "missing", request), /Unknown adapter/);
});

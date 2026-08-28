import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { adapterRequest, runAdapter } from "../src/lib/adapters.mjs";
import { buildPlan } from "../src/lib/plan.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixtureAdapter = join(fixtures, "harness-adapter.mjs");

function collection(action = "setup", timeout = 1_000, adapterArg) {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-adapter-"));
  const args = [fixtureAdapter];
  if (adapterArg) args.push(adapterArg);
  return {
    root,
    warnings: [],
    doc: {
      name: "demo",
      version: 1,
      adapters: { fixture: { executable: process.execPath, args, timeout } },
      harnesses: { terminal: { adapter: "fixture", actions: [{ action, summary: "Fixture action", config: { value: 42 } }] } },
    },
  };
}

function requestFor(current, operation = "plan") {
  const config = current.doc.harnesses.terminal.actions[0];
  return adapterRequest(current, operation, "terminal", operation === "doctor" ? null : { index: 0, config });
}

test("runs adapter with protocol JSON on stdin from collection root", () => {
  const current = collection();
  const response = runAdapter(current, "fixture", requestFor(current));
  assert.equal(response.ok, true);
  assert.deepEqual(response.command, ["fixture", "terminal", "setup"]);
  assert.equal(response.detail.cwd, current.root);
  assert.equal(response.detail.request.protocolVersion, 1);
  assert.equal(response.detail.request.action, "setup");
});

test("passes adapter argv literally without shell expansion", () => {
  const current = collection("setup", 1_000, "literal&value");
  assert.deepEqual(runAdapter(current, "fixture", requestFor(current)).detail.argv, ["literal&value"]);
});

test("builds doctor request with harness actions and no action", () => {
  const current = collection();
  const request = requestFor(current, "doctor");
  const response = runAdapter(current, "fixture", request);
  assert.equal(request.action, null);
  assert.deepEqual(request.harness.actions, current.doc.harnesses.terminal.actions);
  assert.equal(response.checks[0].id, "fixture");
});

test("rejects malformed and unsafe response fields", () => {
  for (const mode of ["bad-command", "extra-field", "secret-detail"]) {
    const current = collection("setup", 1_000, mode);
    assert.throws(() => runAdapter(current, "fixture", requestFor(current)), mode === "extra-field" ? /unexpected field/ : /response\.(command|detail)|sensitive/);
  }
  const rejected = collection("setup", 1_000, "reject-secret");
  assert.throws(
    () => runAdapter(rejected, "fixture", requestFor(rejected)),
    (error) => !String(error.message).includes("[REDACTED]") && /rejected request/.test(error.message),
  );
});

test("redacts configured adapter command values in plans", () => {
  const current = collection("setup", 1_000, "no-command");
  const rawValue = ["authorization", "test", "credential", "123456789012"].join("=");
  current.doc.adapters.fixture.args.push(rawValue);
  const output = JSON.stringify(buildPlan(current));
  assert.doesNotMatch(output, /test-credential-123456789012/);
  assert.match(output, /\[REDACTED\]/);
});

test("requires valid doctor checks", () => {
  const missing = collection("setup", 1_000, "missing-checks");
  const malformed = collection("setup", 1_000, "bad-checks");
  assert.throws(() => runAdapter(missing, "fixture", requestFor(missing, "doctor")), /response.checks/);
  assert.throws(() => runAdapter(malformed, "fixture", requestFor(malformed, "doctor")), /checks\[0\]\.ok/);
});

test("rejects invalid adapter JSON, exit, and rejection without output leaks", () => {
  for (const [action, operation, matcher] of [["invalid-json", "plan", /invalid JSON/], ["exit", "apply", /failed with status 2/], ["reject", "apply", /rejected request/]]) {
    const current = collection(action);
    assert.throws(() => runAdapter(current, "fixture", requestFor(current, operation)), (error) => matcher.test(error.message) && !/adapter exploded|action rejected/.test(error.message));
  }
});

test("rejects timed out and undeclared adapters", () => {
  const current = collection("sleep", 10);
  assert.throws(() => runAdapter(current, "fixture", requestFor(current)), /timed out/);
  assert.throws(() => runAdapter(current, "missing", requestFor(current, "doctor")), /Unknown adapter/);
});

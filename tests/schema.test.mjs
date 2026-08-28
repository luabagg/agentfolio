import assert from "node:assert/strict";
import test from "node:test";
import { validateCollection, COLLECTION_SCHEMA_VERSION } from "../src/lib/schema.mjs";

test("accepts minimal valid collection", () => {
  const result = validateCollection({ name: "demo", version: COLLECTION_SCHEMA_VERSION });
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});

test("rejects missing name/version", () => {
  const result = validateCollection({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("name")));
  assert.ok(result.errors.some((error) => error.includes("version")));
});

test("accepts collection-owned harness actions and adapters", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    skills: { local: "./skills", scope: "global", agents: ["*"], copy: false },
    tools: { catalog: "./tools.json" },
    adapters: {
      local: { executable: "node", args: ["./scripts/adapter.mjs"], timeout: 30_000 },
    },
    harnesses: {
      terminal: {
        adapter: "local",
        actions: [
          { action: "add-plugin", config: { source: "example" } },
          { action: "add-agents", config: { source: "./agents" } },
        ],
      },
    },
    profiles: {
      default: { skills: true, harnesses: ["terminal"] },
      skills: { skills: true, harnesses: [] },
    },
  });
  assert.equal(result.ok, true);
});

test("rejects escaping paths and sensitive keys in every schema value", () => {
  const docs = [
    { name: "demo", version: 1, skills: { local: "../skills" } },
    { name: "demo", version: 1, tools: { catalog: "/tmp/catalog.json" } },
    { name: "demo", version: 1, skills: { token: "[REDACTED]" } },
    { name: "demo", version: 1, adapters: { local: { executable: "node", args: ["./adapter.mjs"], authorization: "[REDACTED]" } } },
    { name: "demo", version: 1, profiles: { default: { apiKey: "[REDACTED]" } } },
  ];
  for (const doc of docs) assert.equal(validateCollection(doc).ok, false);
  assert.ok(validateCollection(docs[0]).errors.some((error) => error.includes("skills.local")));
  assert.ok(validateCollection(docs[1]).errors.some((error) => error.includes("tools.catalog")));
  assert.ok(validateCollection(docs[2]).errors.some((error) => error.includes("sensitive")));
});

test("rejects invalid skills options", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    skills: { scope: "machine", agents: "all", copy: "yes" },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("skills.scope")));
  assert.ok(result.errors.some((error) => error.includes("skills.agents")));
  assert.ok(result.errors.some((error) => error.includes("skills.copy")));
});

test("requires executable and args, rejects command, and validates timeout", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    adapters: {
      valid: { executable: "node", args: ["./adapter.mjs"], timeout: 1 },
      emptyExecutable: { executable: "", args: [] },
      badArgs: { executable: "node", args: [""] },
      legacy: { command: ["node", "adapter.mjs"] },
      timeout: { executable: "node", args: [], timeout: 0 },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("adapters.emptyExecutable.executable")));
  assert.ok(result.errors.some((error) => error.includes("adapters.badArgs.args")));
  assert.ok(result.errors.some((error) => error.includes("adapters.legacy.command is not allowed")));
  assert.ok(result.errors.some((error) => error.includes("adapters.legacy.args")));
  assert.ok(result.errors.some((error) => error.includes("adapters.timeout.timeout")));
  assert.equal(validateCollection({ name: "demo", version: 1, adapters: { valid: { executable: "node", args: [] } } }).ok, true);
});

test("rejects harnesses with missing adapters or malformed actions", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    adapters: { local: { executable: "node", args: ["adapter.mjs"] } },
    harnesses: {
      missing: { adapter: "unknown", actions: [{ action: "setup" }] },
      empty: { adapter: "local", actions: [] },
      malformed: { adapter: "local", actions: ["setup", { summary: "missing action" }] },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("unknown adapter")));
  assert.ok(result.errors.some((error) => error.includes("harnesses.empty.actions")));
  assert.ok(result.errors.some((error) => error.includes("harnesses.malformed.actions[0]")));
  assert.ok(result.errors.some((error) => error.includes("harnesses.malformed.actions[1].action")));
});

test("rejects profile with unknown harness", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    profiles: { bad: { skills: false, harnesses: ["missing"] } },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("profiles.bad.harnesses[0]")));
});

test("accepts wildcard harness profile", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    adapters: { local: { executable: "node", args: ["adapter.mjs"] } },
    harnesses: { terminal: { adapter: "local", actions: [{ action: "setup" }] } },
    profiles: { default: { skills: false, harnesses: ["*"] } },
  });
  assert.equal(result.ok, true);
});

test("rejects backend-shaped legacy collection fields", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    harnesses: [{ id: "terminal", source: "./terminal", backend: "chezmoi" }],
    instructions: { backend: "chezmoi" },
    chezmoi: { destinationDir: "$HOME" },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("harnesses must be a mapping")));
  assert.ok(result.errors.some((error) => error.includes("unknown top-level field: instructions")));
  assert.ok(result.errors.some((error) => error.includes("unknown top-level field: chezmoi")));
});

import assert from "node:assert/strict";
import test from "node:test";
import { validateCollection, COLLECTION_SCHEMA_VERSION } from "../src/lib/schema.mjs";

test("accepts minimal valid collection", () => {
  const result = validateCollection({
    name: "demo",
    version: COLLECTION_SCHEMA_VERSION,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});

test("rejects missing name/version", () => {
  const result = validateCollection({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("name")));
  assert.ok(result.errors.some((e) => e.includes("version")));
});

test("rejects unknown backend", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    skills: { backend: "magic", local: "./skills" },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("unknown")));
});

test("accepts full inventory shape", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    skills: { backend: "skills-cli", local: "./skills" },
    tools: { backend: "reference", catalog: "./tools/catalog.json", apply: "reference" },
    harnesses: [
      { id: "pi", source: "./harnesses/pi", backend: "chezmoi" },
      { id: "cursor", source: "./harnesses/cursor", backend: "chezmoi" },
    ],
    instructions: { global: "./AGENTS.global.md", backend: "chezmoi" },
    plugins: { backend: "none" },
    chezmoi: { sourceDir: "./chezmoi", destinationDir: "./apply-target" },
  });
  assert.equal(result.ok, true);
});

test("rejects duplicate harness ids", () => {
  const result = validateCollection({
    name: "demo",
    version: 1,
    harnesses: [
      { id: "pi", source: "./a", backend: "chezmoi" },
      { id: "pi", source: "./b", backend: "chezmoi" },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate")));
});

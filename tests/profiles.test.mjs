import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfile } from "../src/lib/profiles.mjs";

const doc = {
  skills: { local: "./skills" },
  harnesses: { first: {}, second: {} },
};

test("implicit default profile selects skills and every harness", () => {
  assert.deepEqual(resolveProfile(doc, "default"), {
    name: "default",
    skills: true,
    harnesses: ["first", "second"],
  });
});

test("resolves collection-defined profile", () => {
  const current = {
    ...doc,
    profiles: { focused: { skills: false, harnesses: ["second"] } },
  };
  assert.deepEqual(resolveProfile(current, "focused"), {
    name: "focused",
    skills: false,
    harnesses: ["second"],
  });
});

test("expands wildcard harness selector without duplicates", () => {
  const current = {
    ...doc,
    profiles: { all: { skills: true, harnesses: ["second", "*", "first"] } },
  };
  assert.deepEqual(resolveProfile(current, "all").harnesses, ["second", "first"]);
});

test("declared profile defaults skills from collection and harnesses to all", () => {
  const current = { ...doc, profiles: { inherited: {} } };
  assert.deepEqual(resolveProfile(current, "inherited"), {
    name: "inherited",
    skills: true,
    harnesses: ["first", "second"],
  });
});

test("rejects unknown profile", () => {
  assert.throws(() => resolveProfile(doc, "missing"), /Unknown profile: missing/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySkills, planSkills } from "../src/backends/skills-cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, "..", "examples", "demo-collection");

test("defaults to global installation for every agent", () => {
  const [action] = planSkills({
    root: demoRoot,
    doc: { skills: { local: "./skills" } },
  });
  assert.ok(action.command.includes("--global"));
  assert.deepEqual(action.detail.agents, ["*"]);
  assert.equal(action.detail.scope, "global");
});

test("builds project copy command for selected agents", () => {
  const [action] = planSkills({
    root: demoRoot,
    doc: {
      skills: {
        local: "./skills",
        scope: "project",
        agents: ["terminal-agent", "editor-agent"],
        copy: true,
      },
    },
  });
  assert.equal(action.command.includes("--global"), false);
  assert.ok(action.command.includes("--copy"));
  assert.deepEqual(action.detail.agents, ["terminal-agent", "editor-agent"]);
  assert.equal(action.detail.scope, "project");
});

test("installs project-scoped skills into the invoking project", () => {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-collection-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "agentfolio-project-"));
  const bin = mkdtempSync(join(tmpdir(), "agentfolio-bin-"));
  const cwdFile = join(root, "skills-cwd.txt");
  const fakeNpx = join(bin, "npx");
  const previousPath = process.env.PATH;
  const previousCwdFile = process.env.SKILLS_CWD_FILE;

  mkdirSync(join(root, "skills", "demo"), { recursive: true });
  writeFileSync(join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");
  writeFileSync(fakeNpx, "#!/bin/sh\npwd > \"$SKILLS_CWD_FILE\"\n", { mode: 0o755 });
  chmodSync(fakeNpx, 0o755);
  process.env.PATH = `${bin}:${previousPath}`;
  process.env.SKILLS_CWD_FILE = cwdFile;

  try {
    const results = applySkills({
      root,
      doc: { skills: { local: "./skills", scope: "project" } },
    }, { projectRoot });
    assert.equal(results[0].status, 0);
    assert.equal(readFileSync(cwdFile, "utf8").trim(), projectRoot);
  } finally {
    process.env.PATH = previousPath;
    if (previousCwdFile === undefined) delete process.env.SKILLS_CWD_FILE;
    else process.env.SKILLS_CWD_FILE = previousCwdFile;
    rmSync(root, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

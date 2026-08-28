import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySkills, planSkills, resolveSkillsBin, skillsCommand } from "../src/backends/skills-cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const demoRoot = join(repoRoot, "examples", "demo-collection");

test("builds pinned package-owned literal skills commands", () => {
  const command = skillsCommand(["add", "./skills", "--global"]);
  assert.equal(isAbsolute(command[0]), true);
  assert.equal(command[0].startsWith(repoRoot), true);
  assert.equal(command[0], resolveSkillsBin());
  assert.equal(command[0].includes("npx"), false);
  const fakeCommand = skillsCommand(["add", "./skills"], "/tmp/fake-skills");
  assert.equal(fakeCommand[0], "/tmp/fake-skills");
});

test("defaults to global installation for every agent", () => {
  const [action] = planSkills({ root: demoRoot, doc: { skills: { local: "./skills" } } });
  assert.ok(action.command.includes("--global"));
  assert.deepEqual(action.detail.agents, ["*"]);
  assert.equal(action.detail.scope, "global");
});

test("builds project copy command for selected agents", () => {
  const [action] = planSkills({
    root: demoRoot,
    doc: { skills: { local: "./skills", scope: "project", agents: ["terminal-agent", "editor-agent"], copy: true } },
  });
  assert.equal(action.command.includes("--global"), false);
  assert.ok(action.command.includes("--copy"));
  assert.deepEqual(action.detail.agents, ["terminal-agent", "editor-agent"]);
  assert.equal(action.detail.scope, "project");
});

test("installs planned project-scoped skills into the invoking project", () => {
  const root = mkdtempSync(join(tmpdir(), "agentfolio-collection-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "agentfolio-project-"));
  const bin = mkdtempSync(join(tmpdir(), "agentfolio-bin-"));
  const cwdFile = join(root, "skills-cwd.txt");
  const fakeSkills = join(bin, "skills");
  mkdirSync(join(root, "skills", "demo"), { recursive: true });
  writeFileSync(join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");
  writeFileSync(fakeSkills, "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.SKILLS_CWD_FILE, process.cwd())\n", { mode: 0o755 });
  chmodSync(fakeSkills, 0o755);
  const collection = { root, doc: { skills: { local: "./skills", scope: "project" } } };
  const [action] = planSkills(collection);
  const actions = [{ ...action, command: skillsCommand(action.command.slice(1), fakeSkills) }];
  const previousCwdFile = process.env.SKILLS_CWD_FILE;
  process.env.SKILLS_CWD_FILE = cwdFile;
  try {
    const results = applySkills(collection, { actions, projectRoot });
    assert.equal(results[0].status, 0);
    assert.equal(readFileSync(cwdFile, "utf8").trim(), projectRoot);
  } finally {
    if (previousCwdFile === undefined) delete process.env.SKILLS_CWD_FILE;
    else process.env.SKILLS_CWD_FILE = previousCwdFile;
    rmSync(root, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

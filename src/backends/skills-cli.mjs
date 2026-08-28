import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCollectionPath, listLocalSkills } from "../lib/collection.mjs";
import { runProcess } from "../lib/run.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveSkillsBin(root = packageRoot) {
  return join(root, "node_modules", ".bin", process.platform === "win32" ? "skills.cmd" : "skills");
}

export function skillsCommand(args, executable = resolveSkillsBin()) {
  return [executable, ...args];
}

/** Plan skills-cli actions for a collection. */
export function planSkills(collection) {
  const { root, doc } = collection;
  const skills = doc.skills;
  if (!skills) return [];
  const actions = [];
  const local = skills.local ? resolveCollectionPath(root, skills.local) : null;
  const localSkills = skills.local ? listLocalSkills(root, skills.local) : [];

  if (skills.local) {
    const scope = skills.scope ?? "global";
    const agents = skills.agents ?? ["*"];
    const command = skillsCommand(["add", local ?? skills.local]);
    if (scope === "global") command.push("--global");
    for (const agent of agents) command.push("--agent", agent);
    command.push("--skill", "*", "--yes");
    if (skills.copy) command.push("--copy");
    actions.push({
      kind: "skills.local",
      executor: "skills-cli",
      summary: `Install ${localSkills.length} local skill(s) from ${skills.local}`,
      command,
      detail: { path: local, skills: localSkills.map((skill) => skill.id), scope, agents, copy: Boolean(skills.copy) },
    });
  }

  if (skills.imports) {
    const importsPath = resolveCollectionPath(root, skills.imports);
    actions.push({
      kind: "skills.imports",
      executor: "skills-cli",
      summary: `Reference skill imports from ${skills.imports}`,
      command: null,
      detail: { path: importsPath, exists: Boolean(importsPath && existsSync(importsPath)), note: "Imports are reference-only and are not installed." },
    });
  }
  return actions;
}

export function listSkillsInventory(collection) {
  const { root, doc } = collection;
  const skills = doc.skills;
  if (!skills?.local) return { local: [], imports: null };
  return { local: listLocalSkills(root, skills.local), imports: skills.imports ?? null };
}

/** Apply the already-planned local skills actions via the pinned Skills CLI. */
export function applySkills(collection, { actions = [], dryRun = false, projectRoot = process.cwd() } = {}) {
  const results = [];
  for (const action of actions.filter((candidate) => candidate.command)) {
    if (dryRun) {
      results.push({ ...action, dryRun: true, status: 0, stdout: `dry-run: ${action.command.join(" ")}` });
      continue;
    }
    const cwd = action.detail?.scope === "project" ? projectRoot : collection.root;
    const result = runProcess(action.command, { cwd });
    results.push({ ...action, ...result });
    if (result.status !== 0) break;
  }
  return results;
}

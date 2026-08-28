import { existsSync } from "node:fs";
import { resolveCollectionPath, listLocalSkills } from "../lib/collection.mjs";
import { formatCommandResult, npx, runCommand } from "../lib/run.mjs";

/**
 * Plan skills-cli actions for a collection.
 * @returns {Array<{ kind: string, executor: string, summary: string, command?: string[], detail?: object }>}
 */
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
    const command = [npx, "--yes", "skills", "add", local ?? skills.local];
    if (scope === "global") command.push("--global");
    for (const agent of agents) command.push("--agent", agent);
    command.push("--skill", "*", "--yes");
    if (skills.copy) command.push("--copy");

    actions.push({
      kind: "skills.local",
      executor: "skills-cli",
      summary: `Install ${localSkills.length} local skill(s) from ${skills.local}`,
      command,
      detail: {
        path: local,
        skills: localSkills.map((skill) => skill.id),
        scope,
        agents,
        copy: Boolean(skills.copy),
      },
    });
  }

  if (skills.imports) {
    const importsPath = resolveCollectionPath(root, skills.imports);
    actions.push({
      kind: "skills.imports",
      executor: "skills-cli",
      summary: `Apply skill imports from ${skills.imports}`,
      command: null,
      detail: {
        path: importsPath,
        exists: Boolean(importsPath && existsSync(importsPath)),
        note: "Import pins are listed for plan/verify; install via skills add <source> per pin file in later versions.",
      },
    });
  }

  return actions;
}

export function listSkillsInventory(collection) {
  const { root, doc } = collection;
  const skills = doc.skills;
  if (!skills?.local) return { local: [], imports: null };
  return {
    local: listLocalSkills(root, skills.local),
    imports: skills.imports ?? null,
  };
}

/**
 * Apply local skills via skills-cli.
 */
export function applySkills(collection, { dryRun = false, projectRoot = process.cwd() } = {}) {
  const actions = planSkills(collection).filter((a) => a.command);
  const results = [];

  for (const action of actions) {
    if (dryRun) {
      results.push({
        ...action,
        dryRun: true,
        status: 0,
        stdout: `dry-run: ${action.command.join(" ")}`,
      });
      continue;
    }

    const cwd = action.detail.scope === "project" ? projectRoot : collection.root;
    const result = formatCommandResult(runCommand(action.command, { cwd }));
    results.push({ ...action, ...result });
    if (result.status !== 0) break;
  }

  return results;
}

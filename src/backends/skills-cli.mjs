import { existsSync } from "node:fs";
import { resolveCollectionPath, listLocalSkills } from "../lib/collection.mjs";
import { formatCommandResult, npx, runCommand } from "../lib/run.mjs";

/**
 * Plan skills-cli actions for a collection.
 * @returns {Array<{ kind: string, backend: string, summary: string, command?: string[], detail?: object }>}
 */
export function planSkills(collection) {
  const { root, doc } = collection;
  const skills = doc.skills;
  if (!skills) return [];

  const actions = [];
  const local = skills.local ? resolveCollectionPath(root, skills.local) : null;
  const localSkills = skills.local ? listLocalSkills(root, skills.local) : [];

  if (skills.local) {
    actions.push({
      kind: "skills.local",
      backend: "skills-cli",
      summary: `Install ${localSkills.length} local skill(s) from ${skills.local}`,
      command: [npx, "--yes", "skills", "add", local ?? skills.local, "--skill", "*", "-g", "-y"],
      detail: { path: local, skills: localSkills.map((s) => s.id) },
    });
  }

  if (skills.imports) {
    const importsPath = resolveCollectionPath(root, skills.imports);
    actions.push({
      kind: "skills.imports",
      backend: "skills-cli",
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
export function applySkills(collection, { dryRun = false } = {}) {
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

    const result = formatCommandResult(runCommand(action.command, { cwd: collection.root }));
    results.push({ ...action, ...result });
    if (result.status !== 0) break;
  }

  return results;
}

import { planSkills, listSkillsInventory } from "../backends/skills-cli.mjs";
import { planChezmoi, chezmoiAvailable } from "../backends/chezmoi.mjs";
import { resolveCollectionPath, readJsonIfExists } from "./collection.mjs";
import { existsSync } from "node:fs";

/**
 * Build a full apply plan for a loaded collection.
 */
export function buildPlan(collection) {
  const { root, doc, warnings } = collection;
  const actions = [];

  actions.push(...planSkills(collection));
  actions.push(...planChezmoi(collection));

  // Reference-only inventories (no apply command)
  if (doc.tools?.catalog) {
    const catalogPath = resolveCollectionPath(root, doc.tools.catalog);
    actions.push({
      kind: "tools.reference",
      backend: doc.tools.backend ?? "reference",
      summary: `List tools catalog ${doc.tools.catalog}`,
      command: null,
      detail: {
        path: catalogPath,
        exists: Boolean(catalogPath && existsSync(catalogPath)),
        catalog: catalogPath ? readJsonIfExists(catalogPath) : null,
      },
    });
  }

  if (doc.plugins) {
    actions.push({
      kind: "plugins.hint",
      backend: doc.plugins.backend ?? "none",
      summary: "Plugins are list/hint only (no auto-install)",
      command: null,
      detail: doc.plugins,
    });
  }

  return {
    collection: {
      name: doc.name,
      version: doc.version,
      root,
    },
    warnings,
    skills: listSkillsInventory(collection),
    harnesses: doc.harnesses ?? [],
    instructions: doc.instructions ?? null,
    chezmoiRequired: chezmoiAvailable() === false && actions.some((a) => a.backend === "chezmoi"),
    actions,
  };
}

export function formatPlanText(plan) {
  const lines = [];
  lines.push(`Collection: ${plan.collection.name} (v${plan.collection.version})`);
  lines.push(`Root: ${plan.collection.root}`);
  if (plan.warnings?.length) {
    lines.push("Warnings:");
    for (const w of plan.warnings) lines.push(`  - ${w}`);
  }
  if (plan.chezmoiRequired) {
    lines.push("ERROR: chezmoi required on PATH but not found");
  }
  lines.push("");
  lines.push(`Actions (${plan.actions.length}):`);
  if (!plan.actions.length) {
    lines.push("  (none)");
  }
  for (const [i, action] of plan.actions.entries()) {
    lines.push(`  ${i + 1}. [${action.backend}] ${action.summary}`);
    if (action.command) {
      lines.push(`     $ ${action.command.join(" ")}`);
    } else {
      lines.push("     (no command — reference/hint only)");
    }
  }
  return lines.join("\n");
}

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
  const modelsPolicyPath = resolveCollectionPath(root, doc.models?.policy ?? "./harnesses/catalog.yaml");
  const modelsLockPath = resolveCollectionPath(root, doc.models?.lock ?? "./harnesses/catalog.lock.json");
  if (doc.models || existsSync(modelsPolicyPath)) {
    actions.push({
      kind: "models.check",
      backend: "models",
      summary: `Validate model catalog ${doc.models?.policy ?? "./harnesses/catalog.yaml"}`,
      command: null,
      detail: {
        policyPath: modelsPolicyPath,
        lockPath: modelsLockPath,
        policyExists: existsSync(modelsPolicyPath),
        lockExists: existsSync(modelsLockPath),
      },
    });
  }

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
    chezmoiRequired: false,
    chezmoiMissing: chezmoiAvailable() === false && actions.some((a) => a.backend === "chezmoi"),
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
  if (plan.chezmoiMissing) {
    lines.push("WARNING: chezmoi not found on PATH; apply/status/diff need chezmoi");
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

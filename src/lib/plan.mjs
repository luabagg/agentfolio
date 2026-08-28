import { existsSync } from "node:fs";
import { listSkillsInventory, planSkills } from "../backends/skills-cli.mjs";
import { adapterRequest, runAdapter } from "./adapters.mjs";
import { readJsonIfExists, resolveCollectionPath } from "./collection.mjs";
import { resolveProfile } from "./profiles.mjs";
import { redactValue } from "./run.mjs";

/** Build a concrete plan for native skills and selected harness actions. */
export function buildPlan(collection, { profile = "default" } = {}) {
  const { root, doc, warnings } = collection;
  const resolvedProfile = resolveProfile(doc, profile);
  const actions = [];

  if (resolvedProfile.skills) actions.push(...planSkills(collection));

  for (const harnessId of resolvedProfile.harnesses) {
    const harness = doc.harnesses[harnessId];
    for (const [index, config] of harness.actions.entries()) {
      const request = adapterRequest(collection, "plan", harnessId, { index, config });
      const response = runAdapter(collection, harness.adapter, request);
      actions.push({
        kind: "harness.action",
        executor: "adapter",
        adapter: harness.adapter,
        harness: harnessId,
        action: config.action,
        index,
        config,
        summary: response.summary ?? config.summary ?? `${harnessId}: ${config.action}`,
        command: redactValue(response.command ?? doc.adapters[harness.adapter].command),
        detail: response.detail ?? null,
        planned: response,
      });
    }
  }

  const toolsPath = doc.tools?.catalog ? resolveCollectionPath(root, doc.tools.catalog) : null;
  const tools = doc.tools?.catalog
    ? {
        path: toolsPath,
        exists: Boolean(toolsPath && existsSync(toolsPath)),
        catalog: toolsPath ? readJsonIfExists(toolsPath) : null,
      }
    : null;

  return {
    collection: { name: doc.name, version: doc.version, root },
    profile: resolvedProfile,
    warnings,
    skills: listSkillsInventory(collection),
    harnesses: Object.fromEntries(
      resolvedProfile.harnesses.map((id) => [id, doc.harnesses[id]]),
    ),
    tools,
    actions,
  };
}

export function formatPlanText(plan) {
  const lines = [];
  const harnesses = plan.profile.harnesses.length ? plan.profile.harnesses.join(", ") : "none";
  lines.push(`Collection: ${plan.collection.name} (v${plan.collection.version})`);
  lines.push(`Root: ${plan.collection.root}`);
  lines.push(`Profile: ${plan.profile.name} (skills=${plan.profile.skills ? "yes" : "no"}; harnesses=${harnesses})`);
  if (plan.warnings?.length) {
    lines.push("Warnings:");
    for (const warning of plan.warnings) lines.push(`  - ${warning}`);
  }
  lines.push("");
  lines.push(`Actions (${plan.actions.length}):`);
  if (!plan.actions.length) lines.push("  (none)");
  for (const [index, action] of plan.actions.entries()) {
    const owner = action.executor === "adapter" ? `${action.harness}:${action.action}` : action.executor;
    lines.push(`  ${index + 1}. [${owner}] ${action.summary}`);
    if (action.command) lines.push(`     $ ${action.command.join(" ")}`);
    else lines.push("     (no command — reference only)");
  }
  return lines.join("\n");
}

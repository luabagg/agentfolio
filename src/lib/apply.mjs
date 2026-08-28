import { applySkills } from "../backends/skills-cli.mjs";
import { adapterRequest, runAdapter } from "./adapters.mjs";
import { buildPlan } from "./plan.mjs";

/** Apply native skills and collection-owned harness actions in plan order. */
export function applyCollection(
  collection,
  { dryRun = false, profile = "default", projectRoot = process.cwd() } = {},
) {
  const plan = buildPlan(collection, { profile });
  const results = [];
  let skillsApplied = false;

  for (const action of plan.actions) {
    if (action.executor === "skills-cli") {
      if (skillsApplied || !action.command) continue;
      skillsApplied = true;
      const skillResults = applySkills(collection, {
        actions: plan.actions.filter((candidate) => candidate.executor === "skills-cli"),
        dryRun,
        projectRoot,
      });
      results.push(...skillResults);
      if (skillResults.some((result) => result.status !== 0)) {
        return { ok: false, dryRun, profile: plan.profile.name, results };
      }
      continue;
    }

    if (action.executor !== "adapter") continue;
    const request = adapterRequest(
      collection,
      "apply",
      action.harness,
      { index: action.index, config: action.config },
      { dryRun },
    );
    try {
      const response = runAdapter(collection, action.adapter, request);
      const result = {
        ok: response.ok,
        summary: response.summary ?? action.summary,
        status: response.status ?? 0,
        changed: response.changed,
        kind: action.kind,
        executor: "adapter",
        adapter: action.adapter,
        harness: action.harness,
        action: action.action,
        command: response.command ?? action.command,
        dryRun,
      };
      if (result.changed === undefined) delete result.changed;
      if (result.summary === undefined) delete result.summary;
      if (result.command === undefined) delete result.command;
      results.push(result);
      if (result.status !== 0) {
        return { ok: false, dryRun, profile: plan.profile.name, results };
      }
    } catch (error) {
      results.push({
        kind: action.kind,
        executor: "adapter",
        adapter: action.adapter,
        harness: action.harness,
        action: action.action,
        summary: action.summary,
        command: action.command,
        status: 1,
        dryRun,
        stderr: error.message,
      });
      return { ok: false, dryRun, profile: plan.profile.name, results };
    }
  }

  return { ok: true, dryRun, profile: plan.profile.name, results };
}

export function formatApplyText(report) {
  const lines = [
    `Apply: ${report.ok ? "OK" : "FAIL"}${report.dryRun ? " (dry-run)" : ""}`,
    "",
  ];
  for (const [index, result] of report.results.entries()) {
    const mark = result.status === 0 ? "ok" : "FAIL";
    const owner = result.executor === "adapter"
      ? `${result.harness}:${result.action}`
      : result.executor;
    lines.push(`${index + 1}. [${mark}] [${owner}] ${result.summary}`);
    if (result.command) lines.push(`   $ ${result.command.join(" ")}`);
    if (result.stdout?.trim()) {
      for (const line of result.stdout.trim().split("\n").slice(0, 20)) lines.push(`   | ${line}`);
    }
    if (result.stderr?.trim() && result.status !== 0) {
      for (const line of result.stderr.trim().split("\n").slice(0, 20)) lines.push(`   ! ${line}`);
    }
  }
  if (!report.results.length) lines.push("(no apply actions)");
  return lines.join("\n");
}

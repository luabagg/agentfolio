import { applySkills } from "../backends/skills-cli.mjs";
import { applyChezmoi, chezmoiAvailable } from "../backends/chezmoi.mjs";
import { buildPlan } from "./plan.mjs";

/**
 * Apply a collection: skills-cli then chezmoi.
 * Fail-fast on first non-zero backend result.
 */
export function applyCollection(collection, { dryRun = false } = {}) {
  const plan = buildPlan(collection);
  const results = [];

  if (!dryRun && (plan.chezmoiRequired || (!chezmoiAvailable() && plan.actions.some((a) => a.backend === "chezmoi")))) {
    return {
      ok: false,
      dryRun,
      results: [
        {
          kind: "chezmoi.apply",
          backend: "chezmoi",
          summary: "chezmoi required but not installed",
          status: 1,
          stderr:
            "chezmoi not found on PATH. Install: https://www.chezmoi.io/install/",
        },
      ],
    };
  }

  const skillResults = applySkills(collection, { dryRun });
  results.push(...skillResults);
  const skillFail = skillResults.find((r) => r.status !== 0);
  if (skillFail) {
    return { ok: false, dryRun, results };
  }

  const chezmoiResults = applyChezmoi(collection, { dryRun });
  results.push(...chezmoiResults);
  const chezmoiFail = chezmoiResults.find((r) => r.status !== 0);
  if (chezmoiFail) {
    return { ok: false, dryRun, results };
  }

  return { ok: true, dryRun, results };
}

export function formatApplyText(report) {
  const lines = [
    `Apply: ${report.ok ? "OK" : "FAIL"}${report.dryRun ? " (dry-run)" : ""}`,
    "",
  ];
  for (const [i, r] of report.results.entries()) {
    const mark = r.status === 0 ? "ok" : "FAIL";
    lines.push(`${i + 1}. [${mark}] [${r.backend}] ${r.summary}`);
    if (r.command) lines.push(`   $ ${r.command.join(" ")}`);
    if (r.stdout?.trim()) {
      for (const line of r.stdout.trim().split("\n").slice(0, 20)) {
        lines.push(`   | ${line}`);
      }
    }
    if (r.stderr?.trim() && r.status !== 0) {
      for (const line of r.stderr.trim().split("\n").slice(0, 20)) {
        lines.push(`   ! ${line}`);
      }
    }
  }
  if (!report.results.length) lines.push("(no apply actions)");
  return lines.join("\n");
}

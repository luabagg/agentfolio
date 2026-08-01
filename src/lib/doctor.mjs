import { existsSync } from "node:fs";
import { chezmoiAvailable, resolveChezmoiPaths } from "../backends/chezmoi.mjs";
import { commandExists, npx, runCommand, formatCommandResult } from "./run.mjs";
import { resolveCollectionPath } from "./collection.mjs";

/**
 * Health check for tool + collection.
 */
export function runDoctor(collection = null) {
  const checks = [];

  checks.push({
    id: "node",
    ok: true,
    detail: `node ${process.version}`,
  });

  const npxOk = commandExists(npx) || commandExists("npx");
  checks.push({
    id: "npx",
    ok: npxOk,
    detail: npxOk ? "npx available (skills-cli via npx --yes skills)" : "npx missing",
  });

  const chezmoiOk = chezmoiAvailable();
  let chezmoiDetail = "chezmoi missing — required for harness/instruction apply";
  if (chezmoiOk) {
    const ver = formatCommandResult(runCommand(["chezmoi", "--version"]));
    chezmoiDetail = (ver.stdout || ver.stderr || "chezmoi ok").split("\n")[0];
  }
  checks.push({
    id: "chezmoi",
    ok: chezmoiOk,
    required: true,
    detail: chezmoiDetail,
  });

  // Probe skills-cli (network may fail; treat presence of npx as soft-ok if offline)
  if (npxOk) {
    const probe = formatCommandResult(
      runCommand([npx, "--yes", "skills", "--help"], { timeout: 60_000 }),
    );
    checks.push({
      id: "skills-cli",
      ok: probe.status === 0,
      detail:
        probe.status === 0
          ? "skills-cli reachable via npx"
          : `skills-cli probe failed: ${(probe.stderr || probe.stdout || probe.error || "").slice(0, 200)}`,
    });
  }

  if (collection) {
    const { root, doc, warnings } = collection;
    checks.push({
      id: "collection",
      ok: true,
      detail: `${doc.name} @ ${root}`,
    });

    if (warnings?.length) {
      checks.push({
        id: "collection.warnings",
        ok: true,
        detail: warnings.join("; "),
      });
    }

    if (doc.skills?.local) {
      const local = resolveCollectionPath(root, doc.skills.local);
      checks.push({
        id: "skills.local",
        ok: Boolean(local && existsSync(local)),
        detail: local ?? doc.skills.local,
      });
    }

    if (doc.harnesses?.length || doc.instructions || doc.chezmoi) {
      const { sourceDir } = resolveChezmoiPaths(collection);
      checks.push({
        id: "chezmoi.source",
        ok: existsSync(sourceDir),
        detail: sourceDir,
      });
    }

    if (doc.tools?.catalog) {
      const catalog = resolveCollectionPath(root, doc.tools.catalog);
      checks.push({
        id: "tools.catalog",
        ok: Boolean(catalog && existsSync(catalog)),
        detail: catalog ?? doc.tools.catalog,
      });
    }

    if (doc.instructions?.global) {
      const global = resolveCollectionPath(root, doc.instructions.global);
      checks.push({
        id: "instructions.global",
        ok: Boolean(global && existsSync(global)),
        detail: global ?? doc.instructions.global,
      });
    }
  }

  const ok = checks.every((c) => c.ok || c.required === false);
  const hardFail = checks.some((c) => c.required && !c.ok);
  return { ok: ok && !hardFail, checks };
}

export function formatDoctorText(report) {
  const lines = [`Doctor: ${report.ok ? "OK" : "FAIL"}`, ""];
  for (const c of report.checks) {
    const mark = c.ok ? "ok" : "FAIL";
    lines.push(`[${mark}] ${c.id}: ${c.detail}`);
  }
  return lines.join("\n");
}

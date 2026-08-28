import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { adapterRequest, runAdapter } from "./adapters.mjs";
import { resolveCollectionPath } from "./collection.mjs";
import { resolveProfile } from "./profiles.mjs";
import { skillsCommand } from "../backends/skills-cli.mjs";
import { commandExists, redactText, runProcess } from "./run.mjs";

function adapterExecutableExists(collection, executable) {
  if (!executable) return false;
  if (isAbsolute(executable)) return existsSync(executable);
  if (executable.includes("/") || executable.includes("\\")) {
    return existsSync(resolve(collection.root, executable));
  }
  return commandExists(executable);
}

/** Health checks for native skills and selected collection adapters. */
export function runDoctor(collection = null, { profile = "default" } = {}) {
  const checks = [
    { id: "node", ok: true, required: true, detail: `node ${process.version}` },
  ];
  const resolvedProfile = collection ? resolveProfile(collection.doc, profile) : null;
  const needsSkills = !collection || Boolean(resolvedProfile.skills && collection.doc.skills?.local);

  if (needsSkills) {
    const probe = runProcess(skillsCommand(["--version"]), { timeout: 60_000 });
    checks.push({
      id: "skills-cli",
      ok: probe.status === 0,
      required: true,
      detail: probe.status === 0
        ? "Skills CLI reachable via pinned local binary"
        : "Skills CLI probe failed",
    });
  }

  if (collection) {
    const { root, doc, warnings } = collection;
    const harnessDetail = resolvedProfile.harnesses.length
      ? resolvedProfile.harnesses.join(", ")
      : "none";
    checks.push({ id: "collection", ok: true, required: true, detail: `${doc.name} @ ${root}` });
    checks.push({
      id: "collection.profile",
      ok: true,
      required: true,
      detail: `${resolvedProfile.name}: skills=${resolvedProfile.skills}; harnesses=${harnessDetail}`,
    });

    if (warnings?.length) {
      checks.push({
        id: "collection.warnings",
        ok: true,
        required: false,
        detail: warnings.join("; "),
      });
    }

    if (needsSkills) {
      const local = resolveCollectionPath(root, doc.skills.local);
      checks.push({
        id: "skills.local",
        ok: Boolean(local && existsSync(local)),
        required: true,
        detail: local ?? doc.skills.local,
      });
    }

    if (doc.tools?.catalog) {
      const catalog = resolveCollectionPath(root, doc.tools.catalog);
      checks.push({
        id: "tools.catalog",
        ok: Boolean(catalog && existsSync(catalog)),
        required: true,
        detail: catalog ?? doc.tools.catalog,
      });
    }

    const commandStatus = new Map();
    for (const harnessId of resolvedProfile.harnesses) {
      const harness = doc.harnesses[harnessId];
      const adapter = doc.adapters[harness.adapter];
      if (!commandStatus.has(harness.adapter)) {
        const ok = adapterExecutableExists(collection, adapter.executable);
        commandStatus.set(harness.adapter, ok);
        checks.push({
          id: `adapter.${harness.adapter}.executable`,
          ok,
          required: true,
          detail: redactText([adapter.executable, ...adapter.args].join(" ")),
        });
      }
      if (!commandStatus.get(harness.adapter)) continue;

      try {
        const request = adapterRequest(collection, "doctor", harnessId, null);
        const response = runAdapter(collection, harness.adapter, request);
        for (const check of response.checks ?? []) {
          checks.push({
            id: `adapter.${harness.adapter}.${check.id}`,
            ok: Boolean(check.ok),
            required: check.required !== false,
            detail: check.detail ?? harnessId,
          });
        }
      } catch (error) {
        checks.push({
          id: `adapter.${harness.adapter}.${harnessId}.doctor`,
          ok: false,
          required: true,
          detail: error.message,
        });
      }
    }
  }

  return { ok: checks.every((check) => check.ok || check.required === false), checks };
}

export function formatDoctorText(report) {
  const lines = [`Doctor: ${report.ok ? "OK" : "FAIL"}`, ""];
  for (const check of report.checks) {
    const mark = check.ok ? "ok" : check.required === false ? "optional" : "FAIL";
    lines.push(`[${mark}] ${check.id}: ${check.detail}`);
  }
  return lines.join("\n");
}

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolveCollectionPath } from "../lib/collection.mjs";
import { commandExists, formatCommandResult, runCommand } from "../lib/run.mjs";

const CHEZMOI = "chezmoi";

/**
 * Resolve chezmoi source + destination for a collection.
 */
export function resolveChezmoiPaths(collection) {
  const { root, doc } = collection;
  const cfg = doc.chezmoi ?? {};
  const sourceDir = resolveCollectionPath(root, cfg.sourceDir ?? "chezmoi");
  const destinationDir = cfg.destinationDir
    ? resolveCollectionPath(root, cfg.destinationDir)
    : homedir();
  return { sourceDir, destinationDir, config: cfg };
}

export function chezmoiAvailable() {
  return commandExists(CHEZMOI);
}

function chezmoiArgs(collection, subcommand, extra = []) {
  const { sourceDir, destinationDir } = resolveChezmoiPaths(collection);
  return [
    CHEZMOI,
    `--source=${sourceDir}`,
    `--destination=${destinationDir}`,
    subcommand,
    ...extra,
  ];
}

/**
 * Plan chezmoi actions (harnesses + instructions share one source tree).
 */
export function planChezmoi(collection) {
  const { doc } = collection;
  const actions = [];
  const { sourceDir, destinationDir } = resolveChezmoiPaths(collection);
  const hasHarnesses = Array.isArray(doc.harnesses) && doc.harnesses.length > 0;
  const hasInstructions = Boolean(doc.instructions?.global);
  const usesChezmoi =
    hasHarnesses ||
    hasInstructions ||
    Boolean(doc.chezmoi?.sourceDir) ||
    existsSync(sourceDir);

  if (!usesChezmoi) return actions;

  const harnessIds = (doc.harnesses ?? []).map((h) => h.id);
  actions.push({
    kind: "chezmoi.apply",
    backend: "chezmoi",
    summary: `Apply chezmoi source ${sourceDir} → ${destinationDir}`,
    command: chezmoiArgs(collection, "apply", ["--force"]),
    detail: {
      sourceDir,
      destinationDir,
      harnesses: harnessIds,
      instructions: doc.instructions?.global ?? null,
      sourceExists: existsSync(sourceDir),
    },
  });

  return actions;
}

export function diffChezmoi(collection) {
  if (!chezmoiAvailable()) {
    return {
      available: false,
      status: 1,
      stdout: "",
      stderr: "chezmoi not found on PATH",
    };
  }

  const { sourceDir } = resolveChezmoiPaths(collection);
  if (!existsSync(sourceDir)) {
    return {
      available: true,
      status: 0,
      stdout: "",
      stderr: `chezmoi source missing: ${sourceDir}`,
      missingSource: true,
    };
  }

  const result = formatCommandResult(
    runCommand(chezmoiArgs(collection, "diff"), { cwd: collection.root }),
  );
  return { available: true, ...result };
}

export function statusChezmoi(collection) {
  if (!chezmoiAvailable()) {
    return {
      available: false,
      status: 1,
      stdout: "",
      stderr: "chezmoi not found on PATH",
    };
  }

  const { sourceDir } = resolveChezmoiPaths(collection);
  if (!existsSync(sourceDir)) {
    return {
      available: true,
      status: 0,
      stdout: "",
      stderr: `chezmoi source missing: ${sourceDir}`,
      missingSource: true,
    };
  }

  const result = formatCommandResult(
    runCommand(chezmoiArgs(collection, "status"), { cwd: collection.root }),
  );
  return { available: true, ...result };
}

/**
 * Apply chezmoi source to destination.
 */
export function applyChezmoi(collection, { dryRun = false } = {}) {
  const actions = planChezmoi(collection);
  const results = [];

  if (!chezmoiAvailable()) {
    return [
      {
        kind: "chezmoi.apply",
        backend: "chezmoi",
        summary: "chezmoi required but not installed",
        status: 1,
        stderr:
          "chezmoi not found on PATH. Install: https://www.chezmoi.io/install/",
      },
    ];
  }

  for (const action of actions) {
    if (!action.detail?.sourceExists) {
      results.push({
        ...action,
        status: 1,
        stderr: `chezmoi source directory missing: ${action.detail.sourceDir}`,
      });
      break;
    }

    if (dryRun) {
      const diff = diffChezmoi(collection);
      results.push({
        ...action,
        dryRun: true,
        status: 0,
        stdout: diff.stdout || `dry-run: ${action.command.join(" ")}`,
        stderr: diff.stderr ?? "",
      });
      continue;
    }

    const result = formatCommandResult(
      runCommand(action.command, { cwd: collection.root }),
    );
    results.push({ ...action, ...result });
    if (result.status !== 0) break;
  }

  return results;
}

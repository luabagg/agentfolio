import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { applyCursorBridge, expandTilde, planCursorBridge } from "../integrations/cursor-bridge.mjs";
import { resolveCollectionPath } from "../lib/collection.mjs";
import { commandExists, formatCommandResult, runCommand } from "../lib/run.mjs";

export const PI_PROFILES = Object.freeze({
  default: { skills: true, chezmoi: true, pi: false },
  pi: { skills: false, chezmoi: false, pi: true, catalogOnly: false, skipCursorBridge: false },
  "pi-catalog": { skills: false, chezmoi: false, pi: true, catalogOnly: true, skipCursorBridge: true },
  "cursor-bridge": { skills: false, chezmoi: false, pi: true, catalogOnly: true, skipCursorBridge: false, bridgeOnly: true },
});

function piPaths() {
  const dir = resolve(join(homedir(), ".pi", "agent"));
  return {
    dir,
    settingsPath: join(dir, "settings.json"),
    modelsPath: join(dir, "models.json"),
    catalogLockPath: join(dir, "catalog.lock.json"),
  };
}

export function resolvePiManifestPath(collection) {
  const declared = collection.doc.integrations?.cursorBridge?.manifest ?? "./harnesses/pi.json";
  return resolveCollectionPath(collection.root, declared);
}

export function resolvePiHarnessRoot(collection) {
  const harness = (collection.doc.harnesses ?? []).find((item) => item.id === "pi");
  if (harness?.source) return resolveCollectionPath(collection.root, harness.source);
  return resolve(dirname(resolvePiManifestPath(collection)), "pi");
}

async function readUtf8IfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readJsonIfExists(path) {
  const raw = await readUtf8IfExists(path);
  return raw ? JSON.parse(raw) : null;
}

export function validatePiManifest(manifest, catalog) {
  if (manifest.version !== 1) throw new Error("harnesses/pi.json must have version 1.");
  if (manifest.harness !== "pi") throw new Error('harnesses/pi.json must have harness "pi".');

  for (const pkg of manifest.packages ?? []) {
    if (!pkg.name || pkg.kind !== "pi-package" || typeof pkg.defaultEnabled !== "boolean") {
      throw new Error('Each pi package entry needs name, kind "pi-package", and defaultEnabled.');
    }
    if (!pkg.source || !pkg.install) throw new Error(`${pkg.name} needs source and install.`);
  }

  for (const ext of manifest.localExtensions ?? []) {
    if (!ext.name || ext.kind !== "local-extension" || typeof ext.defaultEnabled !== "boolean") {
      throw new Error('Each localExtension entry needs name, kind "local-extension", and defaultEnabled.');
    }
    if (!ext.sourceFile || !ext.path) throw new Error(`${ext.name} needs sourceFile and path.`);
  }

  if (manifest.settings && !catalog.piScopes?.[manifest.settings.catalogScope]) {
    throw new Error("pi settings.catalogScope must reference a catalog piScope.");
  }

  for (const provider of manifest.modelProviders ?? []) {
    if (!provider.name || !provider.sourceFile || typeof provider.defaultEnabled !== "boolean") {
      throw new Error("Each modelProvider needs name, sourceFile, and defaultEnabled.");
    }
    if (provider.includeModelsFromPiScope && !catalog.piScopes?.[provider.includeModelsFromPiScope]) {
      throw new Error(`${provider.name}.includeModelsFromPiScope must reference a catalog piScope.`);
    }
  }
}

function resolvedScope(catalog, catalogLock, scopeId) {
  const selectors = catalog.piScopes[scopeId];
  const enabledModels = [];
  const managedPrefixes = new Set();
  for (const selectorId of selectors) {
    const resolved = catalogLock.resolvedSelectors?.[selectorId];
    if (!resolved) throw new Error(`Catalog lock is missing selector ${selectorId}.`);
    const prefix = catalog.providers?.[resolved.provider]?.harnessIds?.pi;
    if (!prefix) throw new Error(`Catalog provider ${resolved.provider} has no Pi harness ID.`);
    managedPrefixes.add(`${prefix}/`);
    enabledModels.push(`${prefix}/${resolved.modelId}`);
  }
  return { enabledModels, managedPrefixes: [...managedPrefixes] };
}

function nextSettings(currentSettings, manifest, catalog, catalogLock, sources) {
  const next = { ...(currentSettings ?? {}) };
  const existing = Array.isArray(next.packages) ? [...next.packages] : [];
  const present = new Set(
    existing.map((entry) => (typeof entry === "string" ? entry : entry?.source)).filter(Boolean),
  );
  for (const source of sources) {
    if (!present.has(source)) {
      existing.push(source);
      present.add(source);
    }
  }
  if (existing.length > 0) next.packages = existing;

  if (manifest.settings?.catalogScope) {
    const resolved = resolvedScope(catalog, catalogLock, manifest.settings.catalogScope);
    const enabled = Array.isArray(next.enabledModels) ? next.enabledModels : [];
    next.enabledModels = [
      ...enabled.filter(
        (entry) => typeof entry === "string" && !resolved.managedPrefixes.some((prefix) => entry.startsWith(prefix)),
      ),
      ...resolved.enabledModels,
    ];
  }
  return next;
}

function filterProviderModelsFromPiScope(providerName, providerConfig, scopeId, catalog, catalogLock) {
  if (!scopeId) return { config: providerConfig, filtered: false, before: providerConfig.models?.length ?? 0, after: providerConfig.models?.length ?? 0 };
  const resolved = resolvedScope(catalog, catalogLock, scopeId);
  const prefix = `${providerName}/`;
  const allowedIds = new Set(
    resolved.enabledModels.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)),
  );
  const models = Array.isArray(providerConfig.models) ? providerConfig.models : [];
  if (allowedIds.size === 0) {
    return { config: providerConfig, filtered: false, before: models.length, after: models.length };
  }
  const filtered = models.filter((model) => allowedIds.has(model.id));
  return { config: { ...providerConfig, models: filtered }, filtered: true, before: models.length, after: filtered.length };
}

async function nextModels(currentModels, providers, harnessRoot, catalog, catalogLock) {
  const next = { ...(currentModels ?? {}), providers: { ...(currentModels?.providers ?? {}) } };
  const notes = [];
  for (const provider of providers) {
    const source = resolve(harnessRoot, provider.sourceFile);
    if (!existsSync(source)) throw new Error(`Missing provider source: ${source}`);
    const providerConfig = JSON.parse(await readFile(source, "utf8"));
    const filtered = filterProviderModelsFromPiScope(
      provider.name,
      providerConfig,
      provider.includeModelsFromPiScope,
      catalog,
      catalogLock,
    );
    next.providers[provider.name] = filtered.config;
    if (filtered.filtered) {
      notes.push(`${provider.name}: limiting models from ${filtered.before} to ${filtered.after} via piScope ${provider.includeModelsFromPiScope}`);
    }
  }
  return { next, notes };
}

async function writeJsonWithBackup(filePath, nextValue, dryRun) {
  const currentContent = await readUtf8IfExists(filePath);
  const nextContent = `${JSON.stringify(nextValue, null, 2)}\n`;
  if (currentContent === nextContent) return { changed: false, status: "ok", path: filePath };
  if (dryRun) return { changed: true, status: currentContent === null ? "missing" : "stale", path: filePath, dryRun: true };
  await mkdir(dirname(filePath), { recursive: true });
  if (currentContent !== null) {
    const backupPath = `${filePath}.bak-${new Date().toISOString().replaceAll(":", "-")}`;
    await copyFile(filePath, backupPath);
  }
  await writeFile(filePath, nextContent, "utf8");
  return { changed: true, status: currentContent === null ? "missing" : "stale", path: filePath };
}

export async function loadPiContext(collection) {
  const manifestPath = resolvePiManifestPath(collection);
  const harnessRoot = resolvePiHarnessRoot(collection);
  if (!existsSync(manifestPath)) throw new Error(`Missing Pi manifest: ${manifestPath}`);

  const policyPath = resolveCollectionPath(collection.root, collection.doc.models?.policy ?? "./harnesses/catalog.yaml");
  const lockPath = resolveCollectionPath(collection.root, collection.doc.models?.lock ?? "./harnesses/catalog.lock.json");
  const catalog = parseYaml(await readFile(policyPath, "utf8"));
  const catalogLock = JSON.parse(await readFile(lockPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validatePiManifest(manifest, catalog);
  return { manifest, manifestPath, harnessRoot, catalog, catalogLock, policyPath, lockPath };
}

export function planPiSetup(context, { catalogOnly = false, skipCursorBridge = false, enableRecommended = false, bridgeOnly = false } = {}) {
  const { manifest } = context;
  const skipBridge = skipCursorBridge || catalogOnly && !bridgeOnly;
  const packages = catalogOnly || bridgeOnly
    ? []
    : (manifest.packages ?? []).filter((pkg) => pkg.defaultEnabled || enableRecommended);
  const extensions = catalogOnly || bridgeOnly
    ? []
    : (manifest.localExtensions ?? []).filter((ext) => ext.defaultEnabled || enableRecommended);
  const providers = bridgeOnly
    ? []
    : (manifest.modelProviders ?? []).filter((provider) => provider.defaultEnabled || enableRecommended);
  const phases = [];
  if (!bridgeOnly) phases.push("catalog");
  if (!catalogOnly && !bridgeOnly) phases.push("packages", "extensions");
  if (!skipBridge) phases.push("cursor-bridge");

  return {
    phases,
    packages,
    extensions,
    providers,
    catalogOnly,
    skipCursorBridge: skipBridge,
    bridgeOnly,
    cursorBridge: planCursorBridge(manifest),
  };
}

export async function setupPi(collection, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const context = await loadPiContext(collection);
  const plan = planPiSetup(context, options);
  const paths = piPaths();
  const results = [];
  let changed = false;

  if (!plan.bridgeOnly) {
    const currentSettings = (await readJsonIfExists(paths.settingsPath)) ?? {};
    const sourcesToAdd = plan.catalogOnly
      ? []
      : plan.packages
          .map((pkg) => pkg.source)
          .filter((source) => {
            const present = new Set(
              (Array.isArray(currentSettings.packages) ? currentSettings.packages : [])
                .map((entry) => (typeof entry === "string" ? entry : entry?.source))
                .filter(Boolean),
            );
            return !present.has(source);
          });
    const updatedSettings = nextSettings(
      currentSettings,
      context.manifest,
      context.catalog,
      context.catalogLock,
      plan.catalogOnly ? [] : sourcesToAdd,
    );
    const settingsWrite = await writeJsonWithBackup(paths.settingsPath, updatedSettings, dryRun);
    results.push({ kind: "pi.settings", backend: "pi", summary: `Pi settings ${paths.settingsPath}`, ...settingsWrite, status: 0 });
    changed = changed || settingsWrite.changed;

    const currentModels = (await readJsonIfExists(paths.modelsPath)) ?? {};
    const modelsNext = await nextModels(
      currentModels,
      plan.providers,
      context.harnessRoot,
      context.catalog,
      context.catalogLock,
    );
    const modelsWrite = await writeJsonWithBackup(paths.modelsPath, modelsNext.next, dryRun);
    results.push({
      kind: "pi.models",
      backend: "pi",
      summary: `Pi models ${paths.modelsPath}`,
      notes: modelsNext.notes,
      ...modelsWrite,
      status: 0,
    });
    changed = changed || modelsWrite.changed;

    const lockSource = await readFile(context.lockPath, "utf8");
    const lockCurrent = await readUtf8IfExists(paths.catalogLockPath);
    const lockStatus = lockCurrent === null ? "missing" : lockCurrent === lockSource ? "ok" : "stale";
    if (lockStatus !== "ok" && !dryRun) {
      await mkdir(dirname(paths.catalogLockPath), { recursive: true });
      await writeFile(paths.catalogLockPath, lockSource, "utf8");
    }
    results.push({
      kind: "pi.catalog-lock",
      backend: "pi",
      summary: `Catalog lock ${paths.catalogLockPath}`,
      status: 0,
      changed: lockStatus !== "ok",
      dryRun,
      detail: lockStatus,
    });
    changed = changed || lockStatus !== "ok";

    if (!plan.catalogOnly) {
      for (const pkg of plan.packages) {
        if (!sourcesToAdd.includes(pkg.source)) {
          results.push({ kind: "pi.package", backend: "pi", summary: `${pkg.name} already declared`, status: 0, changed: false });
          continue;
        }
        const command = ["pi", "install", pkg.source];
        if (dryRun) {
          results.push({ kind: "pi.package", backend: "pi", summary: `would install ${pkg.name}`, command, status: 0, dryRun: true, changed: true });
          changed = true;
          continue;
        }
        if (!commandExists("pi")) {
          results.push({ kind: "pi.package", backend: "pi", summary: `install ${pkg.name}`, command, status: 1, stderr: "pi not found on PATH" });
          return { ok: false, dryRun, changed, plan, results };
        }
        const result = formatCommandResult(runCommand(command));
        results.push({ kind: "pi.package", backend: "pi", summary: `install ${pkg.name}`, command, ...result, changed: result.status === 0 });
        if (result.status !== 0) return { ok: false, dryRun, changed, plan, results };
        changed = true;
      }

      for (const ext of plan.extensions) {
        const source = resolve(context.harnessRoot, ext.sourceFile);
        const target = expandTilde(ext.path);
        if (!existsSync(source)) throw new Error(`Missing local extension source: ${source}`);
        const sourceContent = await readFile(source, "utf8");
        const targetContent = await readUtf8IfExists(target);
        const status = targetContent === null ? "missing" : targetContent === sourceContent ? "ok" : "stale";
        if (status !== "ok" && !dryRun) {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, sourceContent, "utf8");
        }
        results.push({
          kind: "pi.extension",
          backend: "pi",
          summary: `${ext.name} -> ${target}`,
          status: 0,
          changed: status !== "ok",
          dryRun,
          detail: status,
        });
        changed = changed || status !== "ok";
      }
    }
  }

  if (!plan.skipCursorBridge) {
    const bridge = await applyCursorBridge(context.manifest, {
      harnessRoot: context.harnessRoot,
      dryRun,
    });
    results.push({
      kind: "pi.cursor-bridge",
      backend: "pi",
      summary: bridge.skipped
        ? "Cursor bridge disabled"
        : bridge.error
          ? `Cursor bridge skipped: ${bridge.error}`
          : "Cursor ACP provider bridge",
      status: bridge.ok || bridge.error ? 0 : 1,
      changed: Boolean(bridge.changed),
      dryRun: Boolean(bridge.dryRun),
      detail: bridge,
    });
    if (!bridge.ok && !bridge.error) return { ok: false, dryRun, changed, plan, results };
    changed = changed || Boolean(bridge.changed);
  }

  return { ok: true, dryRun, changed, plan, results };
}

export function formatPiSetupText(report) {
  const lines = [
    `Pi setup: ${report.ok ? "OK" : "FAIL"}${report.dryRun ? " (dry-run)" : ""}`,
    `Phases: ${(report.plan?.phases ?? []).join(", ") || "(none)"}`,
    "",
  ];
  for (const [index, result] of (report.results ?? []).entries()) {
    const mark = result.status === 0 ? "ok" : "FAIL";
    lines.push(`${index + 1}. [${mark}] ${result.summary}${result.changed ? " [changed]" : ""}`);
    if (result.notes?.length) {
      for (const note of result.notes) lines.push(`   | ${note}`);
    }
    if (result.command) lines.push(`   $ ${result.command.join(" ")}`);
    if (result.stderr && result.status !== 0) lines.push(`   ! ${result.stderr}`);
  }
  return lines.join("\n");
}

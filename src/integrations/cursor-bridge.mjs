import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_REQUIRED_COMMANDS = ["npm", "npx", "opencode", "cursor-agent", "curl", "systemctl"];

export function expandTilde(value) {
  if (value.startsWith("~/")) return resolve(join(homedir(), value.slice(2)));
  return resolve(value);
}

export function commandPath(name) {
  try {
    return execFileSync("which", [name], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function packageParts(spec) {
  const separator = spec.lastIndexOf("@");
  if (separator <= 0) return { name: spec, version: null };
  return { name: spec.slice(0, separator), version: spec.slice(separator + 1) };
}

export function globalPackageMatches(npmBin, spec) {
  const { name, version } = packageParts(spec);
  try {
    const output = execFileSync(npmBin, ["list", "--global", "--depth=0", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const installed = JSON.parse(output).dependencies?.[name]?.version;
    return Boolean(installed && (!version || installed === version));
  } catch {
    return false;
  }
}

async function symlinkMatches(target, source) {
  try {
    const info = await lstat(target);
    if (!info.isSymbolicLink()) return false;
    return resolve(dirname(target), await readlink(target)) === resolve(source);
  } catch {
    return false;
  }
}

function replaceTemplate(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Missing template value: ${key}`);
    return values[key];
  });
}

function systemdEnvironmentValue(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");
}

function commandSucceeds(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function planCursorBridge(manifest, { env = process.env } = {}) {
  const bridge = manifest?.cursorBridge;
  if (!bridge?.enabled) return { enabled: false, actions: [], missing: [] };

  const required = bridge.requiredCommands ?? DEFAULT_REQUIRED_COMMANDS;
  const paths = Object.fromEntries(required.map((name) => [name, commandPath(name)]));
  const missing = required.filter((name) => !paths[name]);
  const configHome = expandTilde(bridge.configHome);
  const workspace = resolve(env[bridge.workspaceEnv] || homedir());

  return {
    enabled: true,
    missing,
    paths,
    configHome,
    workspace,
    providerUrl: bridge.providerUrl,
    healthUrl: bridge.providerUrl?.replace(/\/v1$/, "/health"),
    actions: [
      { kind: "command", summary: `Install ${bridge.package} globally if missing` },
      { kind: "managed-file", summary: "Create isolated OpenCursor config/plugin files" },
      { kind: "managed-symlink", summary: "Link isolated bridge to Cursor auth directory" },
      { kind: "systemd-user-service", summary: `Install and enable ${bridge.systemdUnit}` },
      { kind: "managed-file", summary: `Install ${bridge.refreshPath}` },
    ],
  };
}

export async function applyCursorBridge(manifest, { harnessRoot, dryRun = false, env = process.env } = {}) {
  const plan = planCursorBridge(manifest, { env });
  if (!plan.enabled) return { ok: true, changed: false, skipped: true, plan };
  if (plan.missing.length) return { ok: false, changed: false, plan, error: `missing commands: ${plan.missing.join(", ")}` };
  if (dryRun) return { ok: true, changed: true, dryRun: true, plan };

  const bridge = manifest.cursorBridge;
  const paths = plan.paths;
  let changed = false;

  if (!globalPackageMatches(paths.npm, bridge.package)) {
    execFileSync(paths.npm, ["install", "--global", bridge.package], { stdio: "inherit" });
    changed = true;
  }

  const openCursor = commandPath("open-cursor");
  if (!openCursor) throw new Error("open-cursor missing after global install");

  const opencodeConfig = join(plan.configHome, "opencode", "opencode.json");
  const pluginDir = join(plan.configHome, "opencode", "plugin");
  const pluginPath = join(pluginDir, "cursor-acp.js");
  if (!existsSync(opencodeConfig) || !existsSync(pluginPath)) {
    await mkdir(pluginDir, { recursive: true });
    execFileSync(
      openCursor,
      ["install", "--variants", "--compact", "--no-backup", "--config", opencodeConfig, "--plugin-dir", pluginDir],
      { stdio: "inherit" },
    );
    changed = true;
  }

  const cursorAuthDir = join(homedir(), ".config", "cursor");
  const isolatedCursorDir = join(plan.configHome, "cursor");
  if (!(await symlinkMatches(isolatedCursorDir, cursorAuthDir))) {
    try {
      const existing = await lstat(isolatedCursorDir);
      if (existing.isSymbolicLink()) await rm(isolatedCursorDir, { force: true });
      else await rename(isolatedCursorDir, `${isolatedCursorDir}.bak-${new Date().toISOString().replaceAll(":", "-")}`);
    } catch {}
    await mkdir(dirname(isolatedCursorDir), { recursive: true });
    await symlink(cursorAuthDir, isolatedCursorDir, "dir");
    changed = true;
  }

  const servicePath = expandTilde(bridge.systemdUnit);
  const serviceTemplate = await readFile(resolve(harnessRoot, bridge.serviceTemplate), "utf8");
  const service = replaceTemplate(serviceTemplate, {
    CURSOR_CONFIG_HOME: plan.configHome,
    PATH: systemdEnvironmentValue(env.PATH ?? "/usr/local/bin:/usr/bin:/bin"),
    OPENCODE_BIN: paths.opencode,
    CURL_BIN: paths.curl,
    WORKSPACE_URL: encodeURIComponent(plan.workspace).replaceAll("%2F", "/"),
  });
  const currentService = existsSync(servicePath) ? await readFile(servicePath, "utf8") : null;
  const serviceChanged = currentService !== service;
  if (serviceChanged) {
    await mkdir(dirname(servicePath), { recursive: true });
    await writeFile(servicePath, service, "utf8");
    changed = true;
  }

  const refreshPath = expandTilde(bridge.refreshPath);
  const refreshContent = await readFile(resolve(harnessRoot, bridge.refreshScript), "utf8");
  const currentRefresh = existsSync(refreshPath) ? await readFile(refreshPath, "utf8") : null;
  if (currentRefresh !== refreshContent) {
    await mkdir(dirname(refreshPath), { recursive: true });
    await writeFile(refreshPath, refreshContent, "utf8");
    changed = true;
  }
  await chmod(refreshPath, 0o755);

  const serviceActive = commandSucceeds(paths.systemctl, ["--user", "is-active", "--quiet", "pi-cursor-provider.service"]);
  if (serviceChanged) execFileSync(paths.systemctl, ["--user", "daemon-reload"], { stdio: "inherit" });
  if (!serviceActive || serviceChanged) {
    execFileSync(paths.systemctl, ["--user", "enable", "pi-cursor-provider.service"], { stdio: "inherit" });
    execFileSync(paths.systemctl, ["--user", "restart", "pi-cursor-provider.service"], { stdio: "inherit" });
    changed = true;
  }

  return { ok: true, changed, plan };
}

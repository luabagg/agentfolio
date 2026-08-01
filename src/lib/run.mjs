import { spawnSync } from "node:child_process";

export const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function windowsQuote(value) {
  if (/^[A-Za-z0-9_./:@=*-]+$/.test(value)) return value;
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

/**
 * Run a command with argv array (no shell). Returns spawnSync result.
 */
export function runCommand(command, options = {}) {
  const opts = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  };

  if (process.platform !== "win32") {
    return spawnSync(command[0], command.slice(1), opts);
  }

  const commandLine = command.map(windowsQuote).join(" ");
  return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], opts);
}

export function commandExists(name) {
  const which = process.platform === "win32" ? "where" : "which";
  const result = runCommand([which, name], { stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0;
}

export function formatCommandResult(result) {
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  return { status: result.status ?? 1, stdout, stderr, error: result.error?.message };
}

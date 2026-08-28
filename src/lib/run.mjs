import { spawnSync } from "node:child_process";

export const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key|(?:^|[_-])key$/i;
const SENSITIVE_ASSIGNMENT = /((?:token|secret|password|authorization|cookie|api[_-]?key|key)\s*[=:]\s*["']?)[^\s,;"']+(["']?)/gi;
const SENSITIVE_JSON = /("(?:token|secret|password|authorization|cookie|api[_-]?key|key)"\s*:\s*")[^"]*(")/gi;
const MAX_CAPTURED_OUTPUT = 64 * 1024;

export function redactText(value) {
  return String(value ?? "")
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(SENSITIVE_JSON, "$1[REDACTED]$2")
    .replace(SENSITIVE_ASSIGNMENT, "$1[REDACTED]$2");
}

export function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(child)]));
  }
  return typeof value === "string" ? redactText(value) : value;
}

function redactEnvironmentValues(text, env) {
  let safe = text;
  for (const [key, value] of Object.entries(env ?? {})) {
    if (SENSITIVE_KEY.test(key) && typeof value === "string" && value) {
      safe = safe.split(value).join("[REDACTED]");
    }
  }
  return safe;
}

function normalizeOutput(value, env) {
  return redactEnvironmentValues(redactText(String(value ?? "").slice(0, MAX_CAPTURED_OUTPUT)), env);
}

/** Run a validated literal argv command without a shell. */
export function runProcess(argv, options = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || typeof argv[0] !== "string" || !argv[0]) {
    throw new Error("process requires a non-empty argv");
  }
  if (argv.some((part) => typeof part !== "string" || !part)) {
    throw new Error("process argv must contain non-empty strings");
  }
  const { cwd, env, input, timeout } = options;
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    input,
    timeout,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    maxBuffer: MAX_CAPTURED_OUTPUT,
  });
  return {
    status: result.status ?? 1,
    stdout: normalizeOutput(result.stdout, env),
    stderr: normalizeOutput(result.stderr, env),
    error: result.error ? redactEnvironmentValues(redactText(result.error.message), env) : undefined,
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

/** Compatibility name for callers that execute literal argv. */
export function runArgv(command, options = {}) {
  return runProcess(command, options);
}

function windowsQuote(value) {
  if (/^[A-Za-z0-9_./:@=*-]+$/.test(value)) return value;
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

// Never use this shell-shim helper for collection adapters.
/** Run commands that may be Windows .cmd shims, such as npx. */
export function runCommand(command, options = {}) {
  if (process.platform !== "win32") return runProcess(command, options);
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || !part)) {
    throw new Error("process requires a non-empty argv");
  }
  const { cwd, env, input, timeout } = options;
  const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command.map(windowsQuote).join(" ")], {
    cwd,
    env,
    input,
    timeout,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: MAX_CAPTURED_OUTPUT,
  });
  return {
    status: result.status ?? 1,
    stdout: normalizeOutput(result.stdout, env),
    stderr: normalizeOutput(result.stderr, env),
    error: result.error ? redactEnvironmentValues(redactText(result.error.message), env) : undefined,
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

export function commandExists(name) {
  const which = process.platform === "win32" ? "where" : "which";
  const result = runCommand([which, name], { stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0;
}

export function formatCommandResult(result) {
  return {
    status: result.status ?? 1,
    stdout: redactText(result.stdout).trim(),
    stderr: redactText(result.stderr).trim(),
    error: result.error ? redactText(result.error) : undefined,
  };
}

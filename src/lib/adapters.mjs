import { runArgv } from "./run.mjs";

export const ADAPTER_PROTOCOL_VERSION = 1;
export const DEFAULT_ADAPTER_TIMEOUT = 120_000;
export const MAX_ADAPTER_TIMEOUT = 600_000;

/** Build one protocol request for a collection-owned harness adapter. */
export function adapterRequest(collection, operation, harnessId, action, { dryRun = false } = {}) {
  if (!["plan", "apply", "doctor"].includes(operation)) {
    throw new Error(`Unknown adapter operation: ${operation}`);
  }
  const harness = collection.doc.harnesses?.[harnessId];
  if (!harness) throw new Error(`Unknown harness: ${harnessId}`);

  return {
    protocolVersion: ADAPTER_PROTOCOL_VERSION,
    operation,
    dryRun: Boolean(dryRun),
    collection: {
      name: collection.doc.name,
      version: collection.doc.version,
      root: collection.root,
    },
    harness: {
      id: harnessId,
      actions: harness.actions,
    },
    action: action
      ? {
          index: action.index,
          name: action.config.action,
          config: action.config,
        }
      : null,
  };
}

function validateResponse(response, operation, context) {
  if (response.summary !== undefined && typeof response.summary !== "string") {
    throw new Error(`Adapter ${context} response.summary must be a string`);
  }
  if (response.changed !== undefined && typeof response.changed !== "boolean") {
    throw new Error(`Adapter ${context} response.changed must be a boolean`);
  }
  if (response.status !== undefined && (!Number.isInteger(response.status) || response.status < 0)) {
    throw new Error(`Adapter ${context} response.status must be a non-negative integer`);
  }
  if (
    response.command !== undefined &&
    (!Array.isArray(response.command) ||
      response.command.length === 0 ||
      response.command.some((part) => typeof part !== "string" || !part))
  ) {
    throw new Error(`Adapter ${context} response.command must be a non-empty argv array`);
  }
  for (const field of ["stdout", "stderr"]) {
    if (response[field] !== undefined && typeof response[field] !== "string") {
      throw new Error(`Adapter ${context} response.${field} must be a string`);
    }
  }

  if (operation !== "doctor") return;
  if (!Array.isArray(response.checks)) {
    throw new Error(`Adapter ${context} response.checks must be an array`);
  }
  for (const [index, check] of response.checks.entries()) {
    const path = `checks[${index}]`;
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      throw new Error(`Adapter ${context} response.${path} must be an object`);
    }
    if (typeof check.id !== "string" || !check.id) {
      throw new Error(`Adapter ${context} response.${path}.id must be a non-empty string`);
    }
    if (typeof check.ok !== "boolean") {
      throw new Error(`Adapter ${context} response.${path}.ok must be a boolean`);
    }
    if (check.required !== undefined && typeof check.required !== "boolean") {
      throw new Error(`Adapter ${context} response.${path}.required must be a boolean`);
    }
    if (check.detail !== undefined && typeof check.detail !== "string") {
      throw new Error(`Adapter ${context} response.${path}.detail must be a string`);
    }
  }
}

/** Execute an adapter without a shell and parse its strict JSON response. */
export function runAdapter(collection, adapterId, request) {
  const adapter = collection.doc.adapters?.[adapterId];
  if (!adapter) throw new Error(`Unknown adapter: ${adapterId}`);

  const timeout = Math.min(adapter.timeout ?? DEFAULT_ADAPTER_TIMEOUT, MAX_ADAPTER_TIMEOUT);
  const result = runArgv(adapter.command, {
    cwd: collection.root,
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout,
  });
  const context = `${adapterId} ${request.operation} ${request.harness.id}${request.action ? `:${request.action.name}` : ""}`;

  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`Adapter ${context} timed out after ${timeout}ms`);
  }
  if (result.error) {
    throw new Error(`Adapter ${context} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`Adapter ${context} failed: ${detail}`);
  }

  let response;
  try {
    response = JSON.parse((result.stdout ?? "").trim());
  } catch (error) {
    throw new Error(`Adapter ${context} returned invalid JSON: ${error.message}`);
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error(`Adapter ${context} response must be a JSON object`);
  }
  if (typeof response.ok !== "boolean") {
    throw new Error(`Adapter ${context} response.ok must be a boolean`);
  }
  if (!response.ok) {
    const detail = response.error || response.stderr || response.detail || "adapter rejected request";
    throw new Error(`Adapter ${context} failed: ${detail}`);
  }

  validateResponse(response, request.operation, context);
  return response;
}

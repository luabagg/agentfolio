import { containsSensitiveKey } from "./schema.mjs";
import { redactValue, runProcess } from "./run.mjs";

export const ADAPTER_PROTOCOL_VERSION = 1;
export const DEFAULT_ADAPTER_TIMEOUT = 120_000;
export const MAX_ADAPTER_TIMEOUT = 600_000;

const RESPONSE_FIELDS = {
  plan: new Set(["ok", "summary", "changed", "status", "command", "detail"]),
  apply: new Set(["ok", "summary", "changed", "status", "command", "detail"]),
  doctor: new Set(["ok", "summary", "status", "detail", "checks"]),
};
const CHECK_FIELDS = new Set(["id", "ok", "required", "detail"]);
const MAX_CHECKS = 100;
const MAX_STRING_LENGTH = 8 * 1024;

/** Build one protocol request for a collection-owned harness adapter. */
export function adapterRequest(collection, operation, harnessId, action, { dryRun = false } = {}) {
  if (!Object.hasOwn(RESPONSE_FIELDS, operation)) throw new Error(`Unknown adapter operation: ${operation}`);
  const harness = collection.doc.harnesses?.[harnessId];
  if (!harness) throw new Error(`Unknown harness: ${harnessId}`);
  return {
    protocolVersion: ADAPTER_PROTOCOL_VERSION,
    operation,
    dryRun: Boolean(dryRun),
    collection: { name: collection.doc.name, version: collection.doc.version, root: collection.root },
    harness: { id: harnessId, actions: harness.actions },
    action: action ? { index: action.index, name: action.config.action, config: action.config.config ?? {} } : null,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validateJsonValue(value, path, context, depth = 0) {
  if (depth > 20) throw new Error(`Adapter ${context} response.${path} is too deeply nested`);
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) throw new Error(`Adapter ${context} response.${path} is too long`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CHECKS) throw new Error(`Adapter ${context} response.${path} has too many items`);
    value.forEach((child, index) => validateJsonValue(child, `${path}[${index}]`, context, depth + 1));
    return;
  }
  if (!isPlainObject(value)) throw new Error(`Adapter ${context} response.${path} must be JSON-safe`);
  for (const [key, child] of Object.entries(value)) validateJsonValue(child, `${path}.${key}`, context, depth + 1);
}

function validateResponse(response, operation, context) {
  for (const key of Object.keys(response)) {
    if (!RESPONSE_FIELDS[operation].has(key)) throw new Error(`Adapter ${context} response has unexpected field: ${key}`);
  }
  if (response.summary !== undefined && (typeof response.summary !== "string" || response.summary.length > MAX_STRING_LENGTH)) {
    throw new Error(`Adapter ${context} response.summary must be a safe string`);
  }
  if (response.changed !== undefined && typeof response.changed !== "boolean") throw new Error(`Adapter ${context} response.changed must be a boolean`);
  if (response.status !== undefined && (!Number.isInteger(response.status) || response.status < 0)) throw new Error(`Adapter ${context} response.status must be a non-negative integer`);
  if (response.command !== undefined && (!Array.isArray(response.command) || response.command.length === 0 || response.command.some((part) => typeof part !== "string" || !part))) {
    throw new Error(`Adapter ${context} response.command must be a non-empty argv array`);
  }
  if (response.detail !== undefined) validateJsonValue(response.detail, "detail", context);
  if (operation !== "doctor") return;
  if (!Array.isArray(response.checks) || response.checks.length > MAX_CHECKS) throw new Error(`Adapter ${context} response.checks must be a bounded array`);
  for (const [index, check] of response.checks.entries()) {
    const path = `checks[${index}]`;
    if (!isPlainObject(check)) throw new Error(`Adapter ${context} response.${path} must be an object`);
    for (const key of Object.keys(check)) if (!CHECK_FIELDS.has(key)) throw new Error(`Adapter ${context} response.${path} has unexpected field: ${key}`);
    if (typeof check.id !== "string" || !check.id || check.id.length > MAX_STRING_LENGTH) throw new Error(`Adapter ${context} response.${path}.id must be a non-empty string`);
    if (typeof check.ok !== "boolean") throw new Error(`Adapter ${context} response.${path}.ok must be a boolean`);
    if (check.required !== undefined && typeof check.required !== "boolean") throw new Error(`Adapter ${context} response.${path}.required must be a boolean`);
    if (check.detail !== undefined && (typeof check.detail !== "string" || check.detail.length > MAX_STRING_LENGTH)) throw new Error(`Adapter ${context} response.${path}.detail must be a safe string`);
  }
}

/** Execute a collection adapter with literal argv and parse one strict JSON response. */
export function runAdapter(collection, adapterId, request) {
  const adapter = collection.doc.adapters?.[adapterId];
  if (!adapter) throw new Error(`Unknown adapter: ${adapterId}`);
  const timeout = Math.min(adapter.timeout ?? DEFAULT_ADAPTER_TIMEOUT, MAX_ADAPTER_TIMEOUT);
  const context = `${adapterId} ${request.operation} ${request.harness.id}${request.action ? `:${request.action.name}` : ""}`;
  const result = runProcess(adapter.command, { cwd: collection.root, input: `${JSON.stringify(request)}\n`, timeout });

  if (result.timedOut) throw new Error(`Adapter ${context} timed out after ${timeout}ms`);
  if (result.error) throw new Error(`Adapter ${context} failed to start`);
  if (result.status !== 0) throw new Error(`Adapter ${context} failed with status ${result.status}`);

  let response;
  try {
    response = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`Adapter ${context} returned invalid JSON`);
  }
  if (!isPlainObject(response)) throw new Error(`Adapter ${context} response must be a JSON object`);
  if (typeof response.ok !== "boolean") throw new Error(`Adapter ${context} response.ok must be a boolean`);
  if (!response.ok) throw new Error(`Adapter ${context} rejected request`);
  if (containsSensitiveKey(response)) throw new Error(`Adapter ${context} response contains sensitive configuration key`);
  validateResponse(response, request.operation, context);

  const safe = { ok: true };
  for (const key of RESPONSE_FIELDS[request.operation]) {
    if (key !== "ok" && response[key] !== undefined) safe[key] = redactValue(response[key]);
  }
  return safe;
}

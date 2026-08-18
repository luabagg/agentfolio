import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { resolveCollectionPath } from "../lib/collection.mjs";

const MODEL_KEYS = new Set(["name", "reasoning", "input", "contextWindow", "maxTokens", "cost", "compat"]);
const COST_KEYS = new Set(["input", "output", "cacheRead", "cacheWrite"]);
const COMPAT_KEYS = new Set(["supportsDeveloperRole", "supportsReasoningEffort", "supportsStore"]);

function assert(condition, message) {
  if (!condition) throw new Error(`Catalog validation: ${message}`);
}

function assertKeys(object, allowed, path) {
  assert(object && typeof object === "object" && !Array.isArray(object), `${path} must be an object`);
  for (const key of Object.keys(object)) assert(allowed.has(key), `${path}.${key} is not supported`);
}

function assertId(value, path) {
  assert(typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(value), `${path} is invalid`);
}

function validateModel(model, path, partial = false) {
  assertKeys(model, MODEL_KEYS, path);
  if (!partial || "name" in model) assert(typeof model.name === "string" && model.name.length > 0, `${path}.name is required`);
  if (!partial || "reasoning" in model) assert(typeof model.reasoning === "boolean", `${path}.reasoning must be boolean`);
  if (!partial || "input" in model) {
    assert(Array.isArray(model.input) && model.input.length > 0, `${path}.input must be non-empty`);
    assert(model.input.every((item) => item === "text" || item === "image"), `${path}.input has unsupported values`);
  }
  for (const key of ["contextWindow", "maxTokens"]) {
    if (!partial || key in model) assert(Number.isInteger(model[key]) && model[key] > 0, `${path}.${key} must be a positive integer`);
  }
  if (model.contextWindow && model.maxTokens) assert(model.maxTokens <= model.contextWindow, `${path}.maxTokens exceeds contextWindow`);
  if (!partial || "cost" in model) {
    assertKeys(model.cost, COST_KEYS, `${path}.cost`);
    for (const key of COST_KEYS) assert(Number.isFinite(model.cost[key]) && model.cost[key] >= 0, `${path}.cost.${key} must be non-negative`);
  }
  if (model.compat) {
    assertKeys(model.compat, COMPAT_KEYS, `${path}.compat`);
    for (const [key, value] of Object.entries(model.compat)) assert(typeof value === "boolean", `${path}.compat.${key} must be boolean`);
  }
}

export function validateModelPolicy(policy) {
  assertKeys(policy, new Set(["schemaVersion", "providers", "selectors", "piScopes", "opencodeRoles", "generatedTargets"]), "catalog");
  assert(policy.schemaVersion === 1, "schemaVersion must be 1");
  assert(policy.providers && Object.keys(policy.providers).length > 0, "providers are required");

  for (const [providerId, provider] of Object.entries(policy.providers)) {
    assertId(providerId, `providers.${providerId}`);
    assertKeys(provider, new Set(["harnessIds", "discovery", "piTransport", "modelDefaults", "modelRules", "fallbackMetadata"]), `providers.${providerId}`);
    assert(provider.harnessIds && typeof provider.harnessIds === "object", `providers.${providerId}.harnessIds is required`);
    assert(provider.discovery && ["openai-models", "pi-list-models"].includes(provider.discovery.kind), `providers.${providerId}.discovery.kind is invalid`);
    validateModel({ name: providerId, ...provider.modelDefaults }, `providers.${providerId}.modelDefaults`);
    for (const [index, rule] of (provider.modelRules ?? []).entries()) {
      assertKeys(rule, new Set(["match", "overrides"]), `providers.${providerId}.modelRules[${index}]`);
      assert(typeof rule.match === "string", `providers.${providerId}.modelRules[${index}].match is required`);
      try { new RegExp(rule.match); } catch { throw new Error(`Catalog validation: invalid regex ${rule.match}`); }
      validateModel(rule.overrides, `providers.${providerId}.modelRules[${index}].overrides`, true);
    }
    for (const [modelId, fallback] of Object.entries(provider.fallbackMetadata ?? {})) {
      assertId(modelId, `providers.${providerId}.fallbackMetadata.${modelId}`);
      assertKeys(fallback, new Set(["includeWhenUndiscovered", "reason", "model"]), `providers.${providerId}.fallbackMetadata.${modelId}`);
      assert(typeof fallback.includeWhenUndiscovered === "boolean", `${modelId}.includeWhenUndiscovered must be boolean`);
      assert(typeof fallback.reason === "string" && fallback.reason.length > 0, `${modelId}.reason is required`);
      validateModel(fallback.model, `providers.${providerId}.fallbackMetadata.${modelId}.model`);
    }
  }

  for (const [selectorId, selector] of Object.entries(policy.selectors ?? {})) {
    assertId(selectorId, `selectors.${selectorId}`);
    assertKeys(selector, new Set(["provider", "exact", "familyLatest"]), `selectors.${selectorId}`);
    assert(policy.providers[selector.provider], `selectors.${selectorId}.provider does not exist`);
    assert(Boolean(selector.exact) !== Boolean(selector.familyLatest), `selectors.${selectorId} must define exactly one selector kind`);
    if (selector.exact) assertId(selector.exact, `selectors.${selectorId}.exact`);
    if (selector.familyLatest) {
      assertKeys(selector.familyLatest, new Set(["family", "suffix", "versionScheme"]), `selectors.${selectorId}.familyLatest`);
      assertId(selector.familyLatest.family, `selectors.${selectorId}.familyLatest.family`);
      assert(typeof selector.familyLatest.suffix === "string", `selectors.${selectorId}.familyLatest.suffix is required`);
      assert(selector.familyLatest.versionScheme === "numeric-dotted", `selectors.${selectorId}.familyLatest.versionScheme must be numeric-dotted`);
    }
  }

  for (const [scopeId, selectors] of Object.entries(policy.piScopes ?? {})) {
    assertId(scopeId, `piScopes.${scopeId}`);
    assert(Array.isArray(selectors) && selectors.length > 0, `piScopes.${scopeId} must be non-empty`);
    for (const selector of selectors) assert(policy.selectors[selector], `piScopes.${scopeId} references missing selector ${selector}`);
  }
  for (const [role, selector] of Object.entries(policy.opencodeRoles ?? {})) {
    assertId(role, `opencodeRoles.${role}`);
    assert(policy.selectors[selector], `opencodeRoles.${role} references missing selector ${selector}`);
  }
  assert(policy.generatedTargets?.cursorProvider, "generatedTargets.cursorProvider is required");
}

export function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
}

export function canonical(value) {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function parseCompactNumber(value) {
  const match = /^(\d+(?:\.\d+)?)([KM])?$/.exec(value);
  if (!match) return undefined;
  const multiplier = match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function titleFromId(id, providerId) {
  const title = id.split("-").map((part) => /^\d/.test(part) ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
  return providerId === "cursor" ? `Cursor ${title}` : title;
}

function applyMetadata(providerId, provider, id, discovered = {}) {
  let model = { name: titleFromId(id, providerId), ...provider.modelDefaults, ...discovered };
  for (const rule of provider.modelRules ?? []) {
    if (new RegExp(rule.match).test(id)) model = { ...model, ...rule.overrides };
  }
  const fallback = provider.fallbackMetadata?.[id];
  if (fallback) model = { ...model, ...fallback.model, ...discovered };
  model.input = [...new Set(model.input)].sort();
  model.cost = { ...provider.modelDefaults.cost, ...(model.cost ?? {}) };
  if (provider.piTransport?.compat) model.compat = { ...provider.piTransport.compat, ...(model.compat ?? {}) };
  validateModel(model, `${providerId}.${id}`);
  return model;
}

async function discoverOpenAi(providerId, provider) {
  const response = await fetch(provider.discovery.url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${providerId} discovery returned HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.data;
  if (!Array.isArray(rows)) throw new Error(`${providerId} discovery response has no data array`);
  return Object.fromEntries(rows.filter((row) => typeof row?.id === "string").map((row) => [row.id, applyMetadata(providerId, provider, row.id)]));
}

async function discoverPiModels(providerId, provider) {
  const piProvider = provider.discovery.provider;
  const output = execFileSync("pi", ["--list-models", piProvider], { encoding: "utf8", timeout: 15000 });
  const models = {};
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== piProvider || parts.length < 6) continue;
    const id = parts[1];
    const contextWindow = parseCompactNumber(parts[2]);
    const maxTokens = parseCompactNumber(parts[3]);
    const reasoning = parts[4] === "yes";
    const input = parts[5] === "yes" ? ["text", "image"] : ["text"];
    models[id] = applyMetadata(providerId, provider, id, { contextWindow, maxTokens, reasoning, input });
  }
  if (Object.keys(models).length === 0) throw new Error(`${providerId} discovery returned no models`);
  return models;
}

async function discoverProvider(providerId, provider) {
  if (provider.discovery.kind === "openai-models") return discoverOpenAi(providerId, provider);
  return discoverPiModels(providerId, provider);
}

function addPolicyFallbacks(providerId, provider, models) {
  const next = { ...models };
  for (const [id, fallback] of Object.entries(provider.fallbackMetadata ?? {})) {
    if (!next[id] && fallback.includeWhenUndiscovered) next[id] = applyMetadata(providerId, provider, id);
  }
  return next;
}

function compareVersions(left, right) {
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function resolveSelectors(policy, providers) {
  const resolved = {};
  for (const [selectorId, selector] of Object.entries(policy.selectors)) {
    const models = providers[selector.provider]?.models ?? {};
    if (selector.exact) {
      assert(models[selector.exact], `selector ${selectorId} requires missing exact model ${selector.provider}/${selector.exact}`);
      resolved[selectorId] = { provider: selector.provider, modelId: selector.exact, mode: "exact" };
      continue;
    }
    const { family, suffix } = selector.familyLatest;
    const expression = new RegExp(`^${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+(?:\\.\\d+)*)${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    const candidates = Object.keys(models).map((id) => {
      const match = expression.exec(id);
      return match ? { id, version: match[1].split(".").map(Number) } : null;
    }).filter(Boolean);
    assert(candidates.length > 0, `selector ${selectorId} has no familyLatest candidates`);
    candidates.sort((a, b) => compareVersions(b.version, a.version));
    if (candidates[1] && compareVersions(candidates[0].version, candidates[1].version) === 0) {
      throw new Error(`Catalog validation: selector ${selectorId} has ambiguous latest candidates ${candidates[0].id} and ${candidates[1].id}`);
    }
    resolved[selectorId] = { provider: selector.provider, modelId: candidates[0].id, mode: "familyLatest" };
  }
  return resolved;
}

export function buildLock(policy, providerModels) {
  const providers = Object.fromEntries(Object.entries(providerModels).map(([id, models]) => [id, { snapshotDigest: digest(models), models }]));
  const resolvedSelectors = resolveSelectors(policy, providers);
  return { schemaVersion: 1, policyDigest: digest(policy), providers, resolvedSelectors };
}

export function validateLockSnapshots(lock) {
  assert(lock?.schemaVersion === 1, "lock schemaVersion must be 1");
  for (const [providerId, provider] of Object.entries(lock.providers ?? {})) {
    assert(provider?.models, `lock is missing models for provider ${providerId}`);
    assert(provider.snapshotDigest === digest(provider.models), `lock digest mismatch for ${providerId}`);
  }
}

export function validateLock(policy, lock) {
  validateLockSnapshots(lock);
  assert(lock.policyDigest === digest(policy), "catalog.lock.json is stale for catalog.yaml; run agentfolio models refresh");
  for (const providerId of Object.keys(policy.providers)) {
    assert(lock.providers?.[providerId]?.models, `lock is missing provider ${providerId}`);
  }
  const expected = resolveSelectors(policy, lock.providers);
  assert(canonical(expected) === canonical(lock.resolvedSelectors), "lock resolvedSelectors are stale");
}

export function resolvedModelId(policy, lock, selectorId, harness) {
  const resolved = lock.resolvedSelectors[selectorId];
  const prefix = policy.providers[resolved.provider].harnessIds[harness];
  assert(prefix, `provider ${resolved.provider} has no ${harness} harness ID`);
  return `${prefix}/${resolved.modelId}`;
}

export function buildCursorProvider(policy, lock) {
  const provider = policy.providers.cursor;
  const models = Object.entries(lock.providers.cursor.models).sort(([a], [b]) => a.localeCompare(b)).map(([id, model]) => ({ id, ...model }));
  return { ...provider.piTransport, models };
}

export function modelPaths(collection) {
  const models = collection.doc.models ?? {};
  return {
    policyPath: resolveCollectionPath(collection.root, models.policy ?? "./harnesses/catalog.yaml"),
    lockPath: resolveCollectionPath(collection.root, models.lock ?? "./harnesses/catalog.lock.json"),
  };
}

export async function loadModelPolicy(collection) {
  const { policyPath } = modelPaths(collection);
  const policy = parseYaml(await readFile(policyPath, "utf8"));
  validateModelPolicy(policy);
  return { policy, policyPath };
}

export async function loadModelLock(collection, policy) {
  const { lockPath } = modelPaths(collection);
  assert(existsSync(lockPath), "catalog.lock.json is missing; run agentfolio models refresh");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  validateLock(policy, lock);
  return { lock, lockPath };
}

async function discoverWithLockFallback(policy, oldLock) {
  const models = {};
  const messages = [];
  for (const [providerId, provider] of Object.entries(policy.providers)) {
    try {
      models[providerId] = addPolicyFallbacks(providerId, provider, await discoverProvider(providerId, provider));
      messages.push(`discovered ${providerId}: ${Object.keys(models[providerId]).length} models`);
    } catch (error) {
      const locked = oldLock?.providers?.[providerId]?.models;
      if (!locked) throw error;
      if (oldLock.policyDigest !== digest(policy)) {
        throw new Error(`${providerId} discovery failed while catalog policy changed; refusing to bless stale metadata. Restore discovery or revert the policy before refresh. Cause: ${error.message}`);
      }
      models[providerId] = locked;
      messages.push(`warning: ${error.message}; using committed ${providerId} lock`);
    }
  }
  return { models, messages };
}

export function modelTargets(collection, policy, lock) {
  const cursorPath = resolveCollectionPath(collection.root, policy.generatedTargets.cursorProvider);
  return new Map([[cursorPath, canonical(buildCursorProvider(policy, lock))]]);
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

export async function checkModels(collection) {
  const { policy, policyPath } = await loadModelPolicy(collection);
  const { lock, lockPath } = await loadModelLock(collection, policy);
  const staleTargets = [];
  for (const [path, expected] of modelTargets(collection, policy, lock)) {
    const current = existsSync(path) ? await readFile(path, "utf8") : null;
    if (current !== expected) staleTargets.push(path);
  }
  return { ok: staleTargets.length === 0, policyPath, lockPath, staleTargets, policy, lock };
}

export async function refreshModels(collection, { write = false } = {}) {
  const { policy } = await loadModelPolicy(collection);
  const { lockPath } = modelPaths(collection);
  const oldLock = existsSync(lockPath) ? JSON.parse(await readFile(lockPath, "utf8")) : null;
  if (oldLock) {
    validateLockSnapshots(oldLock);
    if (oldLock.policyDigest === digest(policy)) validateLock(policy, oldLock);
  }
  const discovered = await discoverWithLockFallback(policy, oldLock);
  const nextLock = buildLock(policy, discovered.models);
  const targets = modelTargets(collection, policy, nextLock);
  const changedTargets = [];
  for (const [path, content] of targets) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current !== content) changedTargets.push(path);
  }
  const lockChanged = canonical(oldLock) !== canonical(nextLock);
  if (write) {
    await writeAtomic(lockPath, canonical(nextLock));
    for (const [path, content] of targets) await writeAtomic(path, content);
  }
  return { ok: true, write, messages: discovered.messages, lockChanged, changedTargets, oldLock, nextLock };
}

export function formatModelsCheck(report) {
  const lines = [report.ok ? "models check passed" : "models check failed"];
  for (const path of report.staleTargets ?? []) lines.push(`stale generated target: ${path}`);
  return lines.join("\n");
}

export function formatModelsRefresh(report) {
  const lines = [...(report.messages ?? [])];
  lines.push(`catalog lock: ${report.lockChanged ? "updated" : "no changes"}`);
  for (const path of report.changedTargets ?? []) lines.push(`${path}: ${report.write ? "updated" : "would update"}`);
  if (report.write) lines.push("catalog refresh complete");
  return lines.join("\n");
}

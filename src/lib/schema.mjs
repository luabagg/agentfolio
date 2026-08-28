/** Collection schema for native skills and collection-owned harness adapters. */

export const COLLECTION_SCHEMA_VERSION = 1;

const ALLOWED_TOP_LEVEL = new Set([
  "name",
  "version",
  "skills",
  "tools",
  "adapters",
  "harnesses",
  "profiles",
]);

export function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/")
    && !value.startsWith("\\") && !value.split(/[\\/]+/).includes("..");
}

export function containsSensitiveKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    /token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key|(?:^|[_-])key$/i.test(key)
    || containsSensitiveKey(child));
}

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(value, allowed, path, errors) {
  if (!isMapping(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

/**
 * Validate a parsed collection document.
 * @returns {{ ok: true, warnings: string[] } | { ok: false, errors: string[], warnings: string[] }}
 */
export function validateCollection(doc) {
  const errors = [];
  const warnings = [];

  if (!isMapping(doc)) {
    return { ok: false, errors: ["collection root must be a mapping"], warnings };
  }

  if (containsSensitiveKey(doc)) errors.push("collection contains sensitive configuration key");

  for (const key of ["name", "version"]) {
    if (doc[key] === undefined || doc[key] === null || doc[key] === "") {
      errors.push(`missing required field: ${key}`);
    }
  }

  if (doc.version !== undefined && doc.version !== COLLECTION_SCHEMA_VERSION) {
    errors.push(
      `unsupported collection.version ${JSON.stringify(doc.version)}; expected ${COLLECTION_SCHEMA_VERSION}`,
    );
  }

  for (const key of Object.keys(doc)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) errors.push(`unknown top-level field: ${key}`);
  }

  if (doc.skills !== undefined) validateSkills(doc.skills, errors);
  if (doc.tools !== undefined) validateTools(doc.tools, errors);
  if (doc.adapters !== undefined) validateAdapters(doc.adapters, errors);
  if (doc.harnesses !== undefined) validateHarnesses(doc.harnesses, doc.adapters, errors);
  if (doc.profiles !== undefined) validateProfiles(doc.profiles, doc.harnesses, errors);

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, warnings };
}

function validateSkills(skills, errors) {
  if (!isMapping(skills)) {
    errors.push("skills must be a mapping");
    return;
  }
  rejectUnknownKeys(skills, new Set(["local", "imports", "scope", "agents", "copy"]), "skills", errors);
  if (skills.local !== undefined && !isSafeRelativePath(skills.local)) {
    errors.push("skills.local must be a relative path string");
  }
  if (skills.imports !== undefined && !isSafeRelativePath(skills.imports)) {
    errors.push("skills.imports must be a relative path string");
  }
  if (skills.scope !== undefined && !["global", "project"].includes(skills.scope)) {
    errors.push('skills.scope must be "global" or "project"');
  }
  if (
    skills.agents !== undefined
    && (!Array.isArray(skills.agents) || skills.agents.some((agent) => typeof agent !== "string" || !agent))
  ) {
    errors.push("skills.agents must be an array of non-empty strings");
  }
  if (skills.copy !== undefined && typeof skills.copy !== "boolean") {
    errors.push("skills.copy must be a boolean");
  }
}

function validateTools(tools, errors) {
  if (!isMapping(tools)) {
    errors.push("tools must be a mapping");
    return;
  }
  rejectUnknownKeys(tools, new Set(["catalog"]), "tools", errors);
  if (tools.catalog !== undefined && !isSafeRelativePath(tools.catalog)) {
    errors.push("tools.catalog must be a relative path string");
  }
}

function validateAdapters(adapters, errors) {
  if (!isMapping(adapters)) {
    errors.push("adapters must be a mapping");
    return;
  }

  for (const [id, adapter] of Object.entries(adapters)) {
    const path = `adapters.${id}`;
    if (!id) errors.push("adapter ids must be non-empty");
    if (!isMapping(adapter)) {
      errors.push(`${path} must be a mapping`);
      continue;
    }
    rejectUnknownKeys(adapter, new Set(["command", "timeout"]), path, errors);
    if (
      !Array.isArray(adapter.command)
      || adapter.command.length === 0
      || adapter.command.some((part) => typeof part !== "string" || !part)
    ) {
      errors.push(`${path}.command must be a non-empty array of non-empty strings`);
    }
    if (adapter.timeout !== undefined && (!Number.isInteger(adapter.timeout) || adapter.timeout <= 0)) {
      errors.push(`${path}.timeout must be a positive integer in milliseconds`);
    }
  }
}

function validateHarnesses(harnesses, adapters, errors) {
  if (!isMapping(harnesses)) {
    errors.push("harnesses must be a mapping");
    return;
  }
  const declaredAdapters = isMapping(adapters) ? adapters : {};

  for (const [id, harness] of Object.entries(harnesses)) {
    const path = `harnesses.${id}`;
    if (!id) errors.push("harness ids must be non-empty");
    if (!isMapping(harness)) {
      errors.push(`${path} must be a mapping`);
      continue;
    }
    rejectUnknownKeys(harness, new Set(["adapter", "actions"]), path, errors);
    if (typeof harness.adapter !== "string" || !harness.adapter) {
      errors.push(`${path}.adapter is required`);
    } else if (!Object.hasOwn(declaredAdapters, harness.adapter)) {
      errors.push(`${path}.adapter references unknown adapter: ${JSON.stringify(harness.adapter)}`);
    }
    if (!Array.isArray(harness.actions) || harness.actions.length === 0) {
      errors.push(`${path}.actions must be a non-empty array`);
      continue;
    }
    for (const [index, action] of harness.actions.entries()) {
      const actionPath = `${path}.actions[${index}]`;
      if (!isMapping(action)) {
        errors.push(`${actionPath} must be a mapping`);
        continue;
      }
      rejectUnknownKeys(action, new Set(["action", "summary", "config"]), actionPath, errors);
      if (typeof action.action !== "string" || !action.action) errors.push(`${actionPath}.action is required`);
      if (action.summary !== undefined && typeof action.summary !== "string") errors.push(`${actionPath}.summary must be a string`);
      if (action.config !== undefined && !isMapping(action.config)) errors.push(`${actionPath}.config must be a mapping`);
      if (action.config !== undefined && containsSensitiveKey(action.config)) errors.push(`${actionPath}.config contains sensitive configuration key`);
    }
  }
}

function validateProfiles(profiles, harnesses, errors) {
  if (!isMapping(profiles)) {
    errors.push("profiles must be a mapping");
    return;
  }
  const declaredHarnesses = isMapping(harnesses) ? harnesses : {};

  for (const [name, profile] of Object.entries(profiles)) {
    const path = `profiles.${name}`;
    if (!isMapping(profile)) {
      errors.push(`${path} must be a mapping`);
      continue;
    }
    rejectUnknownKeys(profile, new Set(["skills", "harnesses"]), path, errors);
    if (profile.skills !== undefined && typeof profile.skills !== "boolean") errors.push(`${path}.skills must be a boolean`);
    if (profile.harnesses !== undefined && !Array.isArray(profile.harnesses)) {
      errors.push(`${path}.harnesses must be an array`);
      continue;
    }
    for (const [index, id] of (profile.harnesses ?? []).entries()) {
      if (typeof id !== "string" || !id) errors.push(`${path}.harnesses[${index}] must be a non-empty string`);
      else if (id !== "*" && !Object.hasOwn(declaredHarnesses, id)) errors.push(`${path}.harnesses[${index}] unknown harness: ${JSON.stringify(id)}`);
    }
  }
}

/**
 * collection.yaml schema (v1).
 *
 * Extensible inventories: skills, tools, harnesses, instructions, plugins.
 * Each inventory declares a backend. Unknown backends fail loudly at plan/apply.
 */

export const COLLECTION_SCHEMA_VERSION = 1;

export const KNOWN_BACKENDS = new Set([
  "skills-cli",
  "chezmoi",
  "reference",
  "none",
]);

export const REQUIRED_TOP_LEVEL = ["name", "version"];

/**
 * Validate a parsed collection document.
 * @returns {{ ok: true, warnings: string[] } | { ok: false, errors: string[], warnings: string[] }}
 */
export function validateCollection(doc) {
  const errors = [];
  const warnings = [];

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, errors: ["collection root must be a mapping"], warnings };
  }

  for (const key of REQUIRED_TOP_LEVEL) {
    if (doc[key] === undefined || doc[key] === null || doc[key] === "") {
      errors.push(`missing required field: ${key}`);
    }
  }

  if (doc.version !== undefined && doc.version !== COLLECTION_SCHEMA_VERSION) {
    errors.push(
      `unsupported collection.version ${JSON.stringify(doc.version)}; expected ${COLLECTION_SCHEMA_VERSION}`,
    );
  }

  if (doc.skills !== undefined) {
    validateSkills(doc.skills, errors, warnings);
  }

  if (doc.tools !== undefined) {
    validateTools(doc.tools, errors, warnings);
  }

  if (doc.harnesses !== undefined) {
    validateHarnesses(doc.harnesses, errors, warnings);
  }

  if (doc.instructions !== undefined) {
    validateInstructions(doc.instructions, errors, warnings);
  }

  if (doc.plugins !== undefined) {
    validatePlugins(doc.plugins, errors, warnings);
  }

  if (doc.models !== undefined) {
    validateModels(doc.models, errors, warnings);
  }

  if (doc.integrations !== undefined) {
    validateIntegrations(doc.integrations, errors, warnings);
  }

  if (doc.chezmoi !== undefined) {
    validateChezmoi(doc.chezmoi, errors, warnings);
  }

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, warnings };
}

function requireBackend(block, path, errors) {
  if (!block || typeof block !== "object") {
    errors.push(`${path} must be a mapping`);
    return;
  }
  const backend = block.backend;
  if (!backend) {
    errors.push(`${path}.backend is required`);
    return;
  }
  if (!KNOWN_BACKENDS.has(backend)) {
    errors.push(
      `${path}.backend ${JSON.stringify(backend)} unknown; known: ${[...KNOWN_BACKENDS].join(", ")}`,
    );
  }
}

function validateSkills(skills, errors, warnings) {
  requireBackend(skills, "skills", errors);
  if (!skills || typeof skills !== "object") return;
  if (skills.backend && skills.backend !== "skills-cli") {
    warnings.push(`skills.backend is ${skills.backend}; recommended skills-cli`);
  }
  if (skills.local !== undefined && typeof skills.local !== "string") {
    errors.push("skills.local must be a relative path string");
  }
  if (skills.imports !== undefined && typeof skills.imports !== "string") {
    errors.push("skills.imports must be a relative path string");
  }
}

function validateTools(tools, errors, warnings) {
  requireBackend(tools, "tools", errors);
  if (!tools || typeof tools !== "object") return;
  if (tools.catalog !== undefined && typeof tools.catalog !== "string") {
    errors.push("tools.catalog must be a relative path string");
  }
  if (tools.apply && tools.apply !== "reference") {
    warnings.push(`tools.apply=${tools.apply}; only "reference" supported in v1`);
  }
}

function validateHarnesses(harnesses, errors, warnings) {
  if (!Array.isArray(harnesses)) {
    errors.push("harnesses must be an array");
    return;
  }
  const ids = new Set();
  for (let i = 0; i < harnesses.length; i++) {
    const h = harnesses[i];
    const path = `harnesses[${i}]`;
    if (!h || typeof h !== "object") {
      errors.push(`${path} must be a mapping`);
      continue;
    }
    if (!h.id) errors.push(`${path}.id is required`);
    else if (ids.has(h.id)) errors.push(`duplicate harness id: ${h.id}`);
    else ids.add(h.id);
    if (!h.source) errors.push(`${path}.source is required`);
    requireBackend(h, path, errors);
    if (h.backend && h.backend !== "chezmoi") {
      warnings.push(`${path}.backend=${h.backend}; harness apply expects chezmoi`);
    }
  }
}

function validateInstructions(instructions, errors, warnings) {
  requireBackend(instructions, "instructions", errors);
  if (!instructions || typeof instructions !== "object") return;
  if (instructions.global !== undefined && typeof instructions.global !== "string") {
    errors.push("instructions.global must be a relative path string");
  }
  if (instructions.backend && instructions.backend !== "chezmoi") {
    warnings.push(
      `instructions.backend=${instructions.backend}; recommended chezmoi for file placement`,
    );
  }
}

function validatePlugins(plugins, errors, warnings) {
  if (!plugins || typeof plugins !== "object") {
    errors.push("plugins must be a mapping");
    return;
  }
  if (plugins.backend && plugins.backend !== "none") {
    warnings.push(`plugins.backend=${plugins.backend}; recommended none (list/hint only)`);
  }
}

function validateModels(models, errors, warnings) {
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    errors.push("models must be a mapping");
    return;
  }
  if (models.policy !== undefined && typeof models.policy !== "string") {
    errors.push("models.policy must be a relative path string");
  }
  if (models.lock !== undefined && typeof models.lock !== "string") {
    errors.push("models.lock must be a relative path string");
  }
}

function validateIntegrations(integrations, errors, warnings) {
  if (!integrations || typeof integrations !== "object" || Array.isArray(integrations)) {
    errors.push("integrations must be a mapping");
    return;
  }
  const cursorBridge = integrations.cursorBridge;
  if (cursorBridge !== undefined && (typeof cursorBridge !== "object" || Array.isArray(cursorBridge))) {
    errors.push("integrations.cursorBridge must be a mapping");
  }
}

function validateChezmoi(chezmoi, errors, warnings) {
  if (!chezmoi || typeof chezmoi !== "object") {
    errors.push("chezmoi must be a mapping");
    return;
  }
  if (chezmoi.sourceDir !== undefined && typeof chezmoi.sourceDir !== "string") {
    errors.push("chezmoi.sourceDir must be a relative path string");
  }
  if (chezmoi.destinationDir !== undefined && typeof chezmoi.destinationDir !== "string") {
    errors.push("chezmoi.destinationDir must be a path string");
  }
}

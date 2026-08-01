import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateCollection } from "./schema.mjs";

export const COLLECTION_FILE = "collection.yaml";

/**
 * Resolve collection root from cwd, --collection, or AGENTFOLIO_COLLECTION.
 * Walks up looking for collection.yaml.
 */
export function findCollectionRoot(startDir = process.cwd(), explicit) {
  if (explicit) {
    const root = resolve(explicit);
    const file = join(root, COLLECTION_FILE);
    if (!existsSync(file)) {
      throw new Error(`No ${COLLECTION_FILE} in ${root}`);
    }
    return root;
  }

  const env = process.env.AGENTFOLIO_COLLECTION?.trim();
  if (env) {
    const root = resolve(env);
    const file = join(root, COLLECTION_FILE);
    if (!existsSync(file)) {
      throw new Error(`AGENTFOLIO_COLLECTION=${env} has no ${COLLECTION_FILE}`);
    }
    return root;
  }

  let dir = resolve(startDir);
  for (;;) {
    const file = join(dir, COLLECTION_FILE);
    if (existsSync(file)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `No ${COLLECTION_FILE} found from ${startDir}. Pass --collection <path> or run agentfolio init.`,
  );
}

export function resolveCollectionPath(root, relative) {
  if (!relative) return null;
  if (isAbsolute(relative)) return relative;
  return resolve(root, relative);
}

/**
 * Load + validate collection.yaml.
 */
export function loadCollection(root) {
  const file = join(root, COLLECTION_FILE);
  const raw = readFileSync(file, "utf8");
  let doc;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${file}: ${err.message}`);
  }

  const validation = validateCollection(doc);
  if (!validation.ok) {
    const detail = validation.errors.map((e) => `  - ${e}`).join("\n");
    throw new Error(`Invalid ${COLLECTION_FILE}:\n${detail}`);
  }

  return {
    root,
    file,
    doc,
    warnings: validation.warnings,
  };
}

/** List skill directories that contain SKILL.md under a local skills path. */
export function listLocalSkills(root, localRelative) {
  const dir = resolveCollectionPath(root, localRelative);
  if (!dir || !existsSync(dir)) return [];

  const entries = [];
  for (const name of readdirSync(dir)) {
    const skillDir = join(dir, name);
    try {
      if (!statSync(skillDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillMd = join(skillDir, "SKILL.md");
    if (existsSync(skillMd)) {
      entries.push({ id: name, path: skillDir, skillMd });
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export function readJsonIfExists(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

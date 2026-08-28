import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const COLLECTION_YAML = `name: my-collection
version: 1

skills:
  local: ./skills
  scope: global
  agents: ["*"]
`;

const SKILL_MD = `---
name: hello-skill
description: Example skill shipped with an Agentfolio collection.
---

# Hello Skill

Say hello and confirm the collection is available.
`;

const README = `# Agentfolio Collection

This directory is a collection because it contains collection.yaml.

Preview the pinned Skills CLI work through Agentfolio:

\`\`\`bash
agentfolio plan
agentfolio apply --dry-run
\`\`\`

Direct Skills installation is intentionally not documented as a floating network command.
`;

/** Scaffold a neutral Skills CLI collection. */
export function initCollection(targetDir, { force = false } = {}) {
  const root = resolve(targetDir);
  const collectionFile = join(root, "collection.yaml");
  if (existsSync(collectionFile) && !force) {
    throw new Error(`${collectionFile} already exists. Pass --force to overwrite scaffold files carefully.`);
  }
  const dirs = [root, join(root, "skills", "hello-skill")];
  for (const dir of dirs) mkdirSync(dir, { recursive: true });
  const files = [
    [collectionFile, COLLECTION_YAML],
    [join(root, "README.md"), README],
    [join(root, "skills", "hello-skill", "SKILL.md"), SKILL_MD],
  ];
  const written = [];
  for (const [path, content] of files) {
    if (existsSync(path) && !force) continue;
    writeFileSync(path, content, "utf8");
    written.push(path);
  }
  return { root, written };
}

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const COLLECTION_YAML = `name: my-collection
version: 1

# Skills via skills-cli (npx skills)
skills:
  backend: skills-cli
  local: ./skills

# Tools are reference-only in v1
tools:
  backend: reference
  catalog: ./tools/catalog.json
  apply: reference

# Harness configs placed by chezmoi (source tree under ./chezmoi)
harnesses:
  - id: pi
    source: ./harnesses/pi
    backend: chezmoi
  - id: cursor
    source: ./harnesses/cursor
    backend: chezmoi

# Global agent instructions placed by chezmoi
instructions:
  global: ./AGENTS.global.md
  backend: chezmoi

plugins:
  backend: none

# chezmoi source → destination (default destination = $HOME)
chezmoi:
  sourceDir: ./chezmoi
  # destinationDir: ./apply-target  # optional; default is $HOME
`;

const AGENTS_GLOBAL = `# Agent Instructions

Add shared rules for every harness that consumes this collection.
`;

const SKILL_MD = `---
name: hello-skill
description: Example skill shipped with an Agentfolio collection scaffold.
---

# Hello Skill

Say hello. Confirm Agentfolio applied this collection.
`;

const TOOLS_CATALOG = `{
  "version": 1,
  "tools": [
    {
      "name": "example-tool",
      "description": "Replace with real tool entries (reference-only in v1).",
      "kind": "cli"
    }
  ]
}
`;

const PI_NOTE = `# Pi harness notes

Declarative harness metadata lives here for humans and Agentfolio list.
Live file placement is owned by the chezmoi source tree under ../../chezmoi/.
`;

const CURSOR_NOTE = `# Cursor harness notes

Declarative harness metadata lives here for humans and Agentfolio list.
Live file placement is owned by the chezmoi source tree under ../../chezmoi/.
`;

const CHEZMOI_PI_AGENTS = `# Applied by Agentfolio via chezmoi

This file lands at ~/.pi/agent/AGENTS.md when you run \`agentfolio apply\`.
`;

const CHEZMOI_CURSOR_AGENT = `---
name: example
description: Example Cursor agent installed from an Agentfolio collection.
model: inherit
readonly: true
---

You are an example Cursor subagent placed by chezmoi from this collection.
`;

/**
 * Scaffold a new collection directory.
 */
export function initCollection(targetDir, { force = false } = {}) {
  const root = resolve(targetDir);
  const collectionFile = join(root, "collection.yaml");

  if (existsSync(collectionFile) && !force) {
    throw new Error(
      `${collectionFile} already exists. Pass --force to overwrite scaffold files carefully.`,
    );
  }

  const dirs = [
    root,
    join(root, "skills", "hello-skill"),
    join(root, "tools"),
    join(root, "harnesses", "pi"),
    join(root, "harnesses", "cursor"),
    join(root, "chezmoi", "dot_pi", "agent"),
    join(root, "chezmoi", "dot_cursor", "agents"),
  ];

  for (const dir of dirs) mkdirSync(dir, { recursive: true });

  const files = [
    [collectionFile, COLLECTION_YAML],
    [join(root, "AGENTS.global.md"), AGENTS_GLOBAL],
    [join(root, "skills", "hello-skill", "SKILL.md"), SKILL_MD],
    [join(root, "tools", "catalog.json"), TOOLS_CATALOG],
    [join(root, "harnesses", "pi", "README.md"), PI_NOTE],
    [join(root, "harnesses", "cursor", "README.md"), CURSOR_NOTE],
    [join(root, "chezmoi", "dot_pi", "agent", "AGENTS.md"), CHEZMOI_PI_AGENTS],
    [
      join(root, "chezmoi", "dot_cursor", "agents", "example.md"),
      CHEZMOI_CURSOR_AGENT,
    ],
  ];

  const written = [];
  for (const [path, content] of files) {
    if (existsSync(path) && !force) continue;
    writeFileSync(path, content, "utf8");
    written.push(path);
  }

  return { root, written };
}

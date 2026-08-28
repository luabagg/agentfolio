#!/usr/bin/env node

import { existsSync } from "node:fs";
import { applyCollection, formatApplyText } from "../src/lib/apply.mjs";
import { listSkillsInventory } from "../src/backends/skills-cli.mjs";
import { initCollection } from "../src/commands/init.mjs";
import {
  findCollectionRoot,
  loadCollection,
  readJsonIfExists,
  resolveCollectionPath,
} from "../src/lib/collection.mjs";
import { formatDoctorText, runDoctor } from "../src/lib/doctor.mjs";
import { buildPlan, formatPlanText } from "../src/lib/plan.mjs";
import { resolveProfile } from "../src/lib/profiles.mjs";

const VERSION = "0.1.0";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function printHelp() {
  console.log(`agentfolio ${VERSION}

Orchestrate YAML harness workflows through collection-owned adapters.

Usage:
  agentfolio <command> [options]

Commands:
  init [dir]              Scaffold a Skills CLI collection (default: .)
  list <target>           List skills | harnesses | tools | profiles
  plan                    Plan native skills and selected harness actions
  apply [--dry-run]       Apply actions selected by a collection profile
  doctor                  Check runtime dependencies and harness adapters
  verify                  Validate, plan, and check a collection
  help                    Show this help
  version                 Show version

Global options:
  --collection <path>     Collection root (or AGENTFOLIO_COLLECTION)
  --profile <name>        Collection-defined profile (default: default)
  --json                  Machine-readable JSON where supported
  --dry-run               Preview apply without writing
  --force                 Overwrite scaffold files on init

Examples:
  agentfolio init ./my-collection
  agentfolio list harnesses
  agentfolio plan --profile workstation
  agentfolio apply --profile workstation --dry-run
  agentfolio doctor
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const flags = { collection: null, profile: "default", json: false, dryRun: false, force: false };
  const positionals = [];

  while (args.length) {
    const token = args.shift();
    if (token === "--collection") {
      flags.collection = args.shift();
      if (!flags.collection) fail("--collection requires a path");
    } else if (token.startsWith("--collection=")) {
      flags.collection = token.slice("--collection=".length);
    } else if (token === "--profile") {
      flags.profile = args.shift();
      if (!flags.profile) fail("--profile requires a name");
    } else if (token.startsWith("--profile=")) {
      flags.profile = token.slice("--profile=".length);
    } else if (token === "--json") flags.json = true;
    else if (token === "--dry-run") flags.dryRun = true;
    else if (token === "--force") flags.force = true;
    else if (token === "--help" || token === "-h") positionals.unshift("help");
    else if (token === "--version" || token === "-V") positionals.unshift("version");
    else if (token.startsWith("-")) fail(`Unknown flag: ${token}`);
    else positionals.push(token);
  }
  return { flags, positionals };
}

function loadFromFlags(flags) {
  return loadCollection(findCollectionRoot(process.cwd(), flags.collection));
}

function cmdList(collection, target, flags) {
  const { doc, root } = collection;
  if (target === "skills") {
    const inventory = listSkillsInventory(collection);
    if (flags.json) return console.log(JSON.stringify(inventory, null, 2));
    console.log(`Local skills (${inventory.local.length}):`);
    for (const skill of inventory.local) console.log(`  - ${skill.id}  (${skill.path})`);
    if (inventory.imports) console.log(`Imports: ${inventory.imports}`);
    return;
  }

  if (target === "harnesses") {
    const harnesses = doc.harnesses ?? {};
    if (flags.json) return console.log(JSON.stringify(harnesses, null, 2));
    console.log(`Harnesses (${Object.keys(harnesses).length}):`);
    for (const [id, harness] of Object.entries(harnesses)) {
      console.log(`  - ${id}: adapter=${harness.adapter}; actions=${harness.actions.length}`);
    }
    return;
  }

  if (target === "tools") {
    const catalogPath = doc.tools?.catalog ? resolveCollectionPath(root, doc.tools.catalog) : null;
    const catalog = catalogPath ? readJsonIfExists(catalogPath) : null;
    if (flags.json) return console.log(JSON.stringify({ path: catalogPath, catalog }, null, 2));
    if (!catalogPath) return console.log("No tools.catalog declared");
    console.log(`Tools catalog: ${catalogPath}`);
    console.log(`Exists: ${existsSync(catalogPath)}`);
    for (const tool of catalog?.tools ?? []) console.log(`  - ${tool.name}${tool.kind ? ` (${tool.kind})` : ""}`);
    return;
  }

  if (target === "profiles") {
    const profiles = {
      default: resolveProfile(doc, "default"),
      ...Object.fromEntries(
        Object.keys(doc.profiles ?? {})
          .filter((name) => name !== "default")
          .map((name) => [name, resolveProfile(doc, name)]),
      ),
    };
    if (flags.json) return console.log(JSON.stringify(profiles, null, 2));
    console.log(`Profiles (${Object.keys(profiles).length}):`);
    for (const selected of Object.values(profiles)) {
      console.log(`  - ${selected.name}: skills=${selected.skills}; harnesses=${selected.harnesses.join(", ") || "none"}`);
    }
    return;
  }

  fail(`Unknown list target: ${target}. Use skills|harnesses|tools|profiles`);
}

function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? "help";

  try {
    switch (command) {
      case "help": printHelp(); return;
      case "version": console.log(VERSION); return;
      case "init": {
        const result = initCollection(positionals[1] ?? ".", { force: flags.force });
        console.log(`Initialized collection at ${result.root}`);
        console.log(`Wrote ${result.written.length} file(s)`);
        for (const path of result.written) console.log(`  ${path}`);
        return;
      }
      case "list": {
        const target = positionals[1];
        if (!target) fail("Usage: agentfolio list <skills|harnesses|tools|profiles>");
        cmdList(loadFromFlags(flags), target, flags);
        return;
      }
      case "plan": {
        const plan = buildPlan(loadFromFlags(flags), { profile: flags.profile });
        console.log(flags.json ? JSON.stringify(plan, null, 2) : formatPlanText(plan));
        return;
      }
      case "apply": {
        const report = applyCollection(loadFromFlags(flags), {
          dryRun: flags.dryRun,
          profile: flags.profile,
          projectRoot: process.cwd(),
        });
        console.log(flags.json ? JSON.stringify(report, null, 2) : formatApplyText(report));
        if (!report.ok) process.exit(1);
        return;
      }
      case "doctor": {
        let collection = null;
        try {
          collection = loadFromFlags(flags);
        } catch (error) {
          if (flags.collection || process.env.AGENTFOLIO_COLLECTION) throw error;
        }
        const report = runDoctor(collection, { profile: flags.profile });
        console.log(flags.json ? JSON.stringify(report, null, 2) : formatDoctorText(report));
        if (!report.ok) process.exit(1);
        return;
      }
      case "verify": {
        const collection = loadFromFlags(flags);
        const plan = buildPlan(collection, { profile: flags.profile });
        const doctor = runDoctor(collection, { profile: flags.profile });
        const ok = doctor.ok;
        if (flags.json) console.log(JSON.stringify({ ok, plan, doctor }, null, 2));
        else {
          console.log(formatPlanText(plan));
          console.log("");
          console.log(formatDoctorText(doctor));
          console.log("");
          console.log(`Verify: ${ok ? "OK" : "FAIL"}`);
        }
        if (!ok) process.exit(1);
        return;
      }
      default: fail(`Unknown command: ${command}\nRun: agentfolio help`);
    }
  } catch (error) {
    fail(error?.message ?? String(error));
  }
}

main();

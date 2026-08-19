#!/usr/bin/env node

import { findCollectionRoot, loadCollection } from "../src/lib/collection.mjs";
import { buildPlan, formatPlanText } from "../src/lib/plan.mjs";
import { runDoctor, formatDoctorText } from "../src/lib/doctor.mjs";
import { applyCollection, formatApplyText } from "../src/lib/apply.mjs";
import { diffChezmoi, statusChezmoi } from "../src/backends/chezmoi.mjs";
import { listSkillsInventory } from "../src/backends/skills-cli.mjs";
import { initCollection } from "../src/commands/init.mjs";
import { formatPiSetupText, PI_PROFILES, setupPi } from "../src/harnesses/pi.mjs";
import { checkModels, formatModelsCheck, formatModelsRefresh, refreshModels } from "../src/inventories/models.mjs";
import { resolveCollectionPath, readJsonIfExists } from "../src/lib/collection.mjs";
import { existsSync } from "node:fs";

const VERSION = "0.1.0";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function printHelp() {
  console.log(`agentfolio ${VERSION}

Orchestrate agent collections: skills via skills-cli, harness configs via chezmoi.

Usage:
  agentfolio <command> [options]

Commands:
  init [dir]              Scaffold a new collection (default: .)
  list <target>           List skills | harnesses | tools | plugins
  plan                    Show apply plan (skills-cli + chezmoi)
  diff                    Show chezmoi diff against destination
  status                  Show chezmoi status
  apply [--dry-run] [--profile <name>]
                          Apply a profile (default: skills + chezmoi)
  setup pi [--catalog-only] [--skip-cursor-bridge]
                          Apply Pi packages, extensions, catalog, optional Cursor bridge
  doctor                  Check node/npx/chezmoi/skills + collection
  models check|diff|refresh Validate/diff/refresh model catalog lock and generated targets
  verify                  Validate collection + doctor checks
  help                    Show this help
  version                 Show version

Global options:
  --collection <path>     Collection root (or AGENTFOLIO_COLLECTION)
  --json                  Machine-readable JSON where supported
  --dry-run               Preview apply without writing
  --force                 Overwrite scaffold files on init
  --profile <name>        default | pi | pi-catalog | cursor-bridge
  --catalog-only          Pi catalog/settings/models only
  --skip-cursor-bridge    Skip Cursor ACP bridge during Pi setup

Examples:
  agentfolio init ./my-collection
  agentfolio plan --collection ./examples/demo-collection
  agentfolio apply --dry-run
  agentfolio doctor
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const flags = {
    collection: null,
    json: false,
    dryRun: false,
    force: false,
    profile: "default",
    catalogOnly: false,
    skipCursorBridge: false,
  };
  const positionals = [];

  while (args.length) {
    const token = args.shift();
    if (token === "--collection") {
      flags.collection = args.shift();
      if (!flags.collection) fail("--collection requires a path");
      continue;
    }
    if (token.startsWith("--collection=")) {
      flags.collection = token.slice("--collection=".length);
      continue;
    }
    if (token === "--json") {
      flags.json = true;
      continue;
    }
    if (token === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (token === "--force") {
      flags.force = true;
      continue;
    }
    if (token === "--profile") {
      flags.profile = args.shift();
      if (!flags.profile) fail("--profile requires a name");
      continue;
    }
    if (token.startsWith("--profile=")) {
      flags.profile = token.slice("--profile=".length);
      continue;
    }
    if (token === "--catalog-only") {
      flags.catalogOnly = true;
      continue;
    }
    if (token === "--skip-cursor-bridge") {
      flags.skipCursorBridge = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      positionals.unshift("help");
      continue;
    }
    if (token === "--version" || token === "-V") {
      positionals.unshift("version");
      continue;
    }
    if (token.startsWith("-")) {
      fail(`Unknown flag: ${token}`);
    }
    positionals.push(token);
  }

  return { flags, positionals };
}

function loadFromFlags(flags) {
  const root = findCollectionRoot(process.cwd(), flags.collection);
  return loadCollection(root);
}

function cmdList(collection, target, flags) {
  const { doc, root } = collection;

  if (target === "skills") {
    const inventory = listSkillsInventory(collection);
    if (flags.json) {
      console.log(JSON.stringify(inventory, null, 2));
      return;
    }
    console.log(`Local skills (${inventory.local.length}):`);
    for (const skill of inventory.local) {
      console.log(`  - ${skill.id}  (${skill.path})`);
    }
    if (inventory.imports) console.log(`Imports: ${inventory.imports}`);
    return;
  }

  if (target === "harnesses") {
    const harnesses = doc.harnesses ?? [];
    if (flags.json) {
      console.log(JSON.stringify(harnesses, null, 2));
      return;
    }
    console.log(`Harnesses (${harnesses.length}):`);
    for (const h of harnesses) {
      console.log(`  - ${h.id}  source=${h.source}  backend=${h.backend}`);
    }
    return;
  }

  if (target === "tools") {
    const catalogPath = doc.tools?.catalog
      ? resolveCollectionPath(root, doc.tools.catalog)
      : null;
    const catalog = catalogPath ? readJsonIfExists(catalogPath) : null;
    if (flags.json) {
      console.log(JSON.stringify({ path: catalogPath, catalog }, null, 2));
      return;
    }
    if (!catalogPath) {
      console.log("No tools.catalog declared");
      return;
    }
    console.log(`Tools catalog: ${catalogPath}`);
    console.log(`Exists: ${existsSync(catalogPath)}`);
    const tools = catalog?.tools ?? [];
    for (const tool of tools) {
      console.log(`  - ${tool.name}${tool.kind ? ` (${tool.kind})` : ""}`);
    }
    return;
  }

  if (target === "plugins") {
    const plugins = doc.plugins ?? { backend: "none" };
    if (flags.json) {
      console.log(JSON.stringify(plugins, null, 2));
      return;
    }
    console.log("Plugins (hint only):");
    console.log(JSON.stringify(plugins, null, 2));
    return;
  }

  fail(`Unknown list target: ${target}. Use skills|harnesses|tools|plugins`);
}

async function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? "help";

  try {
    switch (command) {
      case "help":
        printHelp();
        return;

      case "version":
        console.log(VERSION);
        return;

      case "init": {
        const dir = positionals[1] ?? ".";
        const result = initCollection(dir, { force: flags.force });
        console.log(`Initialized collection at ${result.root}`);
        console.log(`Wrote ${result.written.length} file(s)`);
        for (const path of result.written) console.log(`  ${path}`);
        return;
      }

      case "list": {
        const target = positionals[1];
        if (!target) fail("Usage: agentfolio list <skills|harnesses|tools|plugins>");
        cmdList(loadFromFlags(flags), target, flags);
        return;
      }

      case "plan": {
        const collection = loadFromFlags(flags);
        const plan = buildPlan(collection);
        if (flags.json) {
          console.log(JSON.stringify(plan, null, 2));
        } else {
          console.log(formatPlanText(plan));
        }
        return;
      }

      case "diff": {
        const collection = loadFromFlags(flags);
        const result = diffChezmoi(collection);
        if (flags.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (!result.available) fail(result.stderr);
          if (result.stdout) console.log(result.stdout);
          if (result.stderr) console.error(result.stderr);
          if (result.missingSource) process.exit(1);
        }
        if (result.status && result.status !== 0 && !result.missingSource) {
          // chezmoi diff exits 0 even with diffs; non-zero is a real error
          process.exit(result.status);
        }
        return;
      }

      case "status": {
        const collection = loadFromFlags(flags);
        const result = statusChezmoi(collection);
        if (flags.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (!result.available) fail(result.stderr);
          if (result.stdout) console.log(result.stdout);
          if (result.stderr) console.error(result.stderr);
          if (result.missingSource) process.exit(1);
        }
        return;
      }

      case "apply": {
        const collection = loadFromFlags(flags);
        const profile = PI_PROFILES[flags.profile];
        if (!profile) fail(`Unknown profile: ${flags.profile}. Use ${Object.keys(PI_PROFILES).join(" | ")}`);
        if (profile.pi) {
          const report = await setupPi(collection, {
            dryRun: flags.dryRun,
            catalogOnly: profile.catalogOnly || flags.catalogOnly,
            skipCursorBridge: profile.skipCursorBridge || flags.skipCursorBridge,
            bridgeOnly: profile.bridgeOnly,
          });
          if (flags.json) console.log(JSON.stringify(report, null, 2));
          else console.log(formatPiSetupText(report));
          if (!report.ok) process.exit(1);
          return;
        }
        const report = applyCollection(collection, { dryRun: flags.dryRun });
        if (flags.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatApplyText(report));
        }
        if (!report.ok) process.exit(1);
        return;
      }

      case "setup": {
        const target = positionals[1];
        if (target !== "pi") fail("Usage: agentfolio setup pi [--catalog-only] [--skip-cursor-bridge] [--dry-run]");
        const collection = loadFromFlags(flags);
        const report = await setupPi(collection, {
          dryRun: flags.dryRun,
          catalogOnly: flags.catalogOnly,
          skipCursorBridge: flags.skipCursorBridge,
        });
        if (flags.json) console.log(JSON.stringify(report, null, 2));
        else console.log(formatPiSetupText(report));
        if (!report.ok) process.exit(1);
        return;
      }

      case "models": {
        const subcommand = positionals[1] ?? "check";
        const collection = loadFromFlags(flags);
        if (subcommand === "check") {
          const report = await checkModels(collection);
          if (flags.json) console.log(JSON.stringify(report, null, 2));
          else console.log(formatModelsCheck(report));
          if (!report.ok) process.exit(1);
          return;
        }
        if (subcommand === "diff" || subcommand === "refresh") {
          const report = await refreshModels(collection, {
            write: subcommand === "refresh" && !flags.dryRun,
          });
          if (flags.json) console.log(JSON.stringify(report, null, 2));
          else console.log(formatModelsRefresh(report));
          return;
        }
        fail("Usage: agentfolio models <check|diff|refresh>");
      }

      case "doctor": {
        let collection = null;
        try {
          collection = loadFromFlags(flags);
        } catch (err) {
          // doctor can run without a collection
          if (flags.collection || process.env.AGENTFOLIO_COLLECTION) throw err;
        }
        const report = runDoctor(collection);
        if (flags.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatDoctorText(report));
        }
        if (!report.ok) process.exit(1);
        return;
      }

      case "verify": {
        const collection = loadFromFlags(flags);
        const plan = buildPlan(collection);
        const doctor = runDoctor(collection);
        const ok = doctor.ok;
        if (flags.json) {
          console.log(JSON.stringify({ ok, plan, doctor }, null, 2));
        } else {
          console.log(formatPlanText(plan));
          console.log("");
          console.log(formatDoctorText(doctor));
          console.log("");
          console.log(`Verify: ${ok ? "OK" : "FAIL"}`);
        }
        if (!ok) process.exit(1);
        return;
      }

      default:
        fail(`Unknown command: ${command}\nRun: agentfolio help`);
    }
  } catch (err) {
    fail(err?.message ?? String(err));
  }
}

main();

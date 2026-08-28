import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "package.json";
const pkg = JSON.parse(readFileSync(file, "utf8"));
const errors = [];
for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) errors.push(`package.json dependencies.${name} must use exact semver`);
}
for (const name of ["preinstall", "install", "postinstall"]) {
  if (pkg.scripts?.[name] !== undefined) errors.push(`package.json scripts.${name} is disallowed`);
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
}

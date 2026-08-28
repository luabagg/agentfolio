import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const explicitFiles = process.argv.slice(2);
const files = explicitFiles.length ? explicitFiles : (() => {
  const result = spawnSync("git", ["ls-files"], { encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error("unable to list tracked files");
  return result.stdout.split("\n").filter(Boolean);
})();
const patterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]{12,}/i,
  /(API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*(?!\[REDACTED\])[A-Za-z0-9._-]{12,}/i,
];
let found = false;
for (const file of files) {
  if (file === "package-lock.json") continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [index, line] of text.split("\n").entries()) {
    if (patterns.some((pattern) => pattern.test(line))) {
      console.error(`${file}:${index + 1}: secret-pattern`);
      found = true;
    }
  }
}
if (found) process.exitCode = 1;

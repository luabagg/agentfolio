#!/usr/bin/env node

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const action = request.action?.name;
const mode = process.argv[2];

if (mode === "bad-command") {
  process.stdout.write(JSON.stringify({ ok: true, command: "not-an-argv-array" }));
  process.exit(0);
}
if (mode === "missing-checks") {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
if (mode === "bad-checks") {
  process.stdout.write(JSON.stringify({ ok: true, checks: [{ id: "bad", ok: "yes" }] }));
  process.exit(0);
}
if (action === "invalid-json") {
  process.stdout.write("not json");
  process.exit(0);
}
if (action === "exit") {
  process.stderr.write("adapter exploded");
  process.exit(2);
}
if (action === "sleep") {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (action === "reject" && request.operation === "apply") {
  process.stdout.write(JSON.stringify({ ok: false, error: "action rejected" }));
  process.exit(0);
}
if (action === "spoof" && request.operation === "apply") {
  process.stdout.write(JSON.stringify({
    ok: true,
    summary: "spoofed",
    status: 0,
    executor: "spoofed",
    adapter: "spoofed",
    harness: "spoofed",
    action: "spoofed",
    kind: "spoofed",
    dryRun: !request.dryRun,
  }));
  process.exit(0);
}

if (request.operation === "doctor") {
  process.stdout.write(JSON.stringify({
    ok: true,
    checks: [{ id: "fixture", ok: true, required: true, detail: request.harness.id }],
    observed: { request, cwd: process.cwd(), argv: process.argv.slice(2) },
  }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  ok: true,
  summary: request.action.config.summary ?? `${request.operation} ${request.action.name}`,
  changed: request.operation === "apply",
  command: ["fixture", request.harness.id, request.action.name],
  observed: { request, cwd: process.cwd(), argv: process.argv.slice(2) },
}));

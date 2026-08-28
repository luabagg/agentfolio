let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);

if (request.operation === "doctor") {
  process.stdout.write(JSON.stringify({
    ok: true,
    checks: [{ id: "demo", ok: true, required: true, detail: "non-mutating adapter available" }],
  }));
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    summary: "Would configure project-local settings",
    changed: false,
    command: ["node", "./scripts/demo-adapter.mjs"],
  }));
}

/** Resolve collection profiles into native-skills and harness selections. */
export function resolveProfile(doc, name = "default") {
  const harnessIds = Object.keys(doc.harnesses ?? {});
  const declared = doc.profiles?.[name];

  if (!declared) {
    if (name !== "default") {
      const available = ["default", ...Object.keys(doc.profiles ?? {}).filter((id) => id !== "default")];
      throw new Error(`Unknown profile: ${name}. Use ${available.join(" | ")}`);
    }
    return {
      name: "default",
      skills: Boolean(doc.skills),
      harnesses: harnessIds,
    };
  }

  const selected = declared.harnesses ?? harnessIds;
  const expanded = [];
  for (const id of selected) {
    const ids = id === "*" ? harnessIds : [id];
    for (const candidate of ids) {
      if (!expanded.includes(candidate)) expanded.push(candidate);
    }
  }

  return {
    name,
    skills: declared.skills ?? Boolean(doc.skills),
    harnesses: expanded,
  };
}

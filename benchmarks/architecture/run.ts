import { assembleEvidence, step, writeEvidence } from "./harness";

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

const label = argValue("--label");
if (!label) {
  console.error("usage: bun run benchmarks/architecture/run.ts --label <label> --step <name> \"<command>\" [...]");
  process.exit(64);
}

const steps: { name: string; command: string }[] = [];
for (let i = 0; i < argv.length - 2; i++) {
  if (argv[i] === "--step") steps.push({ name: argv[i + 1], command: argv[i + 2] });
}
if (steps.length === 0) {
  console.error("at least one --step <name> \"<command>\" is required");
  process.exit(64);
}

const repoRoot = new URL("../../", import.meta.url).pathname;
const results = steps.map((s) => step(s.name, s.command));
const evidence = await assembleEvidence(
  label,
  repoRoot,
  results,
  [`bun run benchmarks/architecture/run.ts --label ${label} ${steps.map((s) => `--step ${s.name} "${s.command}"`).join(" ")}`]
);
const file = await writeEvidence(evidence, new URL(`evidence/${label}`, import.meta.url).pathname);
const failed = results.filter((r) => r.exit_code !== 0);
console.log(`evidence: ${file}`);
console.log(`steps: ${results.length} (${failed.length} failed)`);
process.exit(failed.length > 0 ? 1 : 0);

/** Build the SAME portable script for the browser contract host and QuickJS. */
import { build } from "bun";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";

export async function buildWorkoutBundleCode(): Promise<string> {
  const result = await build({
    entrypoints: [resolve(import.meta.dir, "../src/host-entry.ts")],
    target: "browser",
    format: "iife",
    minify: false,
    external: [],
  });
  if (!result.success || !result.outputs[0]) {
    throw new Error(`Workout bundle build failed:\n${result.logs.map(String).join("\n")}`);
  }
  return result.outputs[0].text();
}

export async function buildWorkoutBundle(outputPath: string): Promise<void> {
  const code = await buildWorkoutBundleCode();
  // Boot verification in a bare context (no timer globals — the QuickJS
  // condition, so the entry's setTimeout shim must install).
  const committed: string[] = [];
  const context: Record<string, unknown> = { tenun_commit: (json: string) => committed.push(json) };
  runInNewContext(code, context, { filename: "workout-app.js", timeout: 5000 });
  const first = JSON.parse(committed[0] ?? "null");
  if (first?.tenun !== "display-list" || typeof context["__tenun_dispatch_action"] !== "function" ||
      !first.ops.some((op: { op?: string; text?: string }) => op.op === "text-input") ||
      !first.ops.some((op: { op?: string; text?: string }) => op.op === "text" && op.text === "Focus Workout")) {
    throw new Error("Workout bundle did not boot through the public host contract");
  }
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, code);
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 16);
  console.log(`workout-pilot bundle: ${destination} (${Buffer.byteLength(code)} bytes, sha256:${hash})`);
}

if (import.meta.main) {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error("usage: bun examples/workout-pilot/scripts/build-host.ts <output-path>");
    process.exit(1);
  }
  await buildWorkoutBundle(outputPath);
}

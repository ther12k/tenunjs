/** Build the SAME portable script for the browser contract host and QuickJS. */
import { build } from "bun";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";

export async function buildFrameworkFeelBundle(outputPath: string): Promise<void> {
  const result = await build({
    entrypoints: [resolve(import.meta.dir, "../src/host-entry.ts")],
    target: "browser",
    format: "iife",
    minify: false,
    external: [],
  });
  if (!result.success || !result.outputs[0]) {
    throw new Error(`Day Plan bundle build failed:\n${result.logs.map(String).join("\n")}`);
  }
  const code = await result.outputs[0].text();
  const committed: string[] = [];
  const context: Record<string, unknown> = { tenun_commit: (json: string) => committed.push(json) };
  runInNewContext(code, context, { filename: "framework-feel-app.js", timeout: 5000 });
  const first = JSON.parse(committed[0] ?? "null");
  if (first?.tenun !== "display-list" || typeof context["__tenun_dispatch_action"] !== "function" ||
      !first.ops.some((op: { op?: string; text?: string }) => op.op === "text" && op.text === "Day Plan")) {
    throw new Error("Day Plan bundle did not boot through the public host contract");
  }
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, code);
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 16);
  console.log(`framework-feel bundle: ${destination} (${Buffer.byteLength(code)} bytes, sha256:${hash})`);
}

if (import.meta.main) {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error("usage: bun examples/framework-feel/scripts/build-host.ts <output-path>");
    process.exit(1);
  }
  await buildFrameworkFeelBundle(outputPath);
}

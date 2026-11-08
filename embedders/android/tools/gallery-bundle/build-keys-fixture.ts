/** Compile the TN-189 public-adapter fixture into an instrumentation-only asset. */
import { build } from "bun";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("usage: bun build-keys-fixture.ts <output-path>");
const result = await build({
  entrypoints: [resolve(import.meta.dir, "keys-fixture-entry.ts")],
  target: "browser",
  format: "iife",
  minify: false,
});
if (!result.success || !result.outputs[0]) {
  throw new Error(`keys fixture build failed:\n${result.logs.map(String).join("\n")}`);
}
const code = await result.outputs[0].text();
const destination = resolve(outputPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, code);
console.log(`keys fixture: ${destination} (${code.length} bytes, sha256:${createHash("sha256").update(code).digest("hex")})`);

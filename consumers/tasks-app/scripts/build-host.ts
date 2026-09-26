/**
 * Builds this application's host bundle (.out/host-app.js): the app entry
 * a generic TenunJS host (browser contract host, Android prototype) can
 * load and drive through the public commit/dispatch protocol.
 */
import { build } from "bun";
import { mkdirSync } from "node:fs";

const result = await build({
  entrypoints: ["src/host.ts"],
  target: "browser",
  format: "esm",
  minify: false,
  external: [],
});

if (!result.success) {
  console.error("HOST-BUILD-FAILED:\n" + result.logs.map(String).join("\n"));
  process.exit(1);
}

mkdirSync(".out", { recursive: true });
await Bun.write(".out/host-app.js", result.outputs[0]!);
console.log("host bundle: .out/host-app.js");

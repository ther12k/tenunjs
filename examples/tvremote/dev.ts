#!/usr/bin/env bun
/**
 * Android TV Remote companion app dev server.
 * Serves the browser preview with simulated TV pairing & remote monitor.
 *
 * Run from repo root: bun examples/tvremote/dev.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TVREMOTE_DEV_PORT ?? 8175);

let lastBundle: string | null = null;

async function build(): Promise<string | null> {
  const out = await Bun.build({
    entrypoints: [path.join(here, "preview.ts")],
    target: "browser",
    format: "esm",
    jsx: { runtime: "automatic", importSource: "@tenunjs/jsx-runtime" },
    minify: false,
  });
  if (!out.success) {
    for (const log of out.logs) console.error(log);
    return null;
  }
  return await out.outputs[0]!.text();
}

console.log(`Building TV Remote preview bundle...`);
lastBundle = await build();

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = fs.readFileSync(path.join(here, "preview.html"), "utf-8");
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/preview.ts" || url.pathname === "/preview.js") {
      // Rebuild on every script request in dev
      lastBundle = await build();
      if (!lastBundle) return new Response("Build failed", { status: 500 });
      return new Response(lastBundle, { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`TV Remote preview server running at http://localhost:${server.port}`);

#!/usr/bin/env bun
/**
 * VOTOL app dev server: build the preview bundle, serve the shell, and proxy
 * /backend/* to the esp-votol dashboard backend (default http://127.0.0.1:8080,
 * override with VOTOL_DASH=http://host:port). The proxy keeps the app
 * same-origin with its data — no CORS, and the phone on the LAN can open this
 * page directly.
 *
 * Run from the repo root:  bun examples/votol/dev.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DASH = process.env.VOTOL_DASH ?? "http://127.0.0.1:8080";
const PORT = Number(process.env.VOTOL_DEV_PORT ?? 8173);

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
  lastBundle = await new Response(out.outputs[0]).text(); // BuildArtifact is a Blob
  return lastBundle;
}

await build(); // fail-soft: serve the shell with an error status if the build broke

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/" || pathname === "/index.html") {
      const html = fs.readFileSync(path.join(here, "index.html"), "utf8");
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (pathname === "/preview.js") {
      const js = (await build()) ?? lastBundle;
      if (js == null) return new Response("// build failed — see server console\n", { status: 500 });
      return new Response(js, { headers: { "Content-Type": "text/javascript" } });
    }
    if (pathname.startsWith("/backend/")) {
      const target = DASH + pathname.slice("/backend".length) + new URL(request.url).search;
      try {
        const init: RequestInit = { method: request.method, headers: { "Content-Type": "application/json" } };
        if (request.method !== "GET" && request.method !== "HEAD") {
          init.body = await request.text();
        }
        const upstream = await fetch(target, init);
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, msg: `backend unreachable: ${String(e)}` }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("not found\n", { status: 404 });
  },
});

console.log(`VOTOL app:  http://localhost:${PORT}   (backend proxy → ${DASH})`);
console.log(`on the LAN: http://<this-host>:${PORT}  (VOTOL_DASH=… to retarget)`);

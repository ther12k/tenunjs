#!/usr/bin/env bun
/** Gallery UI dev server: Android bundle + browser preview + hot reload. */
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./bundle-lib.ts";

const previewHtmlPath = path.join(repoRoot, "examples/gallery-preview/index.html");
const rebuildScript = path.join(repoRoot, "embedders/android/tools/gallery-bundle/rebuild.ts");
const markerPath = path.join(repoRoot, "embedders/android/tools/gallery-bundle/.last-build.json");

/** One build per process: see rebuild.ts for why. */
async function rebuild(): Promise<{ android: string; browser: string } | null> {
  const proc = Bun.spawnSync([process.execPath, rebuildScript], { stdout: "pipe", stderr: "pipe" });
  const out = proc.stdout.toString().trim();
  if (proc.exitCode !== 0 || !out.startsWith("OK ")) {
    console.error(`rebuild failed (serving last good bundles):\n${proc.stderr.toString().trim() || out}`);
    return null;
  }
  const [, android, browser] = out.split(" ");
  console.log(`rebuilt: Android ${android}, browser ${browser}`);
  return { android, browser };
}

function readState(): { android: string; browser: string; builtAtMtime: number } {
  const saved = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  return saved;
}

// Build (or reuse the marker) at startup.
let state = readState();
if (Bun.argv[2] !== "status-only") {
  await rebuild();
  state = readState();
}
console.log(`gallery dev server: Android ${state.android}, browser ${state.browser}`);

/** Returns true when a new pair of hashes is now on disk. */
async function refresh(): Promise<boolean> {
  const proc = Bun.spawnSync([process.execPath, rebuildScript, "status"], { stdout: "pipe", stderr: "pipe" });
  const out = proc.stdout.toString().trim();
  if (proc.exitCode === 0 && out.startsWith("OK ")) {
    const [, android, browser] = out.split(" ");
    if (android !== state.android || browser !== state.browser) {
      const next = await rebuild();
      if (next) {
        state = readState();
        return true;
      }
    }
    return false;
  }
  // Sources changed and the build is broken: retry a real build once so a
  // fixed half-saved file lands quickly, otherwise keep serving.
  const next = await rebuild();
  if (next) {
    state = readState();
    return true;
  }
  return false;
}

const html = () => fs.readFileSync(previewHtmlPath, "utf8");

Bun.serve({
  port: Number(process.env.TENUN_DEV_PORT ?? 8898),
  async fetch(request) {
    const { pathname } = new URL(request.url);
    await refresh();
    const noCache = { "Cache-Control": "no-cache, no-store, must-revalidate" };
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(html(), { headers: { "Content-Type": "text/html; charset=utf-8", ...noCache } });
    }
    if (pathname === "/hash") return new Response(state.android, { headers: noCache });
    if (pathname === "/gallery_app.js") {
      return new Response(fs.readFileSync(path.join(repoRoot, "embedders/android/app/src/main/assets/gallery_app.js")), {
        headers: { "Content-Type": "text/javascript; charset=utf-8", ...noCache },
      });
    }
    if (pathname === "/preview-hash") return new Response(state.browser, { headers: noCache });
    if (pathname === "/gallery_preview_app.js") {
      return new Response(fs.readFileSync(path.join(repoRoot, "examples/gallery-preview/.out/gallery_preview_app.js")), {
        headers: { "Content-Type": "text/javascript; charset=utf-8", ...noCache },
      });
    }
    if (pathname === "/preview.js") {
      return new Response(fs.readFileSync(path.join(repoRoot, "examples/gallery-preview/.out/preview.js")), {
        headers: { "Content-Type": "text/javascript; charset=utf-8", ...noCache },
      });
    }
    return new Response("not found\n", { status: 404 });
  },
});
console.log(`listening on :${process.env.TENUN_DEV_PORT ?? 8898} — open http://127.0.0.1:${process.env.TENUN_DEV_PORT ?? 8898}/`);

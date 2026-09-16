#!/usr/bin/env bun
/**
 * Rebuild helper: one bundle build per process invocation.
 *
 * The dev server spawns this for every rebuild instead of building
 * in-process — long-lived bun build state in the server produced duplicate
 * declarations in the emitted bundle (same source, two link paths). A
 * fresh process per build is deterministic; rebuilds happen once per edit,
 * so the spawn cost is irrelevant.
 *
 * Writes all three artifacts:
 *   - embedders/android/app/src/main/assets/gallery_app.js   (phone asset)
 *   - examples/gallery-preview/.out/preview.js               (browser shell)
 *   - examples/gallery-preview/.out/gallery_preview_app.js   (browser app)
 * and a .last-build.json marker with both hashes + the source mtime.
 *
 *   refresh (default) -> rebuild everything, print "OK <android> <browser>"
 *   status            -> "OK <android> <browser>" if sources are fresh
 */
import fs from "node:fs";
import path from "node:path";
import { buildBundle, buildPreviewArtifacts, latestSourceMtime, repoRoot } from "./bundle-lib.ts";

const marker = path.join(repoRoot, "embedders/android/tools/gallery-bundle/.last-build.json");
const outDir = path.join(repoRoot, "examples/gallery-preview/.out");
const assetPath = path.join(repoRoot, "embedders/android/app/src/main/assets/gallery_app.js");

if (process.argv[2] === "status") {
  try {
    const saved = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (latestSourceMtime() <= saved.builtAtMtime) {
      console.log(`OK ${saved.android} ${saved.browser}`);
      process.exit(0);
    }
  } catch {
    // no marker: fall through to a full build
  }
}

const android = await buildBundle();
const preview = await buildPreviewArtifacts();

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(assetPath, android.code);
fs.writeFileSync(path.join(outDir, "gallery_preview_app.js"), preview.app.code);
fs.writeFileSync(path.join(outDir, "preview.js"), preview.shell.code);
// Both artifacts share one source snapshot; keep the later mtime so the
// server's skip-condition matches what was actually built.
const builtAtMtime = Math.max(android.builtAtMtime, preview.app.builtAtMtime);
fs.writeFileSync(
  marker,
  JSON.stringify({ android: android.hash, browser: preview.app.hash, builtAtMtime })
);
console.log(`OK ${android.hash} ${preview.app.hash}`);

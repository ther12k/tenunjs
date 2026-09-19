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
 *   - examples/flutter-showcase-preview/.out/preview.js      (showcase shell)
 *   - examples/flutter-showcase-preview/.out/showcase_preview_app.js (showcase app)
 * and a .last-build.json marker with all hashes + the source mtime.
 *
 *   refresh (default) -> rebuild everything, print "OK <android> <browser> <showcase>"
 *   status            -> "OK <android> <browser> <showcase>" if sources are fresh
 */
import fs from "node:fs";
import path from "node:path";
import { buildBundle, buildPreviewArtifacts, buildShowcasePreviewArtifacts, latestSourceMtime, repoRoot } from "./bundle-lib.ts";

const marker = path.join(repoRoot, "embedders/android/tools/gallery-bundle/.last-build.json");
const outDir = path.join(repoRoot, "examples/gallery-preview/.out");
const assetPath = path.join(repoRoot, "embedders/android/app/src/main/assets/gallery_app.js");

if (process.argv[2] === "status") {
  try {
    const saved = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (typeof saved.showcase === "string" && latestSourceMtime() <= saved.builtAtMtime) {
      console.log(`OK ${saved.android} ${saved.browser} ${saved.showcase}`);
      process.exit(0);
    }
  } catch {
    // no marker: fall through to a full build
  }
}

const android = await buildBundle();
const preview = await buildPreviewArtifacts();
const showcase = await buildShowcasePreviewArtifacts();

fs.mkdirSync(outDir, { recursive: true });
const showcaseOutDir = path.join(repoRoot, "examples/flutter-showcase-preview/.out");
fs.mkdirSync(showcaseOutDir, { recursive: true });
fs.writeFileSync(assetPath, android.code);
fs.writeFileSync(path.join(outDir, "gallery_preview_app.js"), preview.app.code);
fs.writeFileSync(path.join(outDir, "preview.js"), preview.shell.code);
fs.writeFileSync(path.join(showcaseOutDir, "showcase_preview_app.js"), showcase.app.code);
fs.writeFileSync(path.join(showcaseOutDir, "preview.js"), showcase.shell.code);
// All artifacts share one source snapshot; keep the later mtime so the
// server's skip-condition matches what was actually built.
const builtAtMtime = Math.max(android.builtAtMtime, preview.app.builtAtMtime, showcase.app.builtAtMtime);
fs.writeFileSync(
  marker,
  JSON.stringify({ android: android.hash, browser: preview.app.hash, showcase: showcase.app.hash, builtAtMtime })
);
console.log(`OK ${android.hash} ${preview.app.hash} ${showcase.app.hash}`);

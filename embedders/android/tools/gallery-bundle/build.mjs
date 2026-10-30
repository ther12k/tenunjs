#!/usr/bin/env bun
/**
 * Writes the gallery device bundle into the Android assets directory.
 *
 * Set TENUN_DEV_SERVER (e.g. "http://192.168.1.55:8898") to also emit the
 * dev_server.txt asset, which turns on hot reload in the installed app:
 * MainActivity polls that server and applies new bundles with state
 * restoration. Omit it for a plain offline APK.
 *
 * Usage: bun embedders/android/tools/gallery-bundle/build.mjs
 */

import path from "node:path";
import fs from "node:fs";
import { buildBundle, repoRoot } from "./bundle-lib";

const outPath = path.resolve(repoRoot, "embedders/android/app/src/main/assets/gallery_app.js");
// TN-178: the hot-reload marker lives in the DEBUG source set — release
// builds never package it, so a leftover marker cannot ship unsigned
// network reload into a release APK. MainActivity additionally refuses
// to honor it in non-debuggable builds (defense in depth).
const devServerPath = path.resolve(repoRoot, "embedders/android/app/src/debug/assets/dev_server.txt");
const staleMainPath = path.resolve(repoRoot, "embedders/android/app/src/main/assets/dev_server.txt");

const { code, hash } = await buildBundle();

fs.writeFileSync(outPath, code);
console.log(`gallery bundle: ${outPath} (${code.length} bytes, sha256:${hash})`);

const devServer = process.env.TENUN_DEV_SERVER?.trim();
if (devServer) {
  fs.mkdirSync(path.dirname(devServerPath), { recursive: true });
  fs.writeFileSync(devServerPath, `${devServer}\n`);
  // A marker from the pre-TN-178 location would still ship in release.
  if (fs.existsSync(staleMainPath)) fs.rmSync(staleMainPath);
  console.log(`dev hot reload: polling ${devServer} (debug-assets dev_server.txt written)`);
} else {
  for (const stale of [devServerPath, staleMainPath]) {
    if (fs.existsSync(stale)) fs.rmSync(stale);
  }
  console.log("dev hot reload: disabled (stale dev_server.txt copies removed)");
}

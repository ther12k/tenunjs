#!/usr/bin/env bun
/**
 * Writes the Tenun TV bundle into the tv flavor's assets directory
 * (TN-196 item 5). The tv APK boots into it (MainActivity prefers
 * tvplayer_app.js, which only tv builds package); touch builds never
 * see it.
 *
 * Usage: bun embedders/android/tools/gallery-bundle/build-tvplayer-apk-asset.mjs
 */

import path from "node:path";
import fs from "node:fs";
import { buildTvplayerBundle, repoRoot } from "./bundle-lib";

const outPath = path.resolve(repoRoot, "embedders/android/app/src/tv/assets/tvplayer_app.js");
const { code, hash } = await buildTvplayerBundle();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, code);
console.log(`tvplayer asset bundle written: ${outPath} (${code.length} bytes, sha256:${hash})`);

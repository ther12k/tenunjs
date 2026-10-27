#!/usr/bin/env bun
/**
 * Writes the native Polytron Wash bundle into the Android embedder assets directory.
 * When present, MainActivity boots into the native Polytron Wash companion app!
 *
 * Usage: bun embedders/android/tools/gallery-bundle/build-polytron-apk-asset.mjs
 */

import path from "node:path";
import fs from "node:fs";
import { buildPolytronBundle, repoRoot } from "./bundle-lib";

const outPath = path.resolve(repoRoot, "embedders/android/app/src/main/assets/polytron_app.js");
const { code, hash } = await buildPolytronBundle();

fs.writeFileSync(outPath, code);
console.log(`polytron asset bundle written: ${outPath} (${code.length} bytes, sha256:${hash})`);

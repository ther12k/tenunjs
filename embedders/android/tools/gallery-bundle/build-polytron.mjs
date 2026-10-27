#!/usr/bin/env bun
/**
 * Writes the TN-154 native Polytron bundle (TSX-compiled, host-handoff contract)
 * to the path given as the first argument — for the native QuickJS Android embedder.
 *
 * Usage: bun embedders/android/tools/gallery-bundle/build-polytron.mjs <out-path>
 */

import fs from "node:fs";
import { buildPolytronBundle } from "./bundle-lib";

const outPath = process.argv[2];
if (!outPath) {
  console.error("usage: bun build-polytron.mjs <out-path>");
  process.exit(1);
}

const { code, hash } = await buildPolytronBundle();
fs.writeFileSync(outPath, code);
console.log(`polytron bundle: ${outPath} (${code.length} bytes, sha256:${hash})`);

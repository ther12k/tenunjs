#!/usr/bin/env bun
/**
 * Writes the TN-144 counter bundle (TSX-compiled, host-handoff contract)
 * to the path given as the first argument — the artifact the
 * verify:android engine loop boots in real QuickJS. The bundle is a
 * CI-gate artifact, deliberately NOT an APK asset: swapping the packaged
 * app is a separate decision (the device acceptance UI drives the
 * notes app).
 *
 * Usage: bun embedders/android/tools/gallery-bundle/build-counter.mjs <out-path>
 */

import fs from "node:fs";
import { buildCounterBundle } from "./bundle-lib";

const outPath = process.argv[2];
if (!outPath) {
  console.error("usage: bun build-counter.mjs <out-path>");
  process.exit(1);
}

const { code, hash } = await buildCounterBundle();
fs.writeFileSync(outPath, code);
console.log(`counter bundle: ${outPath} (${code.length} bytes, sha256:${hash})`);

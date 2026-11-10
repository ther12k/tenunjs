#!/usr/bin/env bun
/**
 * Writes the NusaTV bundles into the flavor assets directories (TN-196
 * item 5): the 10-foot layout into the tv flavor, the 390-unit phone
 * layout (video hero + tappable rows) into the touch flavor. Both APKs
 * boot into tvplayer_app.js — MainActivity prefers it; each flavor's
 * source set carries its own form.
 *
 * Usage: bun embedders/android/tools/gallery-bundle/build-tvplayer-apk-asset.mjs
 */

import path from "node:path";
import fs from "node:fs";
import { buildTvplayerBundle, repoRoot } from "./bundle-lib";

const targets = [
  { form: "tv", dir: "tv" },
  { form: "phone", dir: "touch" },
];

for (const { form, dir } of targets) {
  const outPath = path.resolve(
    repoRoot,
    `embedders/android/app/src/${dir}/assets/tvplayer_app.js`
  );
  const { code, hash } = await buildTvplayerBundle(form);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code);
  console.log(
    `tvplayer asset bundle written: ${outPath} (${code.length} bytes, sha256:${hash})`
  );
}

#!/usr/bin/env node
/**
 * OTA publisher — signs a gallery release for the prototype update channel.
 *
 * Produces a directory (default examples/gallery-preview/.out/ota/):
 *   update-manifest.json  signed ENVELOPE over exact release-metadata bytes:
 *                         { payload: base64(metadata JSON), signature: base64(ECDSA-SHA256 over payload bytes) }
 *   update-bundle.js      the bundle bytes the metadata describes
 *   update_channel.json   the APK-side channel asset (manifestUrl, channel
 *                         name, public key) — bake into assets/ for an
 *                         OTA-enabled build
 *
 * Signed metadata fields (verified by the app BEFORE any download):
 *   schema, appId, channel, sequence (monotonic anti-replay),
 *   hostApiMin/hostApiMax (host compatibility), stateSchema (state-carry
 *   gate), bundleFormat, bundleSize, bundleSha256, bundleUrl.
 *
 * Never re-serialize the metadata after signing: the manifest's payload is
 * the exact byte string that was signed, and the app parses those same
 * verified bytes.
 *
 * Usage:
 *   node publish-update.mjs --init
 *   node publish-update.mjs --version 2 --base-url http://192.168.1.55:8898 \
 *        [--bundle path] [--key path] [--channel prototype]
 *
 * Key handling: the private key lives OUT of git (gitignored). Never run
 * `git add -A` in a tree that holds it — stage explicit paths. A production
 * pipeline keeps the key in CI secrets only.
 */

import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const defaultBundle = join(repoRoot, "embedders/android/app/src/main/assets/gallery_app.js");
const outDirDefault = join(repoRoot, "examples/gallery-preview/.out/ota");

const BUNDLE_FORMAT = "tenun-js-bundle-v1";
const APP_ID = "id.my.tenun.embedder";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function initKeys(keyPath) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(keyPath, privateKey.export({ type: "sec1", format: "pem" }));
  const publicB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  writeFileSync(`${keyPath}.pub.b64`, publicB64 + "\n");
  console.log(`private key: ${keyPath} (gitignored — never commit, never git add -A)`);
  console.log(`public key (b64 SPKI):\n${publicB64}`);
}

function main() {
  const keyPath = arg("key", join(here, "ota-private.pem"));
  if (process.argv.includes("--init")) {
    initKeys(keyPath);
    return;
  }
  if (!existsSync(keyPath)) {
    console.error(`private key not found: ${keyPath}\nrun: node ${process.argv[1]} --init --key ${keyPath}`);
    process.exit(1);
  }
  const version = Number(arg("version", "0"));
  if (!Number.isInteger(version) || version <= 0) {
    console.error("--version must be a positive integer (the release sequence)");
    process.exit(1);
  }
  const channelName = arg("channel", "prototype");
  const hostApi = Number(arg("host-api", "1"));
  const stateSchema = Number(arg("state-schema", "1"));
  const baseUrl = (arg("base-url", "") || "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(baseUrl)) {
    console.error("--base-url must be http(s)://host[:port]");
    process.exit(1);
  }
  const bundlePath = arg("bundle", defaultBundle);
  if (!existsSync(bundlePath)) {
    console.error(`bundle not found: ${bundlePath} (build it with rebuild.ts first)`);
    process.exit(1);
  }

  const bundle = readFileSync(bundlePath);
  const metadata = {
    schema: 1,
    appId: APP_ID,
    channel: channelName,
    sequence: version,
    hostApiMin: hostApi,
    hostApiMax: hostApi,
    stateSchema,
    bundleFormat: BUNDLE_FORMAT,
    bundleSize: bundle.length,
    bundleSha256: createHash("sha256").update(bundle).digest("hex"),
    bundleUrl: `${baseUrl}/update-bundle.js`,
  };

  // The payload bytes are EXACTLY what gets signed and served — the app
  // verifies the signature over these bytes, then parses them.
  const payload = Buffer.from(JSON.stringify(metadata), "utf8");
  const signer = createSign("SHA256");
  signer.update(payload);
  const signature = signer.sign(readFileSync(keyPath, "utf8"), "base64");
  const envelope = JSON.stringify(
    { payload: payload.toString("base64"), signature },
    null,
    2
  ) + "\n";

  const outDir = arg("out", outDirDefault);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "update-bundle.js"), bundle);
  writeFileSync(join(outDir, "update-manifest.json"), envelope);

  const publicB64 = existsSync(`${keyPath}.pub.b64`)
    ? readFileSync(`${keyPath}.pub.b64`, "utf8").trim()
    : publicKeyB64Of(keyPath);
  writeFileSync(
    join(outDir, "update_channel.json"),
    JSON.stringify(
      { manifestUrl: `${baseUrl}/update-manifest.json`, channel: channelName, publicKeyB64: publicB64 },
      null,
      2
    ) + "\n"
  );

  console.log(`OTA release v${version} published to ${outDir}`);
  console.log(`  appId ${APP_ID} channel ${channelName} hostApi ${hostApi} stateSchema ${stateSchema}`);
  console.log(`  bundle sha256: ${metadata.bundleSha256} (${bundle.length} bytes)`);
  console.log(`  bake update_channel.json into app assets, then serve this directory`);
}

function publicKeyB64Of(keyPath) {
  try {
    return readFileSync(`${keyPath}.pub.b64`, "utf8").trim();
  } catch {
    console.error("public key sidecar missing; re-run --init");
    process.exit(1);
  }
}

main();

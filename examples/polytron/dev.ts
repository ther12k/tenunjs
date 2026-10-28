#!/usr/bin/env bun
/**
 * Polytron Wash app dev server: build the preview bundle and serve the
 * shell. No backend proxy — the app talks BLE GATT directly to the
 * washer, so the page is fully functional offline (that's the point).
 *
 * Web Bluetooth needs a SECURE CONTEXT. http://localhost works as-is;
 * for a phone on the LAN serve over TLS — drop dev-cert.pem/dev-key.pem
 * next to this file and the server switches to https automatically:
 *
 *   openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
 *     -keyout dev-key.pem -out dev-cert.pem -subj "/CN=polytron.local"
 *
 * Run from the repo root:  bun examples/polytron/dev.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.POLYTRON_DEV_PORT ?? 8174);

let lastBundle: string | null = null;

async function build(): Promise<string | null> {
  const out = await Bun.build({
    entrypoints: [path.join(here, "preview.ts")],
    target: "browser",
    format: "esm",
    jsx: { runtime: "automatic", importSource: "@tenunjs/jsx-runtime" },
    minify: false,
  });
  if (!out.success) {
    for (const log of out.logs) console.error(log);
    return null;
  }
  lastBundle = await new Response(out.outputs[0]).text(); // BuildArtifact is a Blob
  return lastBundle;
}

/**
 * Native-app hot update (APK 0.1.5+): the embedder polls /hash every 2.5 s
 * while on this Wi-Fi and fetches /polytron_app.js on change — app content
 * updates WITHOUT reinstalling the APK (native/Kotlin changes still need a
 * new APK). Rebuilds the native asset from source, throttled so the poll
 * cadence costs nothing when nothing changed.
 */
const repoRoot = path.resolve(here, "..", "..");
const nativeAssetPath = path.join(repoRoot, "embeddings-placeholder").replace(
  "embeddings-placeholder",
  path.join("embedders", "android", "app", "src", "main", "assets", "polytron_app.js"),
);
let lastAssetBuild = 0;
let lastAssetHash: string | null = null;

async function refreshNativeAsset(): Promise<{ bytes: Buffer; hash: string } | null> {
  const now = Date.now();
  if (now - lastAssetBuild > 3000) {
    lastAssetBuild = now;
    const proc = Bun.spawnSync([process.execPath, path.join(repoRoot, "embedders", "android", "tools", "gallery-bundle", "build-polytron-apk-asset.mjs")], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      console.error("polytron asset build failed:", new TextDecoder().decode(proc.stderr).slice(0, 400));
      // fall through: serve the last good asset if one exists
    }
  }
  if (!fs.existsSync(nativeAssetPath)) return null;
  const bytes = fs.readFileSync(nativeAssetPath);
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  lastAssetHash = hash;
  return { bytes, hash };
}

await build(); // fail-soft: serve the shell with an error status if the build broke

const certFile = path.join(here, "dev-cert.pem");
const keyFile = path.join(here, "dev-key.pem");
const tls = fs.existsSync(certFile) && fs.existsSync(keyFile)
  ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
  : undefined;

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  ...(tls ? { tls } : {}),
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/" || pathname === "/index.html") {
      const html = fs.readFileSync(path.join(here, "index.html"), "utf8");
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (pathname === "/preview.js") {
      const js = (await build()) ?? lastBundle;
      if (js == null) return new Response("// build failed — see server console\n", { status: 500 });
      return new Response(js, { headers: { "Content-Type": "text/javascript" } });
    }
    if (pathname === "/apk" || pathname === "/polytron-wash.apk") {
      const apkPath = path.join(here, "polytron-wash.apk");
      if (!fs.existsSync(apkPath)) return new Response("APK not built yet\n", { status: 404 });
      const bytes = fs.readFileSync(apkPath);
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Disposition": 'attachment; filename="polytron-wash.apk"',
          "Content-Length": String(bytes.length),
        },
      });
    }
    if (pathname === "/hash") {
      const asset = await refreshNativeAsset();
      if (asset == null) return new Response("no polytron asset\n", { status: 404 });
      return new Response(asset.hash + "\n", { headers: { "Content-Type": "text/plain" } });
    }
    if (pathname === "/polytron_app.js") {
      const asset = await refreshNativeAsset();
      if (asset == null) return new Response("no polytron asset\n", { status: 404 });
      return new Response(asset.bytes, {
        headers: { "Content-Type": "application/javascript", "Content-Length": String(asset.bytes.length) },
      });
    }
    return new Response("not found\n", { status: 404 });
  },
});

const scheme = tls ? "https" : "http";
console.log(`Polytron Wash app:  ${scheme}://localhost:${PORT}`);
console.log(`on the LAN:         ${scheme}://<this-host>:${PORT}`);
if (!tls) {
  console.log("phone on the LAN needs TLS for Web Bluetooth — see the header comment in dev.ts");
}

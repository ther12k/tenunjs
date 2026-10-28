import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8184);
const HOST = process.env.HOST || "127.0.0.1";

const distDir = path.resolve(__dirname, "dist");
const bundlePath = path.join(distDir, "polytron_app.js");
const apkPath = path.join(distDir, "polytron-wash.apk");
const indexPath = path.join(distDir, "index.html");

let cachedHash = "";
function getBundleHash() {
  if (!fs.existsSync(bundlePath)) return null;
  const content = fs.readFileSync(bundlePath);
  cachedHash = crypto.createHash("sha256").update(content).digest("hex");
  return cachedHash;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // CORS headers for all
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", time: Date.now() }));
    return;
  }

  if (pathname === "/hash") {
    const hash = getBundleHash();
    if (!hash) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("no bundle\n");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(hash + "\n");
    return;
  }

  if (pathname === "/polytron_app.js") {
    if (!fs.existsSync(bundlePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("no bundle\n");
      return;
    }
    const stat = fs.statSync(bundlePath);
    res.writeHead(200, {
      "Content-Type": "application/javascript",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    fs.createReadStream(bundlePath).pipe(res);
    return;
  }

  if (pathname.startsWith("/assets/") || pathname.startsWith("/img/")) {
    const safeRel = pathname.replace(/^\/(assets|img)\//, "");
    let targetFile = path.join(distDir, "assets", safeRel);
    if (!fs.existsSync(targetFile)) {
      targetFile = path.join(distDir, "assets", "img", safeRel);
    }
    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
      const ext = path.extname(targetFile).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".svg" ? "image/svg+xml" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      });
      fs.createReadStream(targetFile).pipe(res);
      return;
    }
  }

  if (pathname === "/polytron-wash.apk" || pathname === "/apk") {
    if (!fs.existsSync(apkPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("APK not available\n");
      return;
    }
    const stat = fs.statSync(apkPath);
    res.writeHead(200, {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="polytron-wash.apk"',
      "Content-Length": stat.size,
    });
    fs.createReadStream(apkPath).pipe(res);
    return;
  }

  if (pathname === "/preview") {
    const prevPath = path.join(distDir, "preview.html");
    if (fs.existsSync(prevPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(prevPath).pipe(res);
      return;
    }
  }

  if (pathname === "/" || pathname === "/index.html") {
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><title>Polytron Wash</title></head><body><h1>Polytron Wash Server</h1><p><a href="/polytron-wash.apk">Download APK</a></p></body></html>`);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found\n");
});

server.listen(PORT, HOST, () => {
  console.log(`Polytron Wash server listening on http://${HOST}:${PORT}`);
});

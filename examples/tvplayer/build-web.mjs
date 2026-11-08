/**
 * Builds the deployable NusaTV web app (TN-196): a fully CLIENT-SIDE
 * static site — the same runtime + hls.js media host the browser
 * preview runs, as `dist/index.html` + `dist/preview.js`. No backend:
 * streams come straight from the broadcasters' CDNs (all CORS *), so
 * `dist/` drops onto any static server (nginx, GitHub Pages, a VPS).
 *
 *   bun examples/tvplayer/build-web.mjs          # writes dist/
 *   bun examples/tvplayer/build-web.mjs --serve  # + serve on :8186
 *
 * ?form=phone gives the touch layout; the TV layout drives with the
 * arrow keys (works in TV browsers too — no app install anywhere).
 */
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { serve: { type: "boolean", default: false } } });

const result = await Bun.build({
  entrypoints: [join(here, "preview.ts")],
  target: "browser",
  format: "esm",
  minify: true,
});
if (!result.success) {
  console.error(result.logs.map(String).join("\n"));
  process.exit(1);
}
const js = await result.outputs[0].text();

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0B0B0F">
<title>NusaTV — live</title>
<style>
  body { margin: 0; background: #0B0B0F; color: #8A8D98;
         font: 14px/1.4 system-ui, sans-serif; }
  #wrap { display: flex; flex-direction: column; align-items: center;
          gap: 8px; padding: 16px; min-height: 100vh;
          justify-content: center; }
  canvas { background: #0B0B0F; max-width: 100%; height: auto;
           border: 1px solid #232330; }
  a { color: #8FB8F5; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="preview"></canvas>
  <div id="routes"></div>
  <div id="status"></div>
</div>
<script type="module" src="./preview.js"></script>
</body>
</html>`;

const dist = join(here, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "index.html"), html);
writeFileSync(join(dist, "preview.js"), js);
console.log(
  `NusaTV web build → dist/ (index.html ${(html.length / 1024).toFixed(1)} KiB, ` +
    `preview.js ${(js.length / 1024).toFixed(1)} KiB) — deploy the folder to any static server; ` +
    "open ?form=phone on a phone."
);

if (values.serve) {
  Bun.serve({
    port: 8186,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const file =
        path === "/preview.js"
          ? Bun.file(join(dist, "preview.js"))
          : Bun.file(join(dist, "index.html"));
      return new Response(file, {
        headers: {
          "content-type": path === "/preview.js" ? "text/javascript" : "text/html",
        },
      });
    },
  });
  console.log("serving dist/ on http://localhost:8186/");
}

/**
 * Tenun TV preview dev server (TN-196): serves the browser preview at
 * http://localhost:8185/. Minimal on purpose — no hot reload, no APK
 * asset channel (the tv flavor's bundle comes from
 * build-tvplayer-apk-asset.mjs); rebuild + refresh to see changes.
 */
const PORT = Number(process.env.TVPLAYER_DEV_PORT ?? 8185);

const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Tenun TV — preview</title>
<style>
  body { margin: 0; background: #101014; color: #8E8E99;
         font: 14px/1.4 system-ui, sans-serif; }
  #wrap { display: flex; flex-direction: column; align-items: center;
          gap: 8px; padding: 16px; }
  canvas { background: #101014; max-width: 100%; height: auto;
           border: 1px solid #2A2A35; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="preview" width="960" height="540"></canvas>
  <div id="routes"></div>
  <div id="status"></div>
</div>
<script type="module" src="/preview.js"></script>
</body>
</html>`;

const result = await Bun.build({
  entrypoints: [new URL("./preview.ts", import.meta.url).pathname],
  target: "browser",
  format: "esm",
  jsx: { runtime: "automatic", importSource: "@tenunjs/jsx-runtime" },
});
if (!result.success) {
  console.error(result.logs.map(String).join("\n"));
  process.exit(1);
}
const previewJs = await result.outputs[0]!.text();

Bun.serve({
  port: PORT,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/preview.js") {
      return new Response(previewJs, { headers: { "content-type": "text/javascript" } });
    }
    return new Response(HTML, { headers: { "content-type": "text/html" } });
  },
});
console.log(`Tenun TV preview: http://localhost:${PORT}/`);

/**
 * Shared bundle logic for the gallery device app: compiles the real
 * gallery screens + display-list renderer into a single plain script that
 * QuickJS can evaluate with JS_Eval(GLOBAL).
 */

import { build } from "bun";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../../..");
const entry = path.join(here, "device-entry.ts");
const previewEntry = path.join(repoRoot, "examples/gallery-preview/app-entry.ts");
const previewShellEntry = path.join(repoRoot, "examples/gallery-preview/preview.ts");

/** Source trees whose changes should trigger a dev-server rebuild. */
export const watchedDirs = [
  path.join(here),
  path.join(repoRoot, "examples/gallery/src"),
  path.join(repoRoot, "examples/ui-kit/src"),
  path.join(repoRoot, "packages/jsx-runtime/src"),
  path.join(repoRoot, "packages/widgets/src"),
  path.join(repoRoot, "packages/core/src"),
  path.join(repoRoot, "packages/protocol/src"),
  path.join(repoRoot, "packages/navigation/src"),
];

function latestMtime(dir, best = 0) {
  let result = best;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const item of entries) {
    if (item.name === "node_modules" || item.name === ".out") continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      result = Math.max(result, latestMtime(full, result));
    } else {
      result = Math.max(result, fs.statSync(full).mtimeMs);
    }
  }
  return result;
}

export function latestSourceMtime(): number {
  return watchedDirs.reduce((max, dir) => Math.max(max, latestMtime(dir)), 0);
}

export interface BundleArtifact {
  code: string;
  hash: string;
  builtAtMtime: number;
}

export interface PreviewArtifacts {
  app: BundleArtifact;
  shell: BundleArtifact;
}

/**
 * Builds the bundle and smoke-runs it in script mode (what QuickJS
 * JS_Eval(GLOBAL) does): it must self-initialize, install
 * __tenun_dispatch_action, and commit a display-list scene.
 */
export async function buildBundle(): Promise<BundleArtifact> {
  const result = await build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: false,
    external: [],
  });

  if (!result.success) {
    const logs = result.logs.map(String).join("\n");
    throw new Error(`gallery bundle build failed:\n${logs}`);
  }

  let code = await result.outputs[0].text();

  // Defensive wrap: if the emitter left module syntax, isolate it in an
  // IIFE so JS_Eval(GLOBAL) never sees it. (Export statements are illegal
  // even inside a function body, so none may remain — the smoke run
  // catches that.)
  if (/^\s*(import|export)\s/m.test(code)) {
    code = `(function(){\n${code}\n})();`;
  }

  smokeRun(code);

  return {
    code,
    hash: crypto.createHash("sha256").update(code).digest("hex").slice(0, 16),
    builtAtMtime: latestSourceMtime(),
  };
}

async function buildEntry(entrypoint: string, format: "esm" | "iife"): Promise<string> {
  const result = await build({
    entrypoints: [entrypoint],
    target: "browser",
    format,
    minify: false,
    external: [],
  });
  if (!result.success) {
    throw new Error(`browser bundle build failed:\n${result.logs.map(String).join("\\n")}`);
  }
  return result.outputs[0].text();
}

export async function buildPreviewArtifacts(): Promise<PreviewArtifacts> {
  const app = await buildEntry(previewEntry, "esm");
  const shell = await buildEntry(previewShellEntry, "esm");
  return {
    app: {
      code: app,
      hash: crypto.createHash("sha256").update(app).digest("hex").slice(0, 16),
      builtAtMtime: latestSourceMtime(),
    },
    shell: {
      code: shell,
      hash: crypto.createHash("sha256").update(shell).digest("hex").slice(0, 16),
      builtAtMtime: latestSourceMtime(),
    },
  };
}

function smokeRun(code: string): void {
  const committed: string[] = [];
  globalThis.tenun_commit = (json) => committed.push(json);
  delete globalThis.__tenun_last_scene;
  delete globalThis.__tenun_dispatch_action;
  try {
    vm.runInThisContext(code, { filename: "gallery_app.js" });
    const raw = committed.at(-1) ?? globalThis.__tenun_last_scene ?? "null";
    const scene = JSON.parse(raw);
    if (!scene || scene.tenun !== "display-list") {
      throw new Error("smoke run failed: bundle did not commit a display-list scene");
    }
    if (typeof globalThis.__tenun_dispatch_action !== "function") {
      throw new Error("smoke run failed: __tenun_dispatch_action not installed");
    }
  } finally {
    delete globalThis.tenun_commit;
    delete globalThis.__tenun_dispatch_action;
    delete globalThis.__tenun_last_scene;
  }
}

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
const counterEntry = path.join(here, "counter-entry.ts");
const previewEntry = path.join(repoRoot, "examples/gallery-preview/app-entry.ts");
const previewShellEntry = path.join(repoRoot, "examples/gallery-preview/preview.ts");
const showcasePreviewEntry = path.join(repoRoot, "examples/flutter-showcase-preview/app-entry.ts");
const showcasePreviewShellEntry = path.join(repoRoot, "examples/flutter-showcase-preview/preview.ts");

/** Source trees whose changes should trigger a dev-server rebuild. */
export const watchedDirs = [
  path.join(here),
  path.join(repoRoot, "examples/gallery/src"),
  path.join(repoRoot, "examples/flutter-showcase/src"),
  path.join(repoRoot, "examples/flutter-showcase-preview"),
  path.join(repoRoot, "examples/ui-kit/src"),
  path.join(repoRoot, "packages/jsx-runtime/src"),
  path.join(repoRoot, "packages/widgets/src"),
  path.join(repoRoot, "packages/core/src"),
  path.join(repoRoot, "packages/protocol/src"),
  path.join(repoRoot, "packages/navigation/src"),
];

function latestMtime(dir: string, best = 0): number {
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

export interface ShowcasePreviewArtifacts {
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

  smokeRun(code, "gallery_app.js");

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

function artifact(code: string): BundleArtifact {
  return {
    code,
    hash: crypto.createHash("sha256").update(code).digest("hex").slice(0, 16),
    builtAtMtime: latestSourceMtime(),
  };
}

export async function buildPreviewArtifacts(): Promise<PreviewArtifacts> {
  const app = await buildEntry(previewEntry, "esm");
  const shell = await buildEntry(previewShellEntry, "esm");
  return { app: artifact(app), shell: artifact(shell) };
}

export async function buildShowcasePreviewArtifacts(): Promise<ShowcasePreviewArtifacts> {
  const app = await buildEntry(showcasePreviewEntry, "esm");
  const shell = await buildEntry(showcasePreviewShellEntry, "esm");
  return { app: artifact(app), shell: artifact(shell) };
}

function smokeRun(code: string, filename: string, expected: string[] = []): void {
  const committed: string[] = [];
  const host = globalThis as Record<string, unknown>;
  host.tenun_commit = (json: string) => committed.push(json);
  delete host.__tenun_last_scene;
  delete host.__tenun_dispatch_action;
  try {
    vm.runInThisContext(code, { filename });
    const raw = committed.at(-1) ?? (host.__tenun_last_scene as string | undefined) ?? "null";
    const scene = JSON.parse(raw);
    if (!scene || scene.tenun !== "display-list") {
      throw new Error("smoke run failed: bundle did not commit a display-list scene");
    }
    if (typeof host.__tenun_dispatch_action !== "function") {
      throw new Error("smoke run failed: __tenun_dispatch_action not installed");
    }
    for (const needle of expected) {
      if (!raw.includes(needle)) {
        throw new Error(`smoke run failed: committed scene lacks ${JSON.stringify(needle)}`);
      }
    }
  } finally {
    delete host.tenun_commit;
    delete host.__tenun_dispatch_action;
    delete host.__tenun_last_scene;
  }
}

/**
 * Builds the TN-144 counter bundle: the real counter sample composition
 * (defineScreen TSX + theme) through the public host-handoff contract,
 * as script input to the QuickJS engine loop. Smoke-runs headlessly the
 * same way the gallery bundle does; the committed scene must carry the
 * counter's own chrome so a mis-wired entry (wrong screen, missing
 * theme) fails the build, not the gate.
 */
export async function buildCounterBundle(): Promise<BundleArtifact> {
  const result = await build({
    entrypoints: [counterEntry],
    target: "browser",
    format: "esm",
    minify: false,
    external: [],
  });
  if (!result.success) {
    throw new Error(`counter bundle build failed:\n${result.logs.map(String).join("\n")}`);
  }
  let code = await result.outputs[0].text();
  if (/^\s*(import|export)\s/m.test(code)) {
    code = `(function(){\n${code}\n})();`;
  }
  smokeRun(code, "counter_app.js", ['"text":"Counter"', '"text":"0"']);
  return {
    code,
    hash: crypto.createHash("sha256").update(code).digest("hex").slice(0, 16),
    builtAtMtime: latestSourceMtime(),
  };
}

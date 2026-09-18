#!/usr/bin/env bun
/**
 * Desktop launcher: runs a TenunJS preview in a standalone Chrome app
 * window — a chromeless desktop shell around the exact browser preview
 * the dev server already serves (same display-list renderer, same
 * runtime, same hot reload). Uses an installed Chrome/Chromium in
 * --app mode, so it adds no dependencies.
 *
 *   bun embedders/android/tools/gallery-bundle/desktop.ts showcase
 *   bun embedders/android/tools/gallery-bundle/desktop.ts gallery
 *
 * Starts the dev server if it is not already running; both the server
 * and the window keep running after this script exits. Close the window
 * to dismiss the app; stop the server with:
 *   pkill -f gallery-bundle/dev-server.ts
 */
import { repoRoot } from "./bundle-lib.ts";

const TARGETS = {
  showcase: { path: "/showcase/", title: "Flutter Showcase by TenunJS" },
  gallery: { path: "/", title: "TenunJS Gallery Preview" },
} as const;

type TargetName = keyof typeof TARGETS;

const requested = (Bun.argv[2] ?? "showcase") as TargetName;
const target = TARGETS[requested];
if (!target) {
  console.error(`Unknown target "${Bun.argv[2]}". Use one of: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

const port = Number(process.env.TENUN_DEV_PORT ?? 8898);
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}${target.path}`;

async function serverUp(): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

if (!(await serverUp())) {
  console.log("dev server not running — starting it…");
  Bun.spawn([process.execPath, `${repoRoot}/embedders/android/tools/gallery-bundle/dev-server.ts`], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).unref();
  const deadline = Date.now() + 15_000;
  while (!(await serverUp())) {
    if (Date.now() > deadline) {
      console.error(`dev server did not come up at ${origin} within 15s`);
      process.exit(1);
    }
    await Bun.sleep(300);
  }
}

const browser = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
  .map((name) => Bun.which(name))
  .find((path) => path !== null);
if (!browser) {
  console.error("No Chrome/Chromium found on PATH (looked for google-chrome, chromium, chromium-browser).");
  console.error(`The preview is still available in any browser at ${url}`);
  process.exit(1);
}

// A dedicated profile keeps the app window separate from the user's
// normal browsing session and makes relaunches deterministic.
const profileDir = `/tmp/tenun-desktop-${requested}-profile`;
const window = Bun.spawn(
  [
    browser,
    `--app=${url}`,
    "--window-size=1200,860",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
  { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
);
window.unref();

console.log(`${target.title} → desktop window (${browser}, app mode)`);
console.log(`  ${url}`);
console.log("  Close the window to dismiss; stop the server with: pkill -f gallery-bundle/dev-server.ts");

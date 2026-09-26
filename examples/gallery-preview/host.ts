/**
 * Generic application host shell — TN-133 browser leg of the host-handoff
 * contract (the TN-042 connection point for external applications).
 *
 * This module has NO application knowledge: it does not import the
 * gallery, any screen, or any example runtime. It speaks exactly the
 * protocol the Android bridge consumes:
 *
 *   1. install window.tenun_commit(sceneJson) BEFORE the application
 *      loads (the JNI binding exists before bundle eval there);
 *   2. dynamic-import the bundle named by ?bundle=<same-origin url>;
 *   3. the bundle installs __tenun_dispatch_action(action, payloadJson)
 *      and commits its initial scene through tenun_commit;
 *   4. paint committed display-list scenes with the shared renderer and
 *      dispatch tap hits back through __tenun_dispatch_action.
 *
 * Scene-contract violations are fail-visible (same posture as the Android
 * host's SceneContractException panel): the offending scene is not painted.
 */
import { CanvasPreviewRenderer, sceneContractError } from "./renderer";
import type { DisplayListScene } from "../ui-kit/src/display-list";

const canvas = document.querySelector<HTMLCanvasElement>("#preview");
const statusEl = document.querySelector<HTMLElement>("#status");
const routeEl = document.querySelector<HTMLElement>("#route-label");
const bundleEl = document.querySelector<HTMLElement>("#bundle-label");
if (!canvas || !statusEl || !routeEl || !bundleEl) throw new Error("host shell is incomplete");

const renderer = new CanvasPreviewRenderer(canvas);
let scrollY = 0;
let scene: DisplayListScene | null = null;

function fail(message: string): void {
  statusEl.className = "status error";
  statusEl.textContent = message;
}

function setStatus(text: string): void {
  statusEl.className = "status";
  statusEl.textContent = text;
}

function paint(): void {
  if (!scene) return;
  scrollY = Math.min(scrollY, renderer.maxScroll(scene));
  renderer.render(scene, scrollY);
}

/** The host-owned commit sink: the browser twin of the JNI tenun_commit. */
(window as unknown as Record<string, unknown>)["tenun_commit"] = (json: string) => {
  let candidate: DisplayListScene;
  try {
    candidate = JSON.parse(json) as DisplayListScene;
  } catch {
    fail("host: application committed a scene that is not JSON");
    return;
  }
  const violation = sceneContractError(candidate);
  if (violation) {
    fail(`host: scene rejected (${violation}) — application bundle incompatible`);
    return;
  }
  scene = candidate;
  setStatus(`scene committed (${candidate.ops.length} ops)`);
  paint();
};

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointerY = event.clientY;
  dragging = false;
});
canvas.addEventListener("pointermove", (event) => {
  if (!canvas.hasPointerCapture(event.pointerId) || !scene) return;
  const delta = pointerY - event.clientY;
  if (Math.abs(delta) > 1) dragging = true;
  pointerY = event.clientY;
  scrollY = Math.max(
    0,
    Math.min(renderer.maxScroll(scene), scrollY + delta / (canvas.clientWidth / scene.designWidth)),
  );
  paint();
});
canvas.addEventListener("pointerup", (event) => {
  if (!dragging && scene) {
    const index = renderer.hitTest(scene, event.clientX, event.clientY, scrollY);
    if (index !== null) {
      dispatch("tap", JSON.stringify({ id: scene.taps[index]!.payload.id }));
    }
  }
  canvas.releasePointerCapture(event.pointerId);
});
window.addEventListener("resize", () => paint());

let pointerY = 0;
let dragging = false;

function dispatch(action: string, payloadJson: string): string {
  const fn = (window as unknown as Record<string, unknown>)["__tenun_dispatch_action"];
  if (typeof fn !== "function") {
    fail("host: bundle did not install __tenun_dispatch_action");
    return "";
  }
  try {
    const result = (fn as (a: string, p: string) => string)(action, payloadJson);
    const route = JSON.parse(result) as { route?: string };
    routeEl.textContent = route.route ?? "?";
    return result;
  } catch (error) {
    fail(`host: dispatch "${action}" failed: ${(error as Error).message}`);
    return "";
  }
}

// Dev/test hooks, mirroring the device surface: drive the protocol and
// read the last committed scene without pointer math.
(window as unknown as Record<string, unknown>)["__tenun_host_test"] = {
  dispatch,
  lastScene: () => JSON.stringify(scene),
  tapRegions: () => (scene ? scene.taps.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, id: t.payload.id })) : []),
  scroll: (y: number) => {
    if (!scene) return;
    scrollY = Math.max(0, Math.min(renderer.maxScroll(scene), y));
    paint();
  },
};

const url = new URL(window.location.href);
const bundleUrl = url.searchParams.get("bundle");
if (!bundleUrl) {
  fail("host: open with ?bundle=<url> pointing at an application bundle");
} else {
  bundleEl.textContent = bundleUrl.split("/").pop() ?? bundleUrl;
  try {
    // Same-origin application bundles only — this is a local dev host,
    // not a distribution surface.
    await import(bundleUrl);
    setStatus((statusEl.textContent ?? "") + " · bundle loaded");
  } catch (error) {
    fail(`host: bundle failed to load or boot: ${(error as Error).message}`);
  }
}

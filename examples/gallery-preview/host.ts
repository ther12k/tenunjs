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

/** Boot-completion note; must never clear a contract failure already shown. */
function noteLoaded(): void {
  if (statusEl.classList.contains("error")) return;
  setStatus(`${statusEl.textContent ?? ""} · bundle loaded`);
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

// TN-152 gesture parity with the Android host: a hold past the timeout
// dispatches the "long-press" region under the DOWN point; movement past
// slop, release, or cancel ends the wait; a fired hold suppresses that
// press's tap (the host rule the scene contract documents).
const LONG_PRESS_TIMEOUT_MS = 500;
const HOLD_SLOP_PX = 8;
let pointerY = 0;
let dragging = false;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let holdFired = false;
let downX = 0;
let downY = 0;

function cancelHoldTimer(): void {
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointerY = event.clientY;
  dragging = false;
  holdFired = false;
  downX = event.clientX;
  downY = event.clientY;
  cancelHoldTimer();
  holdTimer = setTimeout(() => {
    holdTimer = null;
    if (!scene || dragging) return;
    const index = renderer.hitTest(scene, downX, downY, scrollY, "long-press");
    if (index !== null) {
      holdFired = true;
      dispatch("long-press", JSON.stringify({ id: scene.taps[index]!.payload.id }));
    }
  }, LONG_PRESS_TIMEOUT_MS);
});
canvas.addEventListener("pointermove", (event) => {
  if (!canvas.hasPointerCapture(event.pointerId) || !scene) return;
  const delta = pointerY - event.clientY;
  if (Math.abs(delta) > 1) dragging = true;
  if (
    holdTimer !== null &&
    (Math.abs(event.clientX - downX) > HOLD_SLOP_PX || Math.abs(event.clientY - downY) > HOLD_SLOP_PX)
  ) {
    cancelHoldTimer();
  }
  pointerY = event.clientY;
  scrollY = Math.max(
    0,
    Math.min(renderer.maxScroll(scene), scrollY + delta / (canvas.clientWidth / scene.designWidth)),
  );
  paint();
});
canvas.addEventListener("pointerup", (event) => {
  cancelHoldTimer();
  if (!dragging && !holdFired && scene) {
    const index = renderer.hitTest(scene, event.clientX, event.clientY, scrollY, "tap");
    if (index !== null) {
      dispatch("tap", JSON.stringify({ id: scene.taps[index]!.payload.id }));
    }
  }
  holdFired = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener("pointercancel", () => {
  cancelHoldTimer();
  holdFired = false;
});

// TN-158 host viewport delivery: bundles that adopt host bounds receive the
// canvas's logical size (CSS pixels — the renderer's own unit once the
// scene's designWidth equals the delivered width) on boot and on resize.
// Negotiation: a bundle without viewport support answers VIEWPORT with
// UNKNOWN_ACTION. That is a capability statement, not a failure — the host
// records it once and keeps scaling the committed scene like before.
let viewportNegotiated = false;
let viewportSupported = false;

function deliverViewport(): boolean {
  const fn = (window as unknown as Record<string, unknown>)["__tenun_dispatch_action"];
  if (typeof fn !== "function") return false;
  const payload = JSON.stringify({ width: canvas.clientWidth, height: canvas.clientHeight });
  try {
    (fn as (a: string, p: string) => string)("VIEWPORT", payload);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "UNKNOWN_ACTION") {
      viewportNegotiated = true;
      viewportSupported = false;
      return false;
    }
    fail(`host: viewport delivery failed: ${(error as Error).message}`);
    return false;
  }
  viewportNegotiated = true;
  viewportSupported = true;
  return true;
}

/** Probe once after boot: supported bundles adopt the canvas size immediately;
 *  unsupported bundles answer once with UNKNOWN_ACTION and are never asked
 *  again. Later resizes only reach bundles that adopted host bounds. */
function negotiateViewport(): void {
  if (viewportNegotiated) return;
  if (!deliverViewport()) return;
  scrollY = 0; // the adopted bounds produce a fresh layout
}

window.addEventListener("resize", () => {
  if (viewportSupported) deliverViewport();
  paint();
});

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
    // A successful import says nothing about the SCENE the bundle
    // committed: tenun_commit may already have rejected it fail-visibly,
    // and that diagnostic must survive boot completion.
    noteLoaded();
    negotiateViewport();
  } catch (error) {
    fail(`host: bundle failed to load or boot: ${(error as Error).message}`);
  }
}

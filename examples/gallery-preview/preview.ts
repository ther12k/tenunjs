import { GalleryRuntime } from "./runtime";
import { CanvasPreviewRenderer } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#preview");
const routes = document.querySelector<HTMLElement>("#routes");
const routeLabel = document.querySelector<HTMLElement>("#route-label");
const status = document.querySelector<HTMLElement>("#status");
const reloadLabel = document.querySelector<HTMLElement>("#reload-label");
if (!canvas || !routes || !routeLabel || !status || !reloadLabel) throw new Error("preview shell is incomplete");
const previewCanvas = canvas;
const routeNav = routes;
const routeTitle = routeLabel;
const statusText = status;
const reloadText = reloadLabel;

let runtime = new GalleryRuntime();
const renderer = new CanvasPreviewRenderer(previewCanvas);
let scrollY = 0;
let pointerY = 0;
let dragging = false;
let lastHash: string | null = null;

function paint(): void {
  const result = runtime.render();
  scrollY = Math.min(scrollY, renderer.maxScroll(result.scene));
  renderer.render(result.scene, scrollY);
  routeTitle.textContent = runtime.route();
  for (const button of routeNav.querySelectorAll<HTMLButtonElement>("button")) {
    button.classList.toggle("active", button.dataset.route === runtime.route());
  }
}

function makeRouteButtons(): void {
  routeNav.replaceChildren();
  for (const route of runtime.routes()) {
    const button = document.createElement("button");
    button.className = "route";
    button.dataset.route = route;
    button.textContent = route === "smartHome" ? "Smart home" : route[0]!.toUpperCase() + route.slice(1);
    button.addEventListener("click", () => {
      runtime.navigate(route);
      scrollY = 0;
      paint();
    });
    routeNav.append(button);
  }
}

// TN-152 gesture parity: filtered hit tests (a short click resolves
// "tap" regions only), a hold timer for "long-press", and dispatch by
// the region's PAYLOAD ID — never the array index, which diverges from
// the id on non-home routes where the back-bar region is prepended.
const LONG_PRESS_TIMEOUT_MS = 500;
const HOLD_SLOP_PX = 8;
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

previewCanvas.addEventListener("pointerdown", (event) => {
  previewCanvas.setPointerCapture(event.pointerId);
  pointerY = event.clientY;
  dragging = false;
  holdFired = false;
  downX = event.clientX;
  downY = event.clientY;
  cancelHoldTimer();
  holdTimer = setTimeout(() => {
    holdTimer = null;
    if (dragging) return;
    const scene = runtime.render().scene;
    const index = renderer.hitTest(scene, downX, downY, scrollY, "long-press");
    if (index !== null) {
      holdFired = true;
      runtime.dispatch("LONG-PRESS", scene.taps[index]!.payload.id);
      scrollY = 0;
      paint();
    }
  }, LONG_PRESS_TIMEOUT_MS);
});
previewCanvas.addEventListener("pointermove", (event) => {
  if (!previewCanvas.hasPointerCapture(event.pointerId)) return;
  const delta = pointerY - event.clientY;
  if (Math.abs(delta) > 1) dragging = true;
  if (
    holdTimer !== null &&
    (Math.abs(event.clientX - downX) > HOLD_SLOP_PX || Math.abs(event.clientY - downY) > HOLD_SLOP_PX)
  ) {
    cancelHoldTimer();
  }
  pointerY = event.clientY;
  const scene = runtime.render().scene;
  scrollY = Math.max(0, Math.min(renderer.maxScroll(scene), scrollY + delta / (previewCanvas.clientWidth / scene.designWidth)));
  paint();
});
previewCanvas.addEventListener("pointerup", (event) => {
  cancelHoldTimer();
  if (!dragging && !holdFired) {
    const scene = runtime.render().scene;
    const index = renderer.hitTest(scene, event.clientX, event.clientY, scrollY, "tap");
    if (index !== null) {
      runtime.dispatch("TAP", scene.taps[index]!.payload.id);
      scrollY = 0;
      paint();
    }
  }
  holdFired = false;
  previewCanvas.releasePointerCapture(event.pointerId);
});
previewCanvas.addEventListener("pointercancel", () => {
  cancelHoldTimer();
  holdFired = false;
});
window.addEventListener("resize", () => paint());
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "h") {
    runtime.navigate("home");
    scrollY = 0;
    paint();
  }
});

async function checkForReload(): Promise<void> {
  try {
    const response = await fetch("/preview-hash", { cache: "no-store" });
    if (!response.ok) return;
    const hash = await response.text();
    if (lastHash === null) {
      lastHash = hash;
      return;
    }
    if (hash !== lastHash) {
      const snapshot = runtime.exportState();
      lastHash = hash;
      reloadText.textContent = "reloading…";
      // The page's module itself is the stable shell; the new compiled
      // app/runtime bundle is imported with a cache-busting query. State is
      // passed through the same JSON snapshot contract as Android.
      const next = await import(`/gallery_preview_app.js?hash=${encodeURIComponent(hash)}`) as {
        createPreviewRuntime?: () => GalleryRuntime;
      };
      if (next.createPreviewRuntime) {
        const replacement = next.createPreviewRuntime();
        replacement.restore(snapshot);
        runtime = replacement;
        makeRouteButtons();
        scrollY = 0;
        paint();
      }
      reloadText.textContent = "reloaded";
      statusText.textContent = "Hot reload applied (state preserved)";
      window.setTimeout(() => { reloadText.textContent = "live"; }, 1500);
    }
  } catch {
    // The preview works offline; polling is best-effort.
  }
}

makeRouteButtons();
paint();
window.setInterval(() => void checkForReload(), 2500);

// Dev/test hook: lets tooling (and tests) scroll the canvas viewport
// programmatically — the pointer-drag path is awkward for automation.
(window as unknown as Record<string, unknown>)["__previewScroll"] = (y: number) => {
  scrollY = Math.max(0, Math.min(renderer.maxScroll(runtime.render().scene), y));
  paint();
};
// Companion hook: dispatch a tap by payload id (what hosts echo back —
// NOT the region index; the shell prepends a back-to-home region on
// non-home routes), plus a region readout so automation can aim.
(window as unknown as Record<string, unknown>)["__previewTaps"] = () =>
  runtime.render().scene.taps.map((t) => ({ y: t.y, h: t.h, id: t.payload.id }));
(window as unknown as Record<string, unknown>)["__previewTap"] = (id: number) => {
  runtime.dispatch("TAP", id);
  paint();
};
(window as unknown as Record<string, unknown>)["__previewState"] = () =>
  JSON.stringify(runtime.exportState());

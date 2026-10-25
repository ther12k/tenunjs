import { ShowcaseRuntime } from "./runtime";
import { CanvasPreviewRenderer } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#preview");
const surfaceLabel = document.querySelector<HTMLElement>("#surface-label");
const appAccent = document.querySelector<HTMLElement>("#app-accent");
const backButton = document.querySelector<HTMLButtonElement>("#back-button");
const status = document.querySelector<HTMLElement>("#status");
const reloadLabel = document.querySelector<HTMLElement>("#reload-label");
const splash = document.querySelector<HTMLElement>("#splash");
const splashGlyph = document.querySelector<HTMLElement>("#splash-glyph");
if (!canvas || !surfaceLabel || !appAccent || !backButton || !status || !reloadLabel || !splash || !splashGlyph) {
  throw new Error("showcase preview shell is incomplete");
}

let runtime = new ShowcaseRuntime();
const renderer = new CanvasPreviewRenderer(canvas);
let scrollY = 0;
let pointerY = 0;
let dragging = false;
let lastHash: string | null = null;

function currentAppTitle(): string {
  const id = runtime.activeAppId();
  if (!id) return "App library";
  const app = runtime.apps().find((candidate) => candidate.id === id);
  return app ? app.title : "App";
}

function paint(): void {
  const result = runtime.render();
  scrollY = Math.min(scrollY, renderer.maxScroll(result.scene));
  renderer.render(result.scene, scrollY);
  surfaceLabel.textContent = currentAppTitle();
  const id = runtime.activeAppId();
  const app = id ? runtime.apps().find((candidate) => candidate.id === id) : undefined;
  appAccent.hidden = !app;
  if (app) appAccent.style.background = app.accent;
  backButton.hidden = runtime.isLauncher();
}

function toLauncher(): void {
  runtime.closeApp();
  scrollY = 0;
  paint();
}

/**
 * Shell-only "app opening" cue: a brief full-bleed splash in the opening
 * app's accent. Pure chrome — it touches no scene, state, or timing the
 * runtime or tests can see.
 */
function playSplash(appId: string): void {
  const app = runtime.apps().find((candidate) => candidate.id === appId);
  if (!app) return;
  splashGlyph.textContent = app.glyph;
  splash.style.background = `radial-gradient(circle at 30% 20%, ${app.accent}, #141821 78%)`;
  splash.classList.remove("fade");
  splash.hidden = false;
  window.setTimeout(() => splash.classList.add("fade"), 320);
  window.setTimeout(() => {
    splash.hidden = true;
    splash.classList.remove("fade");
  }, 680);
}

// TN-152 gesture parity: filtered hit tests, a hold timer for
// "long-press", and dispatch by the region's PAYLOAD ID — never the
// array index, which diverges from the id when the launcher chrome
// region is prepended.
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
canvas.addEventListener("pointermove", (event) => {
  if (!canvas.hasPointerCapture(event.pointerId)) return;
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
  scrollY = Math.max(0, Math.min(renderer.maxScroll(scene), scrollY + delta / (canvas.clientWidth / scene.designWidth)));
  paint();
});
canvas.addEventListener("pointerup", (event) => {
  cancelHoldTimer();
  if (!dragging && !holdFired) {
    const scene = runtime.render().scene;
    const index = renderer.hitTest(scene, event.clientX, event.clientY, scrollY, "tap");
    if (index !== null) {
      const wasLauncher = runtime.isLauncher();
      runtime.dispatch("TAP", scene.taps[index]!.payload.id);
      if (wasLauncher && !runtime.isLauncher() && runtime.activeAppId()) {
        playSplash(runtime.activeAppId() as string);
      }
      scrollY = 0;
      paint();
    }
  }
  holdFired = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener("pointercancel", () => {
  cancelHoldTimer();
  holdFired = false;
});
window.addEventListener("resize", () => paint());
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "h" && !runtime.isLauncher()) toLauncher();
});
backButton.addEventListener("click", () => toLauncher());

async function checkForReload(): Promise<void> {
  try {
    const response = await fetch("/showcase-preview-hash", { cache: "no-store" });
    if (!response.ok) return;
    const hash = await response.text();
    if (lastHash === null) {
      lastHash = hash;
      return;
    }
    if (hash !== lastHash) {
      const snapshot = runtime.exportState();
      lastHash = hash;
      reloadLabel.textContent = "reloading…";
      const next = await import(`/showcase_preview_app.js?hash=${encodeURIComponent(hash)}`) as { createShowcaseRuntime?: () => ShowcaseRuntime };
      if (next.createShowcaseRuntime) {
        const replacement = next.createShowcaseRuntime();
        replacement.restore(snapshot);
        runtime = replacement;
        scrollY = 0;
        paint();
      }
      reloadLabel.textContent = "reloaded";
      status!.textContent = "Hot reload applied (state preserved)";
      window.setTimeout(() => { reloadLabel!.textContent = "live"; }, 1500);
    }
  } catch {
    // Best-effort polling keeps the preview usable offline.
  }
}

paint();
window.setInterval(() => void checkForReload(), 2500);

(window as unknown as Record<string, unknown>)["__showcaseScroll"] = (y: number) => {
  scrollY = Math.max(0, Math.min(renderer.maxScroll(runtime.render().scene), y));
  paint();
};
(window as unknown as Record<string, unknown>)["__showcaseTaps"] = () =>
  runtime.render().scene.taps.map((tap) => ({ x: tap.x, y: tap.y, w: tap.w, h: tap.h, id: tap.payload.id, fixed: tap.fixed, anchor: tap.anchor }));
(window as unknown as Record<string, unknown>)["__showcaseTap"] = (id: number) => {
  runtime.dispatch("TAP", id);
  paint();
};
(window as unknown as Record<string, unknown>)["__showcaseState"] = () => JSON.stringify(runtime.exportState());
(window as unknown as Record<string, unknown>)["__showcaseOpen"] = (id: string) => {
  runtime.openApp(id as never);
  playSplash(id);
  scrollY = 0;
  paint();
};
(window as unknown as Record<string, unknown>)["__showcaseClose"] = () => toLauncher();
(window as unknown as Record<string, unknown>)["__showcaseSurface"] = () =>
  JSON.stringify({ surface: runtime.isLauncher() ? "launcher" : "app", appId: runtime.activeAppId(), route: runtime.route(), schema: runtime.stateSchema() });

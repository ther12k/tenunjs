/**
 * Browser preview host for the VOTOL app: canvas host shell (same renderer
 * contract as the Android embedder), route bar, and the LIVE data wiring —
 * a 1 s poll of the dashboard backend's /state.json (via the same-origin
 * /backend proxy the dev server provides) plus command POSTs to /backend/api.
 *
 * This module implements the service seams the runtime expects; the runtime
 * and screens themselves stay network-free and headless-testable.
 */
import { VotolRuntime } from "./src/runtime";
import { normalizeSnapshot } from "./src/snapshot";
import {
  CanvasPreviewRenderer,
} from "../gallery-preview/renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#preview");
const routes = document.querySelector<HTMLElement>("#routes");
const routeLabel = document.querySelector<HTMLElement>("#route-label");
const status = document.querySelector<HTMLElement>("#status");
if (!canvas || !routes || !routeLabel || !status) throw new Error("preview shell is incomplete");
const previewCanvas = canvas;
const routeNav = routes;
const routeTitle = routeLabel;
const statusText = status;

/** Dashboard command: POST /api through the same-origin proxy. */
async function postCommand(action: string): Promise<void> {
  try {
    await fetch("/backend/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  } catch {
    /* the next poll surfaces backend trouble */
  }
}

/** Keyless command: POST /api, resolve with the backend's {ok,msg}. */
async function keylessCommand(action: string): Promise<{ ok: boolean; msg: string | null }> {
  try {
    const r = await fetch("/backend/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const d = (await r.json()) as { ok?: boolean; msg?: string };
    return { ok: d.ok === true, msg: typeof d.msg === "string" ? d.msg : null };
  } catch {
    return { ok: false, msg: "backend unreachable" };
  }
}

const runtime = new VotolRuntime({
  command: (action) => void postCommand(action),
  keyless: (action) => keylessCommand(action),
});
const renderer = new CanvasPreviewRenderer(previewCanvas);
let scrollY = 0;

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
  const labels: Record<string, string> = {
    home: "Home",
    telemetry: "Telemetry",
    keyless: "Keyless",
    params: "Params",
  };
  for (const route of runtime.routes()) {
    const button = document.createElement("button");
    button.className = "route";
    button.dataset.route = route;
    button.textContent = labels[route] ?? route;
    button.addEventListener("click", () => {
      runtime.navigate(route);
      scrollY = 0;
      paint();
    });
    routeNav.append(button);
  }
}

previewCanvas.addEventListener("pointerdown", (event) => {
  previewCanvas.setPointerCapture(event.pointerId);
  pointerY = event.clientY;
  dragging = false;
});
previewCanvas.addEventListener("pointermove", (event) => {
  if (!previewCanvas.hasPointerCapture(event.pointerId)) return;
  const delta = pointerY - event.clientY;
  if (Math.abs(delta) > 1) dragging = true;
  pointerY = event.clientY;
  const scene = runtime.render().scene;
  const scale = previewCanvas.clientWidth / scene.designWidth;
  scrollY = Math.max(0, Math.min(renderer.maxScroll(scene), scrollY + delta / scale));
  renderer.render(scene, scrollY);
});
previewCanvas.addEventListener("pointerup", (event) => {
  previewCanvas.releasePointerCapture(event.pointerId);
  if (dragging) return;
  const rect = previewCanvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (runtime.render().scene.designWidth / rect.width);
  const y = event.clientY - rect.top + scrollY;
  const hits = runtime.render().tapRuns;
  const scene = runtime.render().scene;
  let fired = false;
  scene.taps.forEach((tap, i) => {
    if (x >= tap.x && x <= tap.x + tap.w && y >= tap.y && y <= tap.y + tap.h) {
      const run = hits[i];
      if (typeof run === "function") {
        run();
        fired = true;
      }
    }
  });
  if (fired) paint();
});
let pointerY = 0;
let dragging = false;

let pollFailures = 0;
async function tick(): Promise<void> {
  try {
    const r = await fetch("/backend/state.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    runtime.sync(normalizeSnapshot(await r.json()));
    pollFailures = 0;
    statusText.textContent = `live · ${new Date().toLocaleTimeString()}`;
    statusText.className = "status ok";
  } catch {
    pollFailures += 1;
    runtime.sync(normalizeSnapshot(null));
    statusText.textContent =
      pollFailures === 1 ? "backend unreachable — is the dashboard running?" : "backend unreachable";
    statusText.className = "status error";
  }
  paint();
}

makeRouteButtons();
void tick();
setInterval(() => void tick(), 1000);

// Dev-only handles for e2e-driving the canvas host (taps by scene
// coordinates, scene inspection). The preview host is a development shell,
// so these live here rather than in the runtime.
interface VotolDebug {
  runtime: VotolRuntime;
  tapAt: (fx: number, fy: number) => boolean;
  sceneTexts: () => string[];
}
(window as unknown as Record<string, unknown>).__votolDebug = {
  runtime,
  tapAt: (fx: number, fy: number): boolean => {
    const r = previewCanvas.getBoundingClientRect();
    const scene = runtime.render().scene;
    const x = fx * scene.designWidth;
    const y = fy * (scene.contentHeight ?? previewCanvas.height) - 0; // fraction of content
    const runs = runtime.render().tapRuns;
    let fired = false;
    scene.taps.forEach((tap, i) => {
      if (!fired && x >= tap.x && x <= tap.x + tap.w && y >= tap.y && y <= tap.y + tap.h) {
        const run = runs[i];
        if (typeof run === "function") {
          run();
          fired = true;
        }
      }
    });
    if (fired) paint();
    return fired;
  },
  sceneTexts: (): string[] => {
    const scene = runtime.render().scene;
    const texts: string[] = [];
    for (const op of scene.ops) if (op.op === "text") texts.push(op.text);
    return texts;
  },
} satisfies VotolDebug;

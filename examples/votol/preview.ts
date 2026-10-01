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
  ...podHostServices(),
});

/* ------------------------------------------------------------------ *
 * Pod direct link — Web Bluetooth client for the tft-dash BLE GATT
 * service. The pod advertises c9d01402-…; writes are "CMD:SECRET"
 * (secret = the 32-hex pairing key, stored after scanning the QR in
 * the pod's SYS → SET tab); replies arrive as notifications.
 * ------------------------------------------------------------------ */
const POD_SVC = "c9d01402-a1b2-4c3d-8e9f-aabbccddeeff";
const POD_CMD = "c9d01403-a1b2-4c3d-8e9f-aabbccddeeff";
const POD_STAT = "c9d01404-a1b2-4c3d-8e9f-aabbccddeeff";
const POD_KEY_STORE = "votol_pod_key";

/** Minimal structural Web Bluetooth types (no lib dom bluetooth yet). */
interface PodGattCharacteristic {
  value?: DataView;
  writeValue(v: BufferSource): Promise<void>;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<PodGattCharacteristic>;
  addEventListener(type: "characteristicvaluechanged", f: (e: { target: PodGattCharacteristic }) => void): void;
}
interface PodGattServer {
  connect(): Promise<unknown>;
  getPrimaryService(u: string): Promise<{ getCharacteristic(u: string): Promise<PodGattCharacteristic> }>;
}
interface PodBluetoothDevice {
  name?: string;
  gatt?: PodGattServer;
  addEventListener(type: "gattserverdisconnected", f: () => void): void;
}
type RequestDeviceFn = (o: unknown) => Promise<PodBluetoothDevice>;

let podDevice: PodBluetoothDevice | null = null;
let podCmdChar: PodGattCharacteristic | null = null;
let podReplyWaiter: ((r: { ok: boolean; msg: string | null }) => void) | null = null;
let podKey: string | null = localStorage.getItem(POD_KEY_STORE);
const podEncoder = new TextEncoder();
const podDecoder = new TextDecoder();

function podSupported(): boolean {
  return typeof (navigator as { bluetooth?: { requestDevice?: unknown } }).bluetooth?.requestDevice === "function";
}
function podParseKey(text: string): string | null {
  const t = text.trim().toUpperCase();
  const m = /^VOTOL:([0-9A-F]{32})$/.exec(t);
  if (m) return m[1];
  return /^[0-9A-F]{32}$/.test(t) ? t : null;
}
/** Reply "OK DISARM"/"ERR KEY" or status "ARMED FON" -> screen state. */
function podHandleNotify(text: string): void {
  const reply = /^(OK|ERR)\b/.exec(text);
  if (reply) {
    const armed = /\b(ARMED|DISARMED)\b/.exec(text);
    runtime.podSync({
      ...(armed ? { armed: armed[1] === "ARMED" } : {}),
    });
    podReplyWaiter?.({ ok: text.startsWith("OK"), msg: text });
    podReplyWaiter = null;
    return;
  }
  const st = /^(ARMED|DISARMED)\s+(FON|FOFF)/.exec(text);
  if (st) {
    runtime.podSync({ connected: true, armed: st[1] === "ARMED", fobNear: st[2] === "FON" });
  }
}
function podText(dv: DataView): string {
  return podDecoder.decode(dv.buffer.byteOffset === 0 && dv.buffer.byteLength === dv.byteLength ? dv.buffer : dv);
}
async function podConnect(): Promise<boolean> {
  const bt = (navigator as { bluetooth?: { requestDevice?: RequestDeviceFn } }).bluetooth;
  if (!bt?.requestDevice) return false;
  try {
    const device = await bt.requestDevice({ filters: [{ services: [POD_SVC] }] });
    podDevice = device;
    device.addEventListener("gattserverdisconnected", () => {
      podCmdChar = null;
      runtime.podSync({ connected: false, armed: null, fobNear: null });
    });
    const server = await device.gatt?.connect();
    if (!server) throw new Error("no gatt server");
    const svc = await server.getPrimaryService(POD_SVC);
    podCmdChar = await svc.getCharacteristic(POD_CMD);
    const stat = await svc.getCharacteristic(POD_STAT);
    await stat.startNotifications();
    stat.addEventListener("characteristicvaluechanged", (e) => {
      if (e.target.value) podHandleNotify(podText(e.target.value));
    });
    podHandleNotify(podText(await stat.readValue())); // seed the hero
    runtime.podSync({ connected: true });
    return true;
  } catch (e) {
    runtime.podSync({ connected: false });
    return false;
  }
}
async function podSend(cmd: "ARM" | "DISARM" | "PANIC" | "STAT"): Promise<{ ok: boolean; msg: string | null }> {
  if (!podCmdChar) return { ok: false, msg: "not connected" };
  if (!podKey) return { ok: false, msg: "no pairing key" };
  const reply = new Promise<{ ok: boolean; msg: string | null }>((resolve) => {
    podReplyWaiter = resolve;
    setTimeout(() => {
      if (podReplyWaiter === resolve) {
        podReplyWaiter = null;
        resolve({ ok: false, msg: "no reply (pod awake? in range?)" });
      }
    }, 4000);
  });
  await podCmdChar.writeValue(podEncoder.encode(`${cmd}:${podKey}`));
  return reply;
}
/** Pairing overlay: camera QR scan (BarcodeDetector) + paste fallback. */
function podPair(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.querySelector<HTMLElement>("#pod-pair");
    const video = document.querySelector<HTMLVideoElement>("#pod-pair-video");
    const input = document.querySelector<HTMLInputElement>("#pod-pair-key");
    const msg = document.querySelector<HTMLElement>("#pod-pair-msg");
    const saveBtn = document.querySelector<HTMLButtonElement>("#pod-pair-save");
    const cancelBtn = document.querySelector<HTMLButtonElement>("#pod-pair-cancel");
    if (!overlay || !video || !input || !msg || !saveBtn || !cancelBtn) {
      resolve(false);
      return;
    }
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      overlay.hidden = true;
      if (podKey) {
        runtime.podSync({ paired: true, connected: false, armed: null, fobNear: null });
      }
      resolve(ok);
    };
    overlay.hidden = false;
    msg.textContent = podKey ? `paired key saved: ${podKey.slice(0, 8)}… — scan to replace` : "point the camera at the pod's QR (SYS → SET), or type the key";
    const accept = (raw: string) => {
      const key = podParseKey(raw);
      if (!key) {
        msg.textContent = "not a VOTOL key (expected VOTOL:<32 hex> or 32 hex chars)";
        return;
      }
      podKey = key;
      localStorage.setItem(POD_KEY_STORE, key);
      msg.textContent = `saved ${key.slice(0, 8)}…`;
      setTimeout(() => finish(true), 500);
    };
    saveBtn.onclick = () => accept(input.value);
    input.onkeydown = (e) => {
      if (e.key === "Enter") accept(input.value);
    };
    cancelBtn.onclick = () => finish(podKey != null);
    const Detector = (window as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) {
      msg.textContent = "camera QR not supported here — type the 32-character key";
    } else {
      void (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          video.srcObject = stream;
          await video.play();
          const detector = new Detector({ formats: ["qr_code"] });
          const scan = async (): Promise<void> => {
            if (done) return;
            try {
              for (const code of await detector.detect(video)) accept(code.rawValue);
            } catch {
              /* transient decode errors are fine */
            }
            raf = requestAnimationFrame(() => void scan());
          };
          void scan();
        } catch {
          msg.textContent = "camera unavailable — type the 32-character key";
        }
      })();
    }
  });
}
function podHostServices() {
  return {
    pod: {
      supported: podSupported,
      pair: podPair,
      forget: () => {
        podKey = null;
        localStorage.removeItem(POD_KEY_STORE);
        runtime.podSync({ paired: false, connected: false, armed: null, fobNear: null });
      },
      connect: podConnect,
      send: podSend,
    },
  };
}

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
    pod: "Pod",
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
// BLE link reality is knowable before the pod route is ever mounted
runtime.podSync({ supported: podSupported(), paired: podKey != null });
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

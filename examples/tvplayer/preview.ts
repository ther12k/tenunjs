/**
 * NusaTV browser preview (TN-196 item 5): a canvas host so the app can
 * be developed and demoed without the TV. The media seam is a REAL
 * player here — hls.js driving a <video> element overlaid on the
 * canvas at exactly the rect the runtime asserts (the browser twin of
 * the native TextureView overlay; same architecture: the video is
 * opaque, the scene composes around it). MEDIA_STATE events flow from
 * the video element to the runtime, and fetchText does a bounded
 * fetch, so the Settings playlist path works in the browser too.
 * Muted by default (browser autoplay policy; live TV demo).
 *
 * Keyboard = the D-pad (the same KEY actions TN-194 delivers on
 * device): arrows navigate, Enter/Space is OK, PageUp/PageDown are
 * CH±, pointer taps work like taps on the glass.
 *
 * The painter here is deliberately self-contained (~60 lines over the
 * rect/outline/text/scroll-region ops this app emits) instead of
 * importing the gallery-preview renderer: that renderer has never
 * lived under a strict typecheck (the example tsconfigs' inherited
 * excludes vacate their own programs), and this config should stay
 * honestly strict.
 */
import Hls from "hls.js";
import type { MediaCapability, MediaStatus, StorageCapability } from "@tenunjs/platform";
import { TvplayerRuntime, type FormFactor } from "./src/runtime";

const canvas = document.getElementById("preview") as HTMLCanvasElement;
const routeLabel = document.getElementById("routes")!;
const statusLabel = document.getElementById("status")!;

// ?form=phone — the mobile layout (video hero + tappable channel list);
// default is the TV layout. Same runtime, same journeys, same player.
const form: FormFactor = new URLSearchParams(window.location.search).get("form") === "phone"
  ? "phone"
  : "tv";
if (form === "phone") {
  canvas.width = 390;
  canvas.height = 780;
} else {
  canvas.width = 960;
  canvas.height = 540;
}

/**
 * The preview's media host: the browser twin of MediaService.kt. The
 * video element is positioned exactly where setRect puts the rect —
 * every scene op stays outside it, the placeholder shows through
 * whenever no frames render (the same fail-visible contract).
 */
// Re-anchors the video overlay to its design rect (assigned by the
// capability below; no-op until the first setRect).
let placeVideo: () => void = () => {};

function createPreviewMedia(dispatch: (action: string, payload: unknown) => void): MediaCapability {
  const video = document.createElement("video");
  video.muted = true; // browser autoplay policy — the demo stays silent
  video.autoplay = true;
  video.playsInline = true;
  video.style.position = "fixed";
  video.style.pointerEvents = "none"; // clicks fall through to the canvas
  video.style.background = "#101014";
  video.style.display = "none"; // hidden until the first setRect
  video.style.zIndex = "5";
  document.body.appendChild(video);

  let hls: Hls | null = null;
  let currentUrl: string | null = null;
  let lastState: MediaStatus["state"] = "idle";
  // The last rect in DESIGN units (recomputed on every resize).
  let rectDesign: { x: number; y: number; w: number; h: number } | null = null;

  const push = (state: MediaStatus["state"], message?: string) => {
    lastState = state;
    dispatch("MEDIA_STATE", { type: "MEDIA_STATE", state, url: currentUrl ?? undefined, message });
  };

  const place = () => {
    if (!rectDesign) return;
    const bounds = canvas.getBoundingClientRect();
    const scale = bounds.width / canvas.width; // css px per canvas px
    video.style.left = `${bounds.left + rectDesign.x * scale}px`;
    video.style.top = `${bounds.top + rectDesign.y * scale}px`;
    video.style.width = `${rectDesign.w * scale}px`;
    video.style.height = `${rectDesign.h * scale}px`;
    video.style.objectFit = "contain";
  };

  video.addEventListener("playing", () => push("playing"));
  video.addEventListener("pause", () => push("paused"));
  video.addEventListener("waiting", () => push("buffering"));
  placeVideo = place;

  return {
    contractVersion: 1,
    async prepare(url) {
      currentUrl = url;
      push("buffering");
      hls?.destroy();
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        push("error", `hls: ${data.details}`);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      return { ok: true, value: { state: "buffering", url } };
    },
    async play() {
      try {
        await video.play();
        return { ok: true, value: { state: "playing" } };
      } catch (err) {
        // A backgrounded tab can abort play() for power saving while
        // the element keeps going once foregrounded — not a real
        // failure; the video element's own events report the truth.
        // Real blocks (autoplay policy) stay fail-visible.
        if ((err as { name?: string }).name === "AbortError") {
          return { ok: true, value: { state: "buffering" } };
        }
        return { ok: false, failure: { kind: "unavailable", message: String(err) } };
      }
    },
    async pause() {
      video.pause();
      return { ok: true, value: { state: "paused" } };
    },
    async stop() {
      hls?.destroy();
      hls = null;
      currentUrl = null;
      video.removeAttribute("src");
      video.load();
      push("idle");
      return { ok: true, value: { state: "idle" } };
    },
    async setRect(x, y, w, h) {
      rectDesign = { x, y, w, h };
      place();
      video.style.display = "block";
      return { ok: true, value: null };
    },
    async status() {
      return { ok: true, value: { state: lastState, url: currentUrl ?? undefined } };
    },
    // The bounded GET (04-api/media.md: 10 s, 2 MB, text) — the Settings
    // playlist path works in the browser exactly as on the host seam.
    async fetchText(url) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          return { ok: false, failure: { kind: "unavailable", message: `HTTP ${res.status}` } };
        }
        const text = await res.text();
        if (text.length > 2_000_000) {
          return { ok: false, failure: { kind: "unavailable", message: "payload over 2 MB" } };
        }
        return { ok: true, value: text };
      } catch (err) {
        return { ok: false, failure: { kind: "unavailable", message: String(err) } };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// The runtime needs the media host at construction, but MEDIA_STATE
// events must reach the runtime's dispatch — late-bound ref.
let dispatchRef: ((action: string, payload: unknown) => void) | null = null;
const previewMedia = createPreviewMedia((action, payload) => dispatchRef?.(action, payload));

/**
 * Browser storage fixture: localStorage behind the platform
 * StorageCapability contract — the same persistence the Android host
 * gets from StorageService (SharedPreferences), so favorites/recents
 * survive reloads in the preview too.
 */
const previewStorage: StorageCapability = {
  contractVersion: 1,
  availability: () => ({ status: "supported" }),
  permissionPrerequisites: () => [],
  async get(key) {
    try {
      const v = localStorage.getItem(`tvplayer.${key}`);
      return { ok: true, value: v };
    } catch {
      return { ok: false, failure: { kind: "unavailable", message: "localStorage blocked" } };
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(`tvplayer.${key}`, value);
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, failure: { kind: "unavailable", message: "localStorage blocked" } };
    }
  },
  async remove(key) {
    try {
      localStorage.removeItem(`tvplayer.${key}`);
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, failure: { kind: "unavailable", message: "localStorage blocked" } };
    }
  },
  async keys() {
    try {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("tvplayer.")) out.push(k.slice("tvplayer.".length));
      }
      return { ok: true, value: out };
    } catch {
      return { ok: false, failure: { kind: "unavailable", message: "localStorage blocked" } };
    }
  },
};

const runtime = new TvplayerRuntime({ formFactor: form, media: previewMedia, storage: previewStorage });
dispatchRef = (action, payload) => runtime.dispatch(action, payload);

interface SceneOp {
  op: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  color?: string;
  width?: number;
  text?: string;
  size?: number;
  weight?: number;
  ops?: SceneOp[];
  contentHeight?: number;
}

interface TvScene {
  designWidth?: number;
  background?: string;
  ops?: SceneOp[];
}

function drawOps(ctx: CanvasRenderingContext2D, ops: SceneOp[], ox: number, oy: number): void {
  for (const op of ops) {
    const x = (op.x ?? 0) + ox;
    const y = (op.y ?? 0) + oy;
    if (op.op === "rect" || op.op === "outline") {
      ctx.beginPath();
      ctx.roundRect(x, y, op.w ?? 0, op.h ?? 0, op.r ?? 0);
      if (op.op === "rect") {
        ctx.fillStyle = op.color ?? "#000000";
        ctx.fill();
      } else {
        ctx.strokeStyle = op.color ?? "#000000";
        ctx.lineWidth = op.width ?? 1;
        ctx.stroke();
      }
      continue;
    }
    if (op.op === "text") {
      ctx.font = `${op.weight ?? 400} ${op.size ?? 16}px system-ui, sans-serif`;
      ctx.fillStyle = op.color ?? "#000000";
      ctx.fillText(op.text ?? "", x, y);
      continue;
    }
    if (op.op === "scroll-region" && op.ops) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, op.w ?? 0, op.h ?? 0);
      ctx.clip();
      drawOps(ctx, op.ops, x, y); // base scroll offset (preview never scrolls)
      ctx.restore();
      continue;
    }
  }
}

function paint(): void {
  const ctx = canvas.getContext("2d")!;
  const scene = (runtime.render() as unknown as { scene: TvScene }).scene;
  const scale = canvas.width / (scene.designWidth ?? 960);
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = scene.background ?? "#101014";
  ctx.fillRect(0, 0, scene.designWidth ?? 960, canvas.height / scale);
  drawOps(ctx, scene.ops ?? [], 0, 0);
  ctx.restore();
  routeLabel.textContent = runtime
    .routes()
    .map((r) => (r === runtime.route() ? `[${r}]` : r))
    .join("  ");
  statusLabel.textContent =
    "muted — press M for sound; arrows = D-pad, Enter = OK, PgUp/PgDn = CH±";
}

runtime.onStateInvalidation(() => paint());

canvas.addEventListener("click", (event) => {
  // Taps on the glass: map the click into design units and let the
  // runtime's committed tap regions decide (approximate — preview aid).
  const scene = (runtime.render() as unknown as { scene: TvScene }).scene;
  const scale = canvas.width / (scene.designWidth ?? 960);
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / scale;
  const y = (event.clientY - rect.top) / scale;
  const taps =
    (scene as unknown as {
      taps?: { x: number; y: number; w: number; h: number; payload: { id: number } }[];
    }).taps ?? [];
  for (let i = taps.length - 1; i >= 0; i--) {
    const t = taps[i]!;
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
      // The tap-run id rides t.payload.id (SerializedTap has no
      // top-level id — dispatching t.id sent undefined and silently
      // hit nothing).
      runtime.dispatch("TAP", { id: t.payload.id });
      return;
    }
  }
});

// Keyboard = the D-pad. TN-194 dispatches KEY {keyCode, phase}; the
// preview synthesizes the same actions from DOM key events.
const KEY_MAP: Record<string, number> = {
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Enter: 23,
  " ": 23,
  PageUp: 166, // CH+ / CH- — same zap keys a TV remote ships
  PageDown: 167,
};
window.addEventListener("keydown", (event) => {
  // "m" toggles sound — streams start muted (autoplay policy); a real
  // keypress is the user gesture the browser wants for unmuted audio.
  if (event.key === "m" || event.key === "M") {
    const v = document.querySelector("video");
    if (v) v.muted = !v.muted;
    return;
  }
  const keyCode = KEY_MAP[event.key];
  if (keyCode === undefined) return;
  event.preventDefault();
  runtime.dispatch("KEY", { keyCode, phase: "down" });
  runtime.dispatch("KEY", { keyCode, phase: "up" });
});

window.addEventListener("resize", () => {
  paint();
  placeVideo(); // keep the overlay glued to its design rect
});

// Dev handle (the polytron __polytronDebug pattern): journey probes in
// the browser console / tooling.
(window as unknown as Record<string, unknown>)["__tvplayerDebug"] = {
  runtime,
  key: (keyCode: number) => runtime.keyPress(keyCode, "down"),
};

paint();

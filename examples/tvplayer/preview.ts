/**
 * NusaTV browser preview (TN-196 item 5): a minimal canvas host so
 * the app can be developed and demoed without the TV. The media seam
 * is the FAIL-CLOSED unsupportedMedia() stub — the preview never plays
 * video; it proves the scene, the KEY focus journeys, and the
 * degradation surface (the status line reports the stub's structured
 * failures).
 *
 * Keyboard = the D-pad (the same KEY actions TN-194 delivers on
 * device): arrows navigate, Enter/Space is OK, pointer taps work like
 * taps on the glass. TextField editing needs the device IME path; in
 * this preview the URL field is view-only.
 *
 * The painter here is deliberately self-contained (~60 lines over the
 * rect/outline/text/scroll-region ops this app emits) instead of
 * importing the gallery-preview renderer: that renderer has never
 * lived under a strict typecheck (the example tsconfigs' inherited
 * excludes vacate their own programs), and this config should stay
 * honestly strict.
 */
import { TvplayerRuntime, type FormFactor } from "./src/runtime";

const canvas = document.getElementById("preview") as HTMLCanvasElement;
const routeLabel = document.getElementById("routes")!;
const statusLabel = document.getElementById("status")!;

// ?form=phone — the mobile layout (video hero + tappable channel list);
// default is the TV layout. Same runtime, same journeys, same stub.
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

const runtime = new TvplayerRuntime({ formFactor: form }); // no media host: fail-closed stub

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
    "browser preview — media stub is fail-closed (unsupported); arrows = D-pad, Enter = OK";
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
  const keyCode = KEY_MAP[event.key];
  if (keyCode === undefined) return;
  event.preventDefault();
  runtime.dispatch("KEY", { keyCode, phase: "down" });
  runtime.dispatch("KEY", { keyCode, phase: "up" });
});

window.addEventListener("resize", () => paint());

// Dev handle (the polytron __polytronDebug pattern): journey probes in
// the browser console / tooling.
(window as unknown as Record<string, unknown>)["__tvplayerDebug"] = {
  runtime,
  key: (keyCode: number) => runtime.keyPress(keyCode, "down"),
};

paint();

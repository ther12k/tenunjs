import type { DisplayOp } from "@tenunjs/widgets";
import { drawIcon } from "./widgets";
import type { BleLinkState, WasherRuntime } from "./runtime";
import type { WashStatus } from "./protocol";

/**
 * The shared app chrome — pinned STOP + bottom navigation — drawn into
 * every committed scene by ONE wrapper used by BOTH hosts (the native
 * entry and the browser preview). The browser preview used to render a
 * completely different shell from the APK; this is the single source of
 * truth for the fixed bottom area.
 *
 * Layout (fixed, anchored to the viewport bottom):
 *   [ STOP band 64 ]  ← always reachable, never scrolls away
 *   [ nav bar    56 ]  ← Beranda · Program · Mesin · Setelan
 *
 * STOP semantics (review 2026-10-31): the safety stop must not be
 * scrollable content — it is pinned on EVERY tab, tappable whenever the
 * link is connected (even with stale telemetry), locked only offline.
 * Running or may-still-be-running paints it solid red; a link drop while
 * mid-cycle keeps it armed via mayStillRun().
 */

export const STOP_BAND_H = 64;
export const NAV_H = 56;
/** Total fixed chrome height — screens reserve this at their bottom. */
export const CHROME_H = STOP_BAND_H + NAV_H;

const TABS = [
  { route: "home", label: "Beranda", icon: "home" as const },
  { route: "programs", label: "Program", icon: "list" as const },
  { route: "controls", label: "Mesin", icon: "gauge" as const },
  { route: "settings", label: "Setelan", icon: "sliders" as const },
] as const;

/** The runtime surface the chrome reads. WasherRuntime satisfies it. */
export interface ChromeApp {
  route(): string;
  render(): ReturnType<WasherRuntime["render"]>;
  navigate(route: string): void;
  send(cmd: string): void;
  link(): BleLinkState;
  status(): WashStatus | null;
  mayStillRun(): boolean;
  stopPending(): boolean;
}

/** Wraps a WasherRuntime (or the entry's app object) so every committed
 *  scene carries the pinned STOP band + bottom navigation. */
export function withChrome(app: ChromeApp) {
  return {
    route: () => app.route(),
    render: () => {
      const res = app.render();
      const scene = res.scene;
      const w = scene.designWidth;

      /* ---- STOP band (above the nav, fixed) ---- */
      const link = app.link();
      const status = app.status();
      const running = status?.running === true;
      const mayrun = app.mayStillRun();
      const pending = app.stopPending();
      const offline = !link.connected;

      scene.ops.push({
        op: "rect", x: 0, y: 0, w, h: STOP_BAND_H, r: 0,
        color: "#FFFFFF", fixed: true, anchor: "bottom", anchorSize: CHROME_H,
      });
      scene.ops.push({
        op: "line", x1: 0, y1: 0.5, x2: w, y2: 0.5,
        color: "#E4EBF0", width: 1, fixed: true, anchor: "bottom", anchorSize: CHROME_H,
      });

      const bx = 16;
      const bw = w - 32;
      const by = 8;
      const bh = 52; // also the engine-loop smoke probe's tap height
      const label = pending ? "MENGHENTIKAN…" : "STOP MESIN";
      let fg = "#E5484D";
      if (offline) {
        scene.ops.push({ op: "rect", x: bx, y: by, w: bw, h: bh, r: 14, color: "#FDECEC", fixed: true, anchor: "bottom", anchorSize: CHROME_H });
        scene.ops.push({ op: "outline", x: bx, y: by, w: bw, h: bh, r: 14, color: "#F0C6C8", width: 1.5, fixed: true, anchor: "bottom", anchorSize: CHROME_H });
        fg = "#C98A8E";
        drawFixedIcon(scene, "lock", bx + 30, by + bh / 2, 6.5, fg, CHROME_H);
      } else if (pending) {
        scene.ops.push({ op: "rect", x: bx, y: by, w: bw, h: bh, r: 14, color: "#C93A40", fixed: true, anchor: "bottom", anchorSize: CHROME_H });
        fg = "#FFFFFF";
      } else if (running || mayrun) {
        scene.ops.push({ op: "rect", x: bx, y: by, w: bw, h: bh, r: 14, color: "#E5484D", fixed: true, anchor: "bottom", anchorSize: CHROME_H });
        fg = "#FFFFFF";
        drawFixedIcon(scene, "stop", bx + bw / 2 - textHalf(scene, label, 15.5, w) - 18, by + bh / 2, 6.5, "#FFFFFF", CHROME_H);
      } else {
        scene.ops.push({ op: "rect", x: bx, y: by, w: bw, h: bh, r: 14, color: "#FDECEC", fixed: true, anchor: "bottom", anchorSize: CHROME_H });
        scene.ops.push({ op: "outline", x: bx, y: by, w: bw, h: bh, r: 14, color: "#E5484D", width: 1.5, fixed: true, anchor: "bottom", anchorSize: CHROME_H });
        drawFixedIcon(scene, "stop", bx + bw / 2 - textHalf(scene, label, 15.5, w) - 18, by + bh / 2, 6.5, "#E5484D", CHROME_H);
      }
      scene.ops.push({
        op: "text", x: bx, y: by + bh / 2 + 5.5, text: label, size: 15.5,
        weight: 800, color: fg, align: "center", width: bw,
        fixed: true, anchor: "bottom", anchorSize: CHROME_H,
      });
      if (!offline) {
        const stopTapId = res.tapRuns.length;
        scene.taps.push({
          x: bx, y: by, w: bw, h: bh, action: "tap",
          fixed: true, anchor: "bottom", anchorSize: CHROME_H,
          payload: { id: stopTapId },
        });
        res.tapRuns.push(() => app.send("STOP"));
      }

      /* ---- bottom navigation ---- */
      scene.ops.push({
        op: "rect", x: 0, y: 0, w, h: NAV_H, r: 0,
        color: "#FFFFFF", fixed: true, anchor: "bottom", anchorSize: NAV_H,
      });
      scene.ops.push({
        op: "line", x1: 0, y1: 0, x2: w, y2: 0,
        color: "#E4EBF0", width: 1, fixed: true, anchor: "bottom", anchorSize: NAV_H,
      });
      const tabW = w / TABS.length;
      TABS.forEach((tab, i) => {
        const active = tab.route === app.route();
        const tabX = i * tabW;
        const cx = tabX + tabW / 2;
        const color = active ? "#0E9F8C" : "#8AA3B2";
        drawFixedIcon(scene, tab.icon, cx, 19, 8.5, color, NAV_H);
        scene.ops.push({
          op: "text", x: cx, y: 43, text: tab.label, size: 11,
          weight: active ? 700 : 400, color, align: "center", width: 0,
          fixed: true, anchor: "bottom", anchorSize: NAV_H,
        });
        const tapId = res.tapRuns.length;
        scene.taps.push({
          x: tabX, y: 0, w: tabW, h: NAV_H, action: "tap",
          fixed: true, anchor: "bottom", anchorSize: NAV_H,
          payload: { id: tapId },
        });
        res.tapRuns.push(() => app.navigate(tab.route));
      });

      return res;
    },
  };
}

/** drawIcon into the fixed layer — ops keep anchor metadata so both hosts
 *  translate them to the viewport bottom identically. */
function drawFixedIcon(
  scene: { ops: DisplayOp[] },
  kind: Parameters<typeof drawIcon>[0],
  cx: number,
  cy: number,
  s: number,
  color: string,
  anchorSize: number,
): void {
  const before = scene.ops.length;
  drawIcon(kind, cx, cy, s, (op) => scene.ops.push(op), color);
  // Tag every op the icon just emitted as fixed-bottom chrome.
  for (let i = before; i < scene.ops.length; i++) {
    const op = scene.ops[i] as DisplayOp & { fixed?: boolean; anchor?: string; anchorSize?: number };
    op.fixed = true;
    op.anchor = "bottom";
    op.anchorSize = anchorSize;
  }
}

/** Rough half-width of a centered label for icon placement — matches the
 *  host's sans-serif metrics closely enough for a fixed glyph offset. */
function textHalf(_scene: { ops: DisplayOp[] }, text: string, size: number, _w: number): number {
  return text.length * size * 0.32;
}

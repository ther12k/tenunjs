import type { WidgetNode } from "@tenunjs/jsx-runtime";
import type { DisplayOp } from "@tenunjs/widgets";
import { CanvasBox, textWidth } from "@tenunjs-examples/ui-kit";
import { fmtDurationS, type ProgramStep } from "./protocol";

/**
 * Polytron Wash visual system — the calm light design language
 * (2026-10-30 redesign): white cards on a blue-gray canvas, teal accent,
 * navy program hero, wave water meter, ring cycle hero, red STOP.
 * "Calm control. Clear status."
 *
 * COORDINATE CONTRACT: paint() draws in BOX-LOCAL coordinates — (0,0) is
 * the box's own top-left and origin.w its width. The layout engine offsets
 * every op and tap by the box position (place() in packages/widgets
 * display-list). NEVER add origin.x/origin.y inside put()/tap().
 */

/* ----------------------------- design tokens ---------------------------- */

const C = {
  card: "#FFFFFF",
  bg: "#EFF3F6",
  line: "#E4EBF0",
  lineStrong: "#C9D7E0",
  track: "#E4EDF2",
  txt: "#182E38",
  dim: "#5F7A8C",
  faint: "#8AA3B2",
  off: "#A9BCC7",
  acc: "#0E9F8C", // teal
  accDeep: "#0B7F70", // filled buttons (white text)
  accSoft: "#DFF3EE",
  accLine: "#9AD8CD",
  navy: "#143A56",
  navyDim: "#9FC0D8",
  navyDim2: "#C3D8E6",
  red: "#E5484D",
  redDark: "#C93A40",
  redSoft: "#FDECEC",
  redLine: "#F0C6C8",
  redFaint: "#C98A8E",
  green: "#17A673",
  greenSoft: "#E3F5EC",
  greenLine: "#BCE4D2",
  amber: "#F5A524",
  amberSoft: "#FFF4E0",
  blue: "#2E90FA",
  blueSoft: "#E3F1FD",
  water: "#3FB6E8",
  waterTrack: "#DCF1FA",
  purple: "#7C5CE0",
  chipBg: "#F0F4F7",
} as const;

/* -------------------------------- icons --------------------------------- */

/** Blend two #RRGGBB colors (t=0 → a, t=1 → b) — spinner fade tails. */
function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Activity spinner: a tail of dots orbiting (cx,cy), head bright in the
 * accent, fading into the card. Phase advances with the wall clock — the
 * runtime's animation heartbeat repaints the scene, and each repaint
 * reads the current phase, so the orbit turns ~4 revolutions / 8 s.
 */
function orbitSpinner(
  put: (op: DisplayOp) => void,
  cx: number,
  cy: number,
  accent: string,
  phaseMs: number,
): void {
  const n = 8;
  const orbitR = 12;
  const head = Math.floor(phaseMs / 130) % n;
  for (let i = 0; i < n; i++) {
    const idx = (head - i + n) % n; // tail trails the head
    const angle = (idx / n) * Math.PI * 2;
    const fade = i === 0 ? 0 : 0.25 + (i / (n - 1)) * 0.75;
    put({
      op: "circle",
      cx: cx + Math.cos(angle) * orbitR,
      cy: cy + Math.sin(angle) * orbitR,
      r: i === 0 ? 3 : 2.2 - i * 0.12,
      color: mixHex(accent, C.card, Math.min(1, fade)),
    });
  }
}

export type FunctionIcon = "wash" | "spin" | "drain" | "droplet" | "waves" | "wavesSlash" | "clock";

export type IconKind =
  | FunctionIcon
  | "stop"
  | "lock"
  | "chevL"
  | "chevR"
  | "power"
  | "clock"
  | "tub"
  | "motorA"
  | "motorB"
  | "check"
  | "play"
  | "close"
  | "home"
  | "list"
  | "gauge"
  | "sliders";

/** Firmware mode token → the icon that represents it on chips/cards. */
export function modeIcon(mode: string): FunctionIcon {
  switch (mode) {
    case "WASH":
    case "RINSE":
      return "wash";
    case "SPIN":
      return "spin";
    case "DRAIN":
      return "drain";
    case "FILL":
      return "droplet";
    default:
      return "clock"; // WAIT and anything unknown
  }
}

/**
 * Stroke-drawn icon vocabulary — every glyph in the app comes from here,
 * so weights and rounding stay consistent. `s` is the half-extent.
 */
export function drawIcon(
  kind: IconKind,
  cx: number,
  cy: number,
  s: number,
  put: (op: DisplayOp) => void,
  color: string,
): void {
  const line = (x1: number, y1: number, x2: number, y2: number, width = 3) =>
    put({ op: "line", x1, y1, x2, y2, color, width });
  const wave = (y: number, amp: number): void => {
    line(cx - s, y + amp * 0.7, cx - s / 3, y - amp, 3);
    line(cx - s / 3, y - amp, cx + s / 3, y + amp * 0.7, 3);
    line(cx + s / 3, y + amp * 0.7, cx + s, y - amp, 3);
  };
  if (kind === "wash") {
    put({ op: "outline", x: cx - s, y: cy - s, w: s * 2, h: s * 2, r: s * 0.35, color, width: 3 });
    wave(cy + s * 0.15, s * 0.28);
  } else if (kind === "spin") {
    put({ op: "ring", cx, cy, r: s - 1, width: 3, color, progress: 0.72 });
    put({ op: "circle", cx, cy, r: s * 0.18 + 1, color });
    line(cx - s - 4, cy + s * 0.55, cx - s + 1, cy + s * 0.9, 3);
    line(cx + s - 1, cy - s * 0.9, cx + s + 4, cy - s * 0.55, 3);
  } else if (kind === "drain") {
    line(cx - s * 0.55, cy - s, cx, cy - s * 0.35, 3.5);
    line(cx, cy - s * 0.35, cx + s * 0.55, cy - s, 3.5);
    line(cx, cy - s, cx, cy + s * 0.25, 3.5);
    line(cx - s, cy + s * 0.7, cx + s, cy + s * 0.7, 3.5);
    line(cx - s, cy + s * 0.7, cx - s * 0.62, cy + s * 0.25, 3);
    line(cx + s, cy + s * 0.7, cx + s * 0.62, cy + s * 0.25, 3);
  } else if (kind === "droplet") {
    line(cx, cy - s, cx - s * 0.62, cy + s * 0.1, 3);
    line(cx, cy - s, cx + s * 0.62, cy + s * 0.1, 3);
    put({ op: "circle", cx, cy: cy + s * 0.25, r: s * 0.66, color });
    put({ op: "circle", cx: cx + s * 0.24, cy: cy + s * 0.12, r: s * 0.16, color: C.card });
  } else if (kind === "waves" || kind === "wavesSlash") {
    wave(cy - s * 0.4, s * 0.3);
    wave(cy + s * 0.5, s * 0.3);
    if (kind === "wavesSlash") line(cx - s, cy + s, cx + s, cy - s, 3);
  } else if (kind === "stop") {
    put({ op: "rect", x: cx - s, y: cy - s, w: s * 2, h: s * 2, r: s * 0.3, color });
  } else if (kind === "lock") {
    line(cx - s * 0.5, cy - s * 0.15, cx - s * 0.5, cy - s * 0.75, 2.5);
    line(cx + s * 0.5, cy - s * 0.15, cx + s * 0.5, cy - s * 0.75, 2.5);
    line(cx - s * 0.5, cy - s * 0.75, cx + s * 0.5, cy - s * 0.75, 2.5);
    put({ op: "outline", x: cx - s, y: cy - s * 0.2, w: s * 2, h: s * 1.2, r: s * 0.35, color, width: 2.5 });
  } else if (kind === "chevL") {
    line(cx + s * 0.45, cy - s, cx - s * 0.45, cy, 3.5);
    line(cx - s * 0.45, cy, cx + s * 0.45, cy + s, 3.5);
  } else if (kind === "chevR") {
    line(cx - s * 0.45, cy - s, cx + s * 0.45, cy, 3.5);
    line(cx + s * 0.45, cy, cx - s * 0.45, cy + s, 3.5);
  } else if (kind === "power") {
    put({ op: "ring", cx, cy, r: s - 1, width: 3, color, progress: 0.72 });
    line(cx, cy - s + 3, cx, cy + s * 0.15, 3);
  } else if (kind === "clock") {
    put({ op: "ring", cx, cy, r: s - 1, width: 2.5, color, progress: 1 });
    line(cx, cy, cx, cy - s * 0.55, 2.5);
    line(cx, cy, cx + s * 0.5, cy + s * 0.15, 2.5);
  } else if (kind === "tub") {
    put({ op: "outline", x: cx - s, y: cy - s, w: s * 2, h: s * 2, r: s * 0.35, color, width: 3 });
    put({ op: "circle", cx: cx - s * 0.4, cy: cy - s * 0.35, r: s * 0.14 + 0.8, color });
    put({ op: "circle", cx: cx + s * 0.3, cy: cy - s * 0.15, r: s * 0.2 + 0.8, color });
    put({ op: "circle", cx: cx - s * 0.05, cy: cy - s * 0.55, r: s * 0.1 + 0.6, color });
    wave(cy + s * 0.45, s * 0.22);
  } else if (kind === "check") {
    line(cx - s * 0.8, cy + s * 0.05, cx - s * 0.15, cy + s * 0.65, 3.5);
    line(cx - s * 0.15, cy + s * 0.65, cx + s * 0.85, cy - s * 0.6, 3.5);
  } else if (kind === "play") {
    line(cx - s * 0.5, cy - s * 0.8, cx + s * 0.7, cy, 3.5);
    line(cx + s * 0.7, cy, cx - s * 0.5, cy + s * 0.8, 3.5);
    line(cx - s * 0.5, cy - s * 0.8, cx - s * 0.5, cy + s * 0.8, 3.5);
  } else if (kind === "close") {
    line(cx - s * 0.6, cy - s * 0.6, cx + s * 0.6, cy + s * 0.6, 3);
    line(cx + s * 0.6, cy - s * 0.6, cx - s * 0.6, cy + s * 0.6, 3);
  } else if (kind === "home") {
    line(cx - s, cy - s * 0.1, cx, cy - s * 0.9, 3);
    line(cx, cy - s * 0.9, cx + s, cy - s * 0.1, 3);
    put({ op: "outline", x: cx - s * 0.72, y: cy - s * 0.1, w: s * 1.44, h: s * 0.95, r: s * 0.22, color, width: 3 });
    put({ op: "rect", x: cx - s * 0.18, y: cy + s * 0.25, w: s * 0.36, h: s * 0.6, r: s * 0.1, color });
  } else if (kind === "list") {
    for (let i = -1; i <= 1; i++) {
      put({ op: "circle", cx: cx - s * 0.7, cy: cy + i * s * 0.62, r: 1.6, color });
      line(cx - s * 0.38, cy + i * s * 0.62, cx + s * 0.85, cy + i * s * 0.62, 3);
    }
  } else if (kind === "gauge") {
    put({ op: "ring", cx, cy: cy + s * 0.15, r: s, width: 3, color, progress: 0.5 });
    line(cx, cy + s * 0.15, cx + s * 0.55, cy - s * 0.45, 3);
    put({ op: "circle", cx, cy: cy + s * 0.15, r: 2.2, color });
  } else if (kind === "sliders") {
    for (let i = -1; i <= 1; i++) {
      line(cx - s * 0.85, cy + i * s * 0.62, cx + s * 0.85, cy + i * s * 0.62, 3);
    }
    put({ op: "circle", cx: cx - s * 0.3, cy: cy - s * 0.62, r: 3.2, color });
    put({ op: "circle", cx: cx + s * 0.35, cy: cy, r: 3.2, color });
    put({ op: "circle", cx: cx - s * 0.1, cy: cy + s * 0.62, r: 3.2, color });
  } else {
    // motorA / motorB — the drum-with-letter glyph
    put({ op: "ring", cx, cy, r: s - 1, width: 3, color, progress: 1 });
    put({
      op: "text",
      x: cx - s,
      y: cy + s * 0.38,
      text: kind === "motorB" ? "B" : "A",
      size: s * 1.05,
      weight: 800,
      color,
      align: "center",
      width: s * 2,
    });
  }
}

/* ------------------------------ link header ------------------------------ */

const PHASE_LABELS: Record<string, string> = {
  scanning: "Mencari mesin…",
  found: "Mesin terdeteksi — menyambung…",
  reconnecting: "Menyambung ulang…",
};

/**
 * The screen title + THE connection control, at the top of every tab —
 * the mockup's "Polytron Wash / ● Terhubung · Data 1 dtk lalu" header.
 * The row underneath the title is the one tappable connection surface:
 * offline → connect, connecting → cancel, connected → disconnect.
 */
export function LinkHeader(props: {
  title: string;
  supported: boolean;
  connected: boolean;
  connecting: boolean;
  phase?: string | null;
  name: string | null;
  /** Seconds since the last ST: line; null = none received yet. */
  statusAgeS: number | null;
  /** Connected but the machine went quiet past the staleness budget. */
  stale: boolean;
  onPress: () => void;
}): WidgetNode {
  const h = 76;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({
        op: "text",
        x: 2,
        y: 30,
        text: props.title,
        size: 22,
        weight: 800,
        color: C.txt,
      });
      // --- link row (the tappable connection control) ---
      const rowY = 56;
      let dot: string = C.faint;
      let label: string;
      let labelColor: string = C.dim;
      let right: string | null = null;
      let rightColor: string = C.faint;
      let spinning = false;
      if (!props.supported) {
        label = "Bluetooth tidak tersedia di perangkat ini";
      } else if (props.connecting) {
        dot = C.amber;
        spinning = true;
        label = PHASE_LABELS[props.phase ?? ""] ?? "Menyambung…";
        right = "BATALKAN";
        rightColor = C.red;
      } else if (props.connected) {
        dot = props.stale ? C.amber : C.green;
        label = `Terhubung · ${props.name ?? "mesin cuci"}`;
        if (props.stale) {
          right = `beku ${props.statusAgeS ?? 0}s`;
          rightColor = C.amber;
        } else if (props.statusAgeS === null) {
          right = "menunggu data…";
        } else {
          right = `Data ${props.statusAgeS}s lalu`;
        }
        labelColor = C.txt;
      } else {
        dot = C.red;
        label = "Tidak tersambung";
        right = "SAMBUNGKAN";
        rightColor = C.acc;
      }
      if (spinning) orbitSpinner(put, 22, rowY, dot, Date.now());
      else put({ op: "circle", cx: 22, cy: rowY, r: 5, color: dot });
      put({
        op: "text",
        x: 38,
        y: rowY + 5,
        text: truncate(label, 13.5, w - 38 - (right ? textWidth(right, 11.5) + 30 : 16)),
        size: 13.5,
        weight: props.connected || props.connecting ? 700 : 600,
        color: labelColor,
      });
      if (right) {
        put({
          op: "text",
          x: w - 16 - textWidth(right, 11.5),
          y: rowY + 5,
          text: right,
          size: 11.5,
          weight: 800,
          color: rightColor,
        });
      }
      // Unsupported radios get an informational row, not a dead tap.
      if (props.supported) tap({ x: 0, y: 34, w, h: 42 }, props.onPress);
    },
  });
}

/* ------------------------------ banner card ------------------------------ */

const TONES = {
  ok: { bg: C.greenSoft, line: C.greenLine, fg: C.green },
  acc: { bg: C.accSoft, line: C.accLine, fg: C.acc },
  warn: { bg: C.amberSoft, line: "#F0D9AC", fg: C.amber },
  info: { bg: C.blueSoft, line: "#BED9F7", fg: C.blue },
} as const;

/** Soft status banner — "Siap mencuci", "Mencuci · 08:42", staleness… */
export function BannerCard(props: {
  icon: IconKind;
  tone: keyof typeof TONES;
  title: string;
  sub?: string;
  onPress?: () => void;
}): WidgetNode {
  const h = props.sub ? 68 : 56;
  const tone = TONES[props.tone];
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      const cy = h / 2;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: tone.bg });
      put({ op: "outline", x: 0, y: 0, w, h, r: 14, color: tone.line, width: 1 });
      put({ op: "circle", cx: 28, cy, r: 13, color: tone.fg });
      drawIcon(props.icon, 28, cy, 7.5, put, "#FFFFFF");
      const titleX = 52;
      const chev = props.onPress ? 22 : 0;
      if (props.sub) {
        put({
          op: "text",
          x: titleX,
          y: cy - 3,
          text: truncate(props.title, 14, w - titleX - chev - 14),
          size: 14,
          weight: 800,
          color: C.txt,
        });
        put({
          op: "text",
          x: titleX,
          y: cy + 15,
          text: truncate(props.sub, 11, w - titleX - chev - 14),
          size: 11,
          weight: 400,
          color: C.dim,
        });
      } else {
        put({
          op: "text",
          x: titleX,
          y: cy + 5,
          text: truncate(props.title, 14.5, w - titleX - chev - 14),
          size: 14.5,
          weight: 800,
          color: C.txt,
        });
      }
      if (props.onPress) {
        drawIcon("chevR", w - 16, cy, 7, put, tone.fg);
        tap({ x: 0, y: 0, w, h }, props.onPress);
      }
    },
  });
}

/* ----------------------------- program hero ------------------------------ */

/** Sentence-case slot name ("CEPAT" → "Cepat"). */
export function sentenceCase(name: string): string {
  return name.length <= 1 ? name : name[0]! + name.slice(1).toLowerCase();
}

/** The navy "PROGRAM TERSIMPAN" hero card with the teal Mulai button. The
 *  name row carries a › and opens the Programs editor. */
export function ProgramHero(props: {
  name: string;
  meta: string;
  state: "idle" | "pending" | "locked" | "busy";
  onStart?: () => void;
  /** Opens the Programs tab editor for this slot. */
  onEdit?: () => void;
}): WidgetNode {
  const h = 138;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C.navy });
      put({ op: "text", x: 20, y: 28, text: "PROGRAM TERSIMPAN", size: 10.5, weight: 700, color: C.navyDim });
      const name = sentenceCase(props.name);
      const nameW = props.onEdit ? w - 20 - 28 : w - 40;
      put({
        op: "text",
        x: 20,
        y: 54,
        text: truncate(name, 19, nameW),
        size: 19,
        weight: 800,
        color: "#FFFFFF",
      });
      if (props.onEdit && props.state !== "locked") {
        drawIcon("chevR", w - 24, 48, 7, put, "#7FD4C6");
        tap({ x: 0, y: 30, w, h: 40 }, props.onEdit);
      }
      put({ op: "text", x: 20, y: 74, text: truncate(props.meta, 12, w - 40), size: 12, weight: 400, color: C.navyDim2 });
      const bx = 20;
      const bw = w - 40;
      const by = 88;
      const bh = 38;
      if (props.state === "locked") {
        drawIcon("lock", bx + 14, by + bh / 2, 6, put, C.navyDim);
        put({
          op: "text",
          x: bx + 30,
          y: by + bh / 2 + 5,
          text: "sambungkan untuk menjalankan",
          size: 12,
          weight: 600,
          color: C.navyDim,
        });
        return;
      }
      const pending = props.state === "pending";
      const busy = props.state === "busy";
      if (pending || busy) {
        put({ op: "outline", x: bx, y: by, w: bw, h: bh, r: 12, color: busy ? "#3D5E78" : C.acc, width: 1.5 });
      } else {
        put({ op: "rect", x: bx, y: by, w: bw, h: bh, r: 12, color: C.acc });
      }
      const label = busy ? "MESIN SEDANG BERJALAN" : pending ? "MEMULAI…" : "Mulai program";
      const tw = textWidth(label, 13.5);
      if (!pending && !busy) drawIcon("play", bx + bw / 2 - tw / 2 - 12, by + bh / 2, 6.5, put, "#FFFFFF");
      put({
        op: "text",
        x: bx,
        y: by + bh / 2 + 5,
        text: label,
        size: 13.5,
        weight: 800,
        color: busy ? "#7E9BB2" : pending ? C.acc : "#FFFFFF",
        align: "center",
        width: bw,
      });
      if (props.state === "idle" && props.onStart) tap({ x: bx, y: by - 4, w: bw, h: bh + 8 }, props.onStart);
    },
  });
}

/* ----------------------------- progress ring ----------------------------- */

/** The cycle hero: big ring (track + progress), time inside, pct below. */
export function ProgressRingCard(props: {
  /** Big center line — "8:42" remaining, or a status word. */
  time: string;
  caption: string;
  /** 0..1; null draws an empty ring (honest "no progress yet"). */
  pct: number | null;
  accent: string;
}): WidgetNode {
  const h = 268;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 20, color: C.card });
      const cx = w / 2;
      const cy = 130;
      const r = 92;
      const pct = props.pct === null ? 0 : Math.max(0, Math.min(1, props.pct));
      put({ op: "ring", cx, cy, r, width: 13, color: props.accent, progress: pct, track: C.track });
      put({
        op: "text",
        x: 0,
        y: cy + 2,
        text: props.time,
        size: 44,
        weight: 800,
        color: C.txt,
        align: "center",
        width: w,
      });
      put({
        op: "text",
        x: 0,
        y: cy + 28,
        text: props.caption,
        size: 11.5,
        weight: 400,
        color: C.dim,
        align: "center",
        width: w,
      });
      if (props.pct !== null) {
        put({
          op: "text",
          x: 0,
          y: cy + 54,
          text: `${Math.round(props.pct * 100)}%`,
          size: 15,
          weight: 800,
          color: props.accent,
          align: "center",
          width: w,
        });
      }
    },
  });
}

/* ------------------------------- step chips ------------------------------ */

/** The program's step timeline — icon circles joined by a line, current
 *  step highlighted (the mockup's Cuci → Buang → Peras chain). */
export function StepChips(props: {
  steps: ReadonlyArray<{ label: string; icon: IconKind; color: string; active: boolean }>;
}): WidgetNode {
  const h = 70;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      const n = props.steps.length;
      if (n === 0) return;
      const cw = Math.min(84, (w - 16) / n);
      const total = cw * n;
      const x0 = (w - total) / 2;
      const cy = 26;
      props.steps.forEach((step, i) => {
        const cx = x0 + cw * i + cw / 2;
        if (i < n - 1) {
          put({ op: "line", x1: cx + 21, y1: cy, x2: cx + cw - 21, y2: cy, color: C.line, width: 2 });
        }
        if (step.active) {
          put({ op: "circle", cx, cy, r: 20, color: withAlpha(step.color, 0x26) });
          put({ op: "ring", cx, cy, r: 20, width: 2, color: step.color, progress: 1 });
        } else {
          put({ op: "circle", cx, cy, r: 20, color: C.chipBg });
        }
        drawIcon(step.icon, cx, cy, 9.5, put, step.active ? step.color : C.faint);
        put({
          op: "text",
          x: cx - cw / 2,
          y: 62,
          text: truncate(step.label, 10, cw - 4),
          size: 10,
          weight: step.active ? 800 : 500,
          color: step.active ? step.color : C.dim,
          align: "center",
          width: cw,
        });
      });
    },
  });
}

/* ------------------------------ water meter ------------------------------ */

/** "Ketinggian air" card with the wave-fill bar. `large` is the Mesin
 *  tab's monitoring tile (big % + tall wave); the compact form serves the
 *  running Home screen. null pct renders an honest "—" never a fake value
 *  (the v3 firmware reports W-1: no water sensor installed). */
export function WaveFillCard(props: { pct: number | null; caption?: string; large?: boolean }): WidgetNode {
  const h = props.large ? (props.caption ? 116 : 100) : props.caption ? 96 : 82;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      const big = props.large === true;
      const valueSize = big ? 30 : 19;
      put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C.card });
      drawIcon("droplet", 30, big ? 32 : 26, big ? 14 : 12, put, props.pct !== null ? C.water : C.faint);
      put({ op: "text", x: 52, y: big ? 38 : 31, text: "Ketinggian air", size: big ? 14 : 13.5, weight: 700, color: C.txt });
      const label = props.pct === null ? "—" : `${props.pct}%`;
      put({
        op: "text",
        x: w - 18 - textWidth(label, valueSize),
        y: big ? 42 : 34,
        text: label,
        size: valueSize,
        weight: 800,
        color: props.pct === null ? C.faint : C.txt,
      });
      const bx = 18;
      const bw = w - 36;
      const bh = big ? 20 : 14;
      const by = h - (props.caption ? (big ? 44 : 38) : 24);
      put({ op: "rect", x: bx, y: by, w: bw, h: bh, r: bh / 2, color: C.waterTrack });
      if (props.pct !== null) {
        const pct = Math.max(0, Math.min(100, props.pct)) / 100;
        const fw = Math.max(bh, bw * pct);
        put({ op: "rect", x: bx, y: by, w: fw, h: bh, r: bh / 2, color: C.water });
        // Wave crest: two circles riding the fill's right edge.
        put({ op: "circle", cx: bx + fw - 5, cy: by + bh / 2, r: bh / 2 + 2, color: C.water });
        put({ op: "circle", cx: bx + fw - 17, cy: by + bh / 2 - 3, r: bh / 2 - 1, color: C.water });
      }
      if (props.caption) {
        put({ op: "text", x: 18, y: h - 8, text: truncate(props.caption, 10.5, w - 36), size: 10.5, weight: 400, color: C.dim });
      }
    },
  });
}

/* --------------------------- running-screen rows -------------------------- */

/** "Program Cepat ›" — the cycle's program row above the ring; taps open
 *  the Programs tab. */
export function ProgramPillRow(props: { name: string; onPress?: () => void }): WidgetNode {
  const h = 44;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "text", x: 4, y: h / 2 + 5, text: "Program", size: 13, weight: 400, color: C.dim });
      put({ op: "text", x: 4 + textWidth("Program", 13) + 8, y: h / 2 + 5, text: sentenceCase(props.name), size: 13.5, weight: 800, color: C.txt });
      if (props.onPress) {
        drawIcon("chevR", w - 10, h / 2, 7, put, C.acc);
        tap({ x: 0, y: 0, w, h }, props.onPress);
      }
    },
  });
}

/** Two half-width value tiles side by side (Berlalu / Air on the running
 *  Home screen). */
export function MetricTilesRow(props: {
  left: { label: string; value: string; accent?: string };
  right: { label: string; value: string; accent?: string };
}): WidgetNode {
  const h = 88;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      const cw = (w - 10) / 2;
      [props.left, props.right].forEach((tile, i) => {
        const x = i * (cw + 10);
        put({ op: "rect", x, y: 0, w: cw, h, r: 16, color: C.card });
        put({ op: "text", x: x + 16, y: 32, text: tile.label, size: 11.5, weight: 400, color: C.dim });
        put({
          op: "text",
          x: x + 16,
          y: 62,
          text: tile.value,
          size: 22,
          weight: 800,
          color: tile.accent ?? C.txt,
        });
      });
    },
  });
}

/* ------------------------------- mesin cards ------------------------------ */

/** ONE grouped relay card — header + divided rows (the reference's single
 *  card with dividers, not four separate cards). Read-only by design. */
export function GroupedRelayCard(props: {
  rows: ReadonlyArray<{ icon: IconKind; iconColor: string; label: string; on: boolean | null }>;
}): WidgetNode {
  const headerH = 46;
  const rowH = 52;
  const h = headerH + props.rows.length * rowH;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C.card });
      put({ op: "text", x: 18, y: 29, text: "Relai", size: 13.5, weight: 700, color: C.txt });
      put({ op: "text", x: 18 + textWidth("Relai", 13.5) + 10, y: 29, text: "Indikator, bukan tombol", size: 10.5, weight: 400, color: C.faint });
      props.rows.forEach((row, i) => {
        const y = headerH + i * rowH;
        if (i > 0) put({ op: "line", x1: 18, y1: y, x2: w - 18, y2: y, color: C.line, width: 1 });
        const cy = y + rowH / 2;
        drawIcon(row.icon, 34, cy, 11, put, row.on === true ? row.iconColor : "#B4C4CE");
        put({ op: "text", x: 58, y: cy + 5, text: row.label, size: 13.5, weight: 700, color: row.on === true ? C.txt : C.dim });
        if (row.on === null) {
          put({ op: "text", x: w - 18 - textWidth("—", 14), y: cy + 5, text: "—", size: 14, weight: 800, color: C.faint });
        } else {
          const stateText = row.on ? "Aktif" : "Nonaktif";
          const color = row.on ? C.green : C.faint;
          put({ op: "circle", cx: w - 18 - textWidth(stateText, 12.5) - 12, cy, r: 4.5, color });
          put({ op: "text", x: w - 18 - textWidth(stateText, 12.5), y: cy + 5, text: stateText, size: 12.5, weight: 700, color });
        }
      });
    },
  });
}

/** Collapsible section header — "Diagnostik perangkat ›". */
export function CollapseHeader(props: { label: string; open: boolean; onToggle: () => void }): WidgetNode {
  const h = 56;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C.card });
      put({ op: "outline", x: 0, y: 0, w, h, r: 14, color: C.line, width: 1 });
      put({ op: "text", x: 18, y: h / 2 + 5, text: props.label, size: 13.5, weight: 700, color: C.txt });
      if (props.open) {
        put({ op: "line", x1: w - 28, y1: h / 2 - 2, x2: w - 20, y2: h / 2 + 6, color: C.acc, width: 2.5 });
        put({ op: "line", x1: w - 20, y1: h / 2 + 6, x2: w - 12, y2: h / 2 - 2, color: C.acc, width: 2.5 });
      } else {
        drawIcon("chevR", w - 20, h / 2, 7, put, C.acc);
      }
      tap({ x: 0, y: 0, w, h }, props.onToggle);
    },
  });
}

/* ------------------------------ home summary ------------------------------ */

/** The activity summary card — the single latest event with its time (the
 *  reference's compact "Aktivitas terakhir" row, not a full feed). */
export function ActivitySummaryCard(props: { line: string | null; at: number | null }): WidgetNode {
  const h = 58;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C.card });
      put({ op: "outline", x: 0, y: 0, w, h, r: 14, color: C.line, width: 1 });
      if (props.line === null || props.at === null) {
        put({ op: "text", x: 18, y: h / 2 + 5, text: "Belum ada aktivitas", size: 12.5, weight: 400, color: C.faint });
        return;
      }
      const d = new Date(props.at);
      const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      put({ op: "circle", cx: 26, cy: h / 2, r: 4.5, color: C.acc });
      put({ op: "text", x: 42, y: h / 2 + 5, text: truncate(props.line, 13, w - 42 - 52), size: 13, weight: 500, color: C.txt });
      put({ op: "text", x: w - 16 - textWidth(time, 10.5), y: h / 2 + 5, text: time, size: 10.5, weight: 400, color: C.faint });
    },
  });
}

/** Bottom clearance for the pinned chrome (STOP band + nav). Every screen
 *  ends with one so content never scrolls under the fixed area. */
export function ChromeSpacer(): WidgetNode {
  return CanvasBox({ height: 128, paint: () => undefined });
}

/* ----------------------------- function cards ---------------------------- */

export interface FunctionDef {
  label: string;
  icon: FunctionIcon;
  color: string;
  sub?: string;
  disabled?: boolean;
  pending?: boolean;
  /** The machine is running THIS function right now. */
  active?: boolean;
  onPress?: () => void;
}

/** Six-function icon grid — white tiles, one calm blue icon family (the
 *  reference's uniform line icons); the mode color returns only for the
 *  active/pending highlight. */
export function FunctionGrid(props: {
  functions: ReadonlyArray<FunctionDef>;
}): WidgetNode {
  const cols = 3;
  const gap = 10;
  const rows = Math.ceil(props.functions.length / cols);
  const tileH = 104;
  const h = rows * tileH + (rows - 1) * gap;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = (origin.w - (cols - 1) * gap) / cols;
      props.functions.forEach((item, i) => {
        const x = (i % cols) * (w + gap);
        const y = Math.floor(i / cols) * (tileH + gap);
        const enabled = !item.disabled;
        const highlighted = enabled && (item.active || item.pending);
        if (highlighted) put({ op: "rect", x, y, w, h: tileH, r: 16, color: withAlpha(item.color, 0x14) });
        put({
          op: "outline",
          x,
          y,
          w,
          h: tileH,
          r: 16,
          color: !enabled ? C.line : highlighted ? item.color : C.line,
          width: highlighted ? 2 : 1.5,
        });
        drawIcon(item.icon, x + w / 2, y + 34, 14, put, enabled ? (highlighted ? item.color : "#2E90FA") : "#B4C4CE");
        put({
          op: "text",
          x: x + 4,
          y: y + 74,
          text: item.label,
          size: 13,
          weight: 800,
          color: enabled ? C.txt : "#9DB2C7",
          align: "center",
          width: w - 8,
        });
        put({
          op: "text",
          x: x + 4,
          y: y + 92,
          text: item.pending ? "MENGIRIM…" : item.active ? "BERJALAN" : (item.sub ?? ""),
          size: 10,
          weight: item.pending || item.active ? 800 : 400,
          color: item.pending || item.active ? item.color : C.faint,
          align: "center",
          width: w - 8,
        });
        if (item.disabled) drawIcon("lock", x + w - 13, y + 13, 5, put, "#B4C4CE");
        if (enabled && item.onPress) tap({ x, y, w, h: tileH }, item.onPress);
      });
    },
  });
}

/* -------------------------------- stop bar ------------------------------- */

/** Full-width safety stop. Idle = soft red outline; running = solid red;
 *  offline = quiet locked; pending = dark red "stopping". */
export function StopBar(props: {
  disabled?: boolean;
  pending?: boolean;
  /** Machine is running — the button turns solid red (mockup 03/04). */
  emphasis?: boolean;
  onPress?: () => void;
}): WidgetNode {
  const h = 54;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      const label = props.pending ? "MENGHENTIKAN…" : "STOP MESIN";
      if (props.disabled) {
        put({ op: "outline", x: 0, y: 0, w, h, r: 16, color: C.redLine, width: 1.5 });
        const tw = textWidth(label, 14.5);
        drawIcon("lock", w / 2 - tw / 2 - 18, h / 2, 6, put, C.redFaint);
        put({
          op: "text",
          x: 0,
          y: h / 2 + 5,
          text: label,
          size: 14.5,
          weight: 800,
          color: C.redFaint,
          align: "center",
          width: w,
        });
        return;
      }
      if (props.pending) {
        put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C.redDark });
      } else if (props.emphasis) {
        put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C.red });
      } else {
        put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C.redSoft });
        put({ op: "outline", x: 0, y: 0, w, h, r: 16, color: C.red, width: 1.5 });
      }
      const solid = props.pending || props.emphasis;
      const tw = textWidth(label, 15.5);
      if (!props.pending) drawIcon("stop", w / 2 - tw / 2 - 18, h / 2, 6.5, put, solid ? "#FFFFFF" : C.red);
      put({
        op: "text",
        x: 0,
        y: h / 2 + 5.5,
        text: label,
        size: 15.5,
        weight: 800,
        color: solid ? "#FFFFFF" : C.red,
        align: "center",
        width: w,
      });
      if (props.onPress) tap({ x: 0, y: 0, w, h }, props.onPress);
    },
  });
}

/* -------------------------------- list row ------------------------------- */

export interface ListRowProps {
  icon?: IconKind;
  iconColor?: string;
  label: string;
  sub?: string;
  /** Right-side big value (e.g. a version, a count). */
  value?: string;
  valueColor?: string;
  /** Right-side filled action pill. */
  pill?: { label: string; busy?: boolean; onPress?: () => void };
  /** Offline: quiet "saved on the machine" note with a lock instead of actions. */
  locked?: string;
  onPress?: () => void;
}

/** The one row shape for Programs/Controls/Settings lists. */
export function ListRow(props: ListRowProps): WidgetNode {
  const h = 60;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C.card });
      put({ op: "outline", x: 0, y: 0, w, h, r: 14, color: C.line, width: 1 });
      const x0 = props.icon ? 54 : 18;
      let rightEdge = w - 18;
      if (props.pill) rightEdge = w - 16 - (textWidth(props.pill.label, 11) + 30) - 10;
      else if (props.locked !== undefined) rightEdge = w - 34 - textWidth(props.locked, 10) - 8;
      else if (props.value !== undefined) rightEdge = w - 18 - textWidth(props.value, 16) - 8;
      if (props.icon) drawIcon(props.icon, 30, 30, 12, put, props.iconColor ?? C.faint);
      put({
        op: "text",
        x: x0,
        y: 26,
        text: truncate(props.label, 13.5, rightEdge - x0),
        size: 13.5,
        weight: 700,
        color: C.txt,
      });
      if (props.sub) {
        put({ op: "text", x: x0, y: 45, text: truncate(props.sub, 10.5, rightEdge - x0), size: 10.5, weight: 400, color: C.dim });
      }
      if (props.pill) {
        const tw = textWidth(props.pill.label, 11);
        const bw = tw + 30;
        const bx = w - 16 - bw;
        if (props.pill.busy) {
          put({ op: "outline", x: bx, y: 10, w: bw, h: 40, r: 20, color: C.acc, width: 1.5 });
        } else {
          put({ op: "rect", x: bx, y: 10, w: bw, h: 40, r: 20, color: C.accDeep });
        }
        put({
          op: "text",
          x: bx,
          y: 34,
          text: props.pill.label,
          size: 11,
          weight: 800,
          color: props.pill.busy ? C.acc : "#FFFFFF",
          align: "center",
          width: bw,
        });
        if (props.pill.onPress) tap({ x: bx, y: 8, w: bw, h: 44 }, props.pill.onPress);
      } else if (props.locked !== undefined) {
        drawIcon("lock", w - 18, 30, 6, put, C.faint);
        put({
          op: "text",
          x: w - 34 - textWidth(props.locked, 10),
          y: 34,
          text: props.locked,
          size: 10,
          weight: 500,
          color: C.faint,
        });
      } else if (props.value !== undefined) {
        put({
          op: "text",
          x: w - 18 - textWidth(props.value, 16),
          y: 36,
          text: props.value,
          size: 16,
          weight: 800,
          color: props.valueColor ?? C.acc,
        });
      }
      if (props.onPress && !props.locked) tap({ x: 0, y: 0, w, h }, props.onPress);
    },
  });
}

/** Relay row — icon + name left, ● Aktif / ● Nonaktif right (the mockup's
 *  "Indikator, bukan tombol" list). */
export function RelayRow(props: {
  icon: IconKind;
  iconColor: string;
  label: string;
  on: boolean | null;
}): WidgetNode {
  const h = 56;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C.card });
      put({ op: "outline", x: 0, y: 0, w, h, r: 14, color: C.line, width: 1 });
      drawIcon(props.icon, 30, 28, 12, put, props.on === true ? props.iconColor : "#B4C4CE");
      put({
        op: "text",
        x: 54,
        y: 33,
        text: props.label,
        size: 13.5,
        weight: 700,
        color: props.on === true ? C.txt : C.dim,
      });
      const stateX = w - 18;
      if (props.on === null) {
        // Right-flush at the row edge (the scene align contract is
        // left/center only — the sibling branch below computes x the
        // same way with textWidth).
        put({
          op: "text",
          x: stateX - textWidth("—", 14),
          y: 33,
          text: "—",
          size: 14,
          weight: 800,
          color: C.faint,
        });
      } else {
        const text = props.on ? "Aktif" : "Nonaktif";
        const color = props.on ? C.green : C.faint;
        put({ op: "circle", cx: stateX - textWidth(text, 12.5) - 12, cy: 29, r: 4.5, color });
        put({
          op: "text",
          x: stateX - textWidth(text, 12.5),
          y: 33,
          text,
          size: 12.5,
          weight: 700,
          color,
        });
      }
    },
  });
}

/* ------------------------------- setting row ----------------------------- */

/** Label + key caption left, a compact − value + stepper right; offline
 *  the stepper collapses to the locked note, and a connected-but-unloaded
 *  value steps nothing until GET:ALL delivers the machine's real value. */
export function SettingRow(props: {
  label: string;
  sub?: string;
  value?: string;
  disabled?: boolean;
  /** Connected, but the machine's current value has not arrived yet. */
  unloaded?: boolean;
  onStep?: (dir: 1 | -1) => void;
}): WidgetNode {
  const h = 64;
  const sw = 152;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C.card });
      put({ op: "outline", x: 0, y: 0, w, h, r: 14, color: C.line, width: 1 });
      put({
        op: "text",
        x: 18,
        y: 27,
        text: truncate(props.label, 13.5, w - sw - 44),
        size: 13.5,
        weight: 700,
        color: props.disabled ? C.dim : C.txt,
      });
      if (props.sub) {
        put({ op: "text", x: 18, y: 46, text: props.sub, size: 10.5, weight: 400, color: C.faint });
      }
      if (props.disabled || props.unloaded) {
        const note = props.disabled ? "tersimpan" : "belum dimuat";
        drawIcon("lock", w - 18, 32, 6, put, C.faint);
        put({
          op: "text",
          x: w - 34 - textWidth(note, 10),
          y: 36,
          text: note,
          size: 10,
          weight: 500,
          color: C.faint,
        });
        return;
      }
      const sx = w - 16 - sw;
      put({ op: "outline", x: sx, y: 8, w: sw, h: 48, r: 24, color: C.line, width: 1.5 });
      const third = sw / 3;
      put({
        op: "text",
        x: sx,
        y: 38,
        text: "−",
        size: 19,
        weight: 700,
        color: C.dim,
        align: "center",
        width: third,
      });
      put({
        op: "text",
        x: sx + third,
        y: 36,
        text: props.value ?? "—",
        size: 15,
        weight: 800,
        color: C.acc,
        align: "center",
        width: third,
      });
      put({
        op: "text",
        x: sx + third * 2,
        y: 38,
        text: "+",
        size: 19,
        weight: 700,
        color: C.dim,
        align: "center",
        width: third,
      });
      if (props.onStep) {
        tap({ x: sx, y: 8, w: sw / 2, h: 48 }, () => props.onStep?.(-1));
        tap({ x: sx + sw / 2, y: 8, w: sw / 2, h: 48 }, () => props.onStep?.(1));
      }
    },
  });
}

/** A/B (or similar) choice pills right-aligned in a row. */
export function ChoiceRow(props: {
  label: string;
  sub?: string;
  options: ReadonlyArray<string>;
  selected: number;
  disabled?: boolean;
  onSelect?: (i: number) => void;
}): WidgetNode {
  const h = 60;
  const pw = 56;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C.card });
      put({ op: "outline", x: 0, y: 0, w, h, r: 14, color: C.line, width: 1 });
      const total = props.options.length * pw + (props.options.length - 1) * 8;
      put({
        op: "text",
        x: 18,
        y: 26,
        text: truncate(props.label, 13.5, w - 16 - total - 36),
        size: 13.5,
        weight: 700,
        color: C.txt,
      });
      if (props.sub) {
        put({
          op: "text",
          x: 18,
          y: 45,
          text: truncate(props.sub, 10.5, w - 16 - total - 36),
          size: 10.5,
          weight: 400,
          color: C.dim,
        });
      }
      let x = w - 16 - total;
      if (props.disabled) drawIcon("lock", x - 18, 30, 6, put, C.faint);
      props.options.forEach((opt, i) => {
        const sel = i === props.selected;
        if (props.disabled) {
          put({ op: "outline", x, y: 10, w: pw, h: 40, r: 20, color: C.line, width: 1.5 });
        } else if (sel) {
          put({ op: "rect", x, y: 10, w: pw, h: 40, r: 20, color: C.accSoft });
          put({ op: "outline", x, y: 10, w: pw, h: 40, r: 20, color: C.acc, width: 1.5 });
        } else {
          put({ op: "outline", x, y: 10, w: pw, h: 40, r: 20, color: C.lineStrong, width: 1.5 });
        }
        put({
          op: "text",
          x,
          y: 34,
          text: opt,
          size: 11.5,
          weight: 800,
          color: props.disabled ? C.faint : sel ? C.accDeep : C.dim,
          align: "center",
          width: pw,
        });
        if (!props.disabled && props.onSelect) {
          tap({ x, y: 10, w: pw, h: 40 }, () => props.onSelect?.(i));
        }
        x += pw + 8;
      });
    },
  });
}

/* ---------------------------- segmented control --------------------------- */

/** Full-width segmented selector (the reference's Cepat / Normal / Kustom
 *  pill row) — teal selected segment on a soft track. */
export function SegmentedControl(props: {
  options: ReadonlyArray<string>;
  selected: number;
  disabled?: boolean;
  onSelect?: (i: number) => void;
}): WidgetNode {
  const h = 48;
  const gap = 4;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C.chipBg });
      const segW = (w - gap * (props.options.length + 1)) / props.options.length;
      props.options.forEach((opt, i) => {
        const x = gap + i * (segW + gap);
        const sel = i === props.selected;
        if (sel) put({ op: "rect", x, y: gap, w: segW, h: h - gap * 2, r: 11, color: C.card });
        put({
          op: "text",
          x,
          y: h / 2 + 5,
          text: opt,
          size: 13,
          weight: sel ? 800 : 600,
          color: props.disabled ? C.faint : sel ? C.accDeep : C.dim,
          align: "center",
          width: segW,
        });
        if (!props.disabled && props.onSelect) tap({ x, y: 0, w: segW, h }, () => props.onSelect?.(i));
      });
    },
  });
}

/* ------------------------------ program card ----------------------------- */

/** Program slot card: colored spine, name + human summary line, an
 *  [Ubah] [MULAI] action pair, a locked note when offline, and a quiet
 *  disabled pill while the machine runs.
 *  state: idle | pending | locked | busy (busy = machine running). */
export function ProgramCard(props: {
  name: string;
  color: string;
  line: string;
  icon?: IconKind;
  state: "idle" | "pending" | "locked" | "busy";
  onStart?: () => void;
  onEdit?: () => void;
}): WidgetNode {
  const h = 92;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C.card });
      put({ op: "outline", x: 0, y: 0, w, h, r: 16, color: C.line, width: 1 });
      put({ op: "rect", x: 12, y: 14, w: 5, h: h - 28, r: 3, color: props.color });
      const nameX = props.icon ? 58 : 30;
      if (props.icon) drawIcon(props.icon, 38, 36, 13, put, props.color);
      put({ op: "text", x: nameX, y: 34, text: props.name, size: 16, weight: 800, color: C.txt });
      put({
        op: "text",
        x: nameX,
        y: 76,
        text: truncate(props.line, 11, w - nameX - 16),
        size: 11,
        weight: 400,
        color: C.dim,
      });
      if (props.state === "locked") {
        drawIcon("lock", w - 24, 34, 6, put, C.faint);
        put({
          op: "text",
          x: w - 40 - textWidth("tersimpan di mesin", 10),
          y: 38,
          text: "tersimpan di mesin",
          size: 10,
          weight: 500,
          color: C.faint,
        });
        return;
      }
      const label = props.state === "pending" ? "MEMULAI…" : "MULAI";
      const tw = textWidth(label, 11.5);
      const bw = tw + 32;
      const bx = w - 16 - bw;
      if (props.state === "busy") {
        put({ op: "outline", x: bx, y: 18, w: bw, h: 44, r: 22, color: C.line, width: 1.5 });
        put({
          op: "text",
          x: bx,
          y: 43,
          text: label,
          size: 11.5,
          weight: 800,
          color: C.faint,
          align: "center",
          width: bw,
        });
        return;
      }
      if (props.state === "pending") {
        put({ op: "outline", x: bx, y: 18, w: bw, h: 44, r: 22, color: C.acc, width: 1.5 });
      } else {
        put({ op: "rect", x: bx, y: 18, w: bw, h: 44, r: 22, color: C.accDeep });
      }
      put({
        op: "text",
        x: bx,
        y: 43,
        text: label,
        size: 11.5,
        weight: 800,
        color: props.state === "pending" ? C.acc : "#FFFFFF",
        align: "center",
        width: bw,
      });
      if (props.state === "idle" && props.onStart) tap({ x: bx, y: 16, w: bw, h: 48 }, props.onStart);
      if (props.onEdit) {
        const ew = textWidth("Ubah", 11);
        put({
          op: "text",
          x: bx - 16 - ew,
          y: 43,
          text: "Ubah",
          size: 11,
          weight: 700,
          color: C.acc,
        });
        tap({ x: bx - 16 - ew - 14, y: 18, w: ew + 28, h: 44 }, props.onEdit);
      }
    },
  });
}

/* ------------------------------- step editor ----------------------------- */

const ADD_MODES: ReadonlyArray<string> = ["WASH", "RINSE", "DRAIN", "FILL", "SPIN"];

/** The visual program editor (reference screen 02): numbered step rows
 *  with minute:second steppers (±30 s), quick-add chips that wrap, the
 *  duration estimate and the Mulai/Simpan pair. The slot selector lives in
 *  the screen above this editor. Pure canvas. */
export function StepEditor(props: {
  steps: ReadonlyArray<ProgramStep>;
  canStart?: boolean;
  onBump: (index: number, dir: 1 | -1) => void;
  onRemove: (index: number) => void;
  onAdd: (mode: string) => void;
  onSave: () => void;
  onStart?: () => void;
}): WidgetNode {
  const rowH = 58;
  const addH = 98; // two chip rows (see the wrap loop below)
  const estH = 64;
  const btnH = 68;
  const h = props.steps.length * rowH + addH + estH + btnH + 8;
  const stepValue = (s: number): string => {
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    if (ss === 0 && mm >= 1) return `${mm} mnt`;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  };
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      let y = 0;
      // Step rows
      props.steps.forEach((step, i) => {
        const ry = y + i * rowH;
        put({ op: "rect", x: 0, y: ry, w, h: rowH - 8, r: 14, color: C.card });
        put({ op: "outline", x: 0, y: ry, w, h: rowH - 8, r: 14, color: C.line, width: 1 });
        // number badge
        put({ op: "circle", cx: 26, cy: ry + (rowH - 8) / 2, r: 11, color: C.accSoft });
        put({
          op: "text",
          x: 26 - 11,
          y: ry + (rowH - 8) / 2 + 4,
          text: String(i + 1).padStart(2, "0"),
          size: 9.5,
          weight: 800,
          color: C.accDeep,
          align: "center",
          width: 22,
        });
        drawIcon(modeIcon(step.mode), 54, ry + (rowH - 8) / 2, 10, put, modeColorLocal(step.mode));
        const sw = 118;
        const nameEdge = w - 24 - sw - 48;
        put({
          op: "text",
          x: 74,
          y: ry + 23,
          text: truncate(modeLabelLocal(step.mode), 13, nameEdge - 74),
          size: 13,
          weight: 700,
          color: C.txt,
        });
        put({ op: "text", x: 74, y: ry + 40, text: `langkah ${i + 1}`, size: 9.5, weight: 400, color: C.faint });
        // stepper pill — the value shows honest minutes:seconds so a ±30 s
        // bump is always visible (whole minutes stay "N mnt").
        const sx = w - 24 - sw;
        const sy = ry + (rowH - 8) / 2 - 17;
        put({ op: "outline", x: sx, y: sy, w: sw, h: 34, r: 17, color: C.lineStrong, width: 1.5 });
        const third = sw / 3;
        put({ op: "text", x: sx, y: sy + 22, text: "−", size: 16, weight: 700, color: C.dim, align: "center", width: third });
        put({
          op: "text",
          x: sx + third,
          y: sy + 21,
          text: stepValue(step.s),
          size: 11.5,
          weight: 800,
          color: C.acc,
          align: "center",
          width: third,
        });
        put({ op: "text", x: sx + third * 2, y: sy + 22, text: "+", size: 16, weight: 700, color: C.dim, align: "center", width: third });
        tap({ x: sx, y: sy - 3, w: sw / 2, h: 40 }, () => props.onBump(i, -1));
        tap({ x: sx + sw / 2, y: sy - 3, w: sw / 2, h: 40 }, () => props.onBump(i, 1));
        // remove ✕ — 44px target (was 24, under every touch guideline)
        drawIcon("close", w - 30, ry + (rowH - 8) / 2, 6, put, C.redFaint);
        tap({ x: w - 52, y: sy - 5, w: 44, h: 44 }, () => props.onRemove(i));
      });
      y += props.steps.length * rowH;
      // Quick-add chips — wrap to the next row when the line runs out;
      // the budget (addH) holds two rows, which fits every supported width.
      put({ op: "text", x: 2, y: y + 26, text: "Tambah tahap", size: 11, weight: 600, color: C.dim });
      let ax = 2 + textWidth("Tambah tahap", 11) + 14;
      let chipY = y;
      ADD_MODES.forEach((mode) => {
        const label = `+ ${modeLabelLocal(mode)}`;
        const bwid = textWidth(label, 10.5) + 20;
        if (ax + bwid > w) {
          ax = 2;
          chipY += 44;
        }
        put({ op: "outline", x: ax, y: chipY + 8, w: bwid, h: 34, r: 17, color: C.accLine, width: 1.5 });
        put({ op: "text", x: ax, y: chipY + 29, text: label, size: 10.5, weight: 700, color: C.accDeep, align: "center", width: bwid });
        tap({ x: ax, y: chipY + 5, w: bwid, h: 40 }, () => props.onAdd(mode));
        ax += bwid + 8;
      });
      y += addH;
      // Estimate card
      const totalS = props.steps.reduce((acc, st) => acc + st.s, 0);
      put({ op: "rect", x: 0, y, w, h: estH - 8, r: 14, color: C.blueSoft });
      drawIcon("clock", 28, y + (estH - 8) / 2, 10, put, C.blue);
      put({ op: "text", x: 50, y: y + 24, text: "Estimasi durasi", size: 11, weight: 400, color: C.dim });
      put({
        op: "text",
        x: 50,
        y: y + 44,
        text: `±${fmtDurationS(totalS)}`,
        size: 16,
        weight: 800,
        color: C.txt,
      });
      put({ op: "text", x: 50 + textWidth(`±${fmtDurationS(totalS)}`, 16) + 10, y: y + 44, text: `· ${props.steps.length} tahap`, size: 11, weight: 400, color: C.dim });
      y += estH;
      // [Mulai program] [Simpan]
      const bw2 = (w - 10) / 2;
      const canStart = props.canStart !== false && props.onStart !== undefined;
      if (canStart) {
        put({ op: "rect", x: 0, y: y + 4, w: bw2, h: 48, r: 14, color: C.accDeep });
        put({ op: "text", x: 0, y: y + 33, text: "Mulai program", size: 13.5, weight: 800, color: "#FFFFFF", align: "center", width: bw2 });
        tap({ x: 0, y, w: bw2, h: 60 }, () => props.onStart?.());
      } else {
        put({ op: "outline", x: 0, y: y + 4, w: bw2, h: 48, r: 14, color: C.line, width: 1.5 });
        put({ op: "text", x: 0, y: y + 33, text: props.onStart === undefined ? "Tersimpan di mesin" : "Mesin berjalan", size: 12, weight: 700, color: C.faint, align: "center", width: bw2 });
      }
      put({ op: "rect", x: bw2 + 10, y: y + 4, w: bw2, h: 48, r: 14, color: C.accSoft });
      put({ op: "outline", x: bw2 + 10, y: y + 4, w: bw2, h: 48, r: 14, color: C.acc, width: 1.5 });
      put({ op: "text", x: bw2 + 10, y: y + 33, text: "Simpan", size: 13.5, weight: 800, color: C.accDeep, align: "center", width: bw2 });
      tap({ x: bw2 + 10, y, w: bw2, h: 60 }, props.onSave);
    },
  });
}

/* ------------------------------ activity feed ---------------------------- */

/** Activity timeline — dot, connector, label left, time right. */
export function ActivityList(props: {
  rows: ReadonlyArray<{ line: string; t: number; color: string }>;
  now?: number;
}): WidgetNode {
  const rowH = 40;
  const h = Math.max(props.rows.length * rowH, 40);
  const fmtHM = (t: number): string => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      if (props.rows.length === 0) {
        put({
          op: "text",
          x: 0,
          y: 25,
          text: "belum ada aktivitas",
          size: 12,
          weight: 400,
          color: C.faint,
          align: "center",
          width: origin.w,
        });
        return;
      }
      props.rows.forEach((row, i) => {
        const y = i * rowH;
        const dotY = y + rowH / 2;
        if (i < props.rows.length - 1) {
          put({ op: "line", x1: 18, y1: dotY + 5, x2: 18, y2: dotY + rowH - 5, color: C.line, width: 2 });
        }
        put({ op: "circle", cx: 18, cy: dotY, r: 4, color: row.color });
        put({
          op: "text",
          x: 34,
          y: dotY + 4,
          text: truncate(row.line, 13, origin.w - 34 - 48),
          size: 13,
          weight: 500,
          color: C.txt,
        });
        const time = fmtHM(row.t);
        put({
          op: "text",
          x: origin.w - 14 - textWidth(time, 10.5),
          y: dotY + 4,
          text: time,
          size: 10.5,
          weight: 400,
          color: C.faint,
        });
      });
    },
  });
}

/* -------------------------------- helpers -------------------------------- */

/** Local mode label (kept local to avoid a widgets→protocol cycle risk;
 *  protocol is pure so the import above is safe — this covers editor UI). */
function modeLabelLocal(mode: string): string {
  const labels: Record<string, string> = {
    WASH: "Cuci",
    SPIN: "Peras",
    DRAIN: "Buang",
    FILL: "Isi",
    WAIT: "Tunggu",
    RINSE: "Bilas",
  };
  return labels[mode] ?? mode;
}

function modeColorLocal(mode: string): string {
  const colors: Record<string, string> = {
    WASH: "#0E9F8C",
    DRAIN: "#2E90FA",
    FILL: "#17A673",
    SPIN: "#7C5CE0",
    WAIT: "#F5A524",
    RINSE: "#0E9F8C",
  };
  return colors[mode] ?? C.dim;
}

/** "x mnt lalu" for quick-action sub labels (client-side last-run). */
export function fmtAgo(t: number | undefined, now: number): string {
  if (t === undefined) return "belum pernah";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hr lalu`;
}

/** Clip a single line to a pixel width with an ellipsis. */
function truncate(text: string, size: number, maxWidth: number): string {
  if (maxWidth <= 24 || textWidth(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** "#AARRGGBB" from "#RRGGBB" + an alpha byte (Android color convention). */
export function withAlpha(hex: string, alpha: number): string {
  const body = hex.replace("#", "");
  const full = body.length === 3 ? body.split("").map((c) => c + c).join("") : body;
  return `#${alpha.toString(16).padStart(2, "0")}${full.slice(0, 6).toUpperCase()}`;
}

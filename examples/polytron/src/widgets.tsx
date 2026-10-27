import type { WidgetNode } from "@tenunjs/jsx-runtime";
import type { DisplayOp } from "@tenunjs/widgets";
import { CanvasBox, textWidth } from "@tenunjs-examples/ui-kit";

/**
 * Polytron Wash visual system — the v4 LCD design language (deep-teal
 * board, outline function cards, drawn stroke icons, orange page dot,
 * red STOP) rebuilt for a phone: brighter text ramp than the LCD (390px
 * at arm's length), one accent, no emoji in the canvas.
 *
 * COORDINATE CONTRACT: paint() draws in BOX-LOCAL coordinates — (0,0) is
 * the box's own top-left and origin.w its width. The layout engine offsets
 * every op and tap by the box position (place() in packages/widgets
 * display-list). NEVER add origin.x/origin.y inside put()/tap().
 */

/* ----------------------------- design tokens ---------------------------- */

const C = {
  card: "#101C26",
  cardOk: "#0E241C",
  cardWarn: "#231A0E",
  line: "#24333F",
  lineStrong: "#33475A",
  track: "#1A2833",
  txt: "#EAF3FC",
  dim: "#9DB2C7",
  faint: "#6E8496",
  off: "#586D7E",
  acc: "#00B7FD",
  /** Filled-button blue — white text reaches ~5.5:1 on it (the bright
   *  accent stays for borders/icons/text-on-dark only). */
  accDeep: "#046FA4",
  red: "#E8354A",
  redDark: "#B32B3D",
  redFaint: "#8B6468",
  green: "#00FF80",
  amber: "#FCB518",
  orange: "#FF9F45",
  aqua: "#00FFC8",
  purple: "#BB86FC",
} as const;

/* -------------------------------- icons --------------------------------- */

export type FunctionIcon = "wash" | "spin" | "drain" | "droplet" | "waves" | "wavesSlash";

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
  | "motorB";

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
  } else {
    // motorA / motorB — the LCD's drum-with-letter glyph
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

/* ------------------------------ status strip ----------------------------- */

/** The LCD's SIAP band as a phone strip: status headline + right value,
 *  thin progress track only when there is real progress, caption below. */
export function StatusStrip(props: {
  status: string;
  accent: string;
  /** 0..1, or null when there is nothing honest to show. */
  pct: number | null;
  right?: string;
  caption?: string;
  onPress?: () => void;
}): WidgetNode {
  const h = 86;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C.card });
      put({ op: "circle", cx: 20, cy: 25, r: 5, color: props.accent });
      const rightBudget = props.right
        ? textWidth(props.right, 15) + (props.onPress ? 42 : 26)
        : props.onPress
          ? 34
          : 18;
      put({
        op: "text",
        x: 37,
        y: 30,
        text: truncate(props.status, 15, w - 37 - rightBudget - 12),
        size: 15,
        weight: 800,
        color: C.txt,
      });
      if (props.right) {
        const rx = props.onPress
          ? w - 30 - textWidth(props.right, 15)
          : w - 18 - textWidth(props.right, 15);
        put({
          op: "text",
          x: rx,
          y: 30,
          text: props.right,
          size: 15,
          weight: 800,
          color: props.accent,
        });
      }
      if (props.onPress) {
        drawIcon("chevR", w - 16, 25, 7, put, C.dim);
        tap({ x: 0, y: 0, w, h }, props.onPress);
      }
      const capY = props.pct === null ? 58 : 74;
      if (props.pct !== null) {
        const trackW = w - 36;
        put({ op: "rect", x: 18, y: 45, w: trackW, h: 6, r: 3, color: C.track });
        const pct = Math.max(0, Math.min(1, props.pct));
        if (pct > 0) put({ op: "rect", x: 18, y: 45, w: Math.max(10, trackW * pct), h: 6, r: 3, color: props.accent });
      }
      if (props.caption) {
        put({ op: "text", x: 18, y: capY, text: props.caption, size: 11.5, weight: 400, color: C.dim, width: w - 36 });
      }
    },
  });
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

/** LCD icon grid: every function in one 3-column grid — no paging, all
 *  six actions visible and one tap away on the first phone screen. */
export function FunctionGrid(props: {
  functions: ReadonlyArray<FunctionDef>;
}): WidgetNode {
  const cols = 3;
  const gap = 10;
  const rows = Math.ceil(props.functions.length / cols);
  const tileH = 116;
  const h = rows * tileH + (rows - 1) * gap;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = (origin.w - (cols - 1) * gap) / cols;
      props.functions.forEach((item, i) => {
        const x = (i % cols) * (w + gap);
        const y = Math.floor(i / cols) * (tileH + gap);
        const enabled = !item.disabled;
        const border = !enabled ? C.line : item.active || item.pending ? item.color : C.lineStrong;
        put({
          op: "outline",
          x,
          y,
          w,
          h: tileH,
          r: 14,
          color: border,
          width: !enabled ? 1.5 : item.active || item.pending ? 2.5 : 2,
        });
        drawIcon(item.icon, x + w / 2, y + 36, 15, put, enabled ? item.color : "#4E6272");
        put({
          op: "text",
          x: x + 4,
          y: y + 80,
          text: item.label,
          size: 13.5,
          weight: 800,
          color: enabled ? C.txt : "#6E8496",
          align: "center",
          width: w - 8,
        });
        // Offline the lock chip already says "disabled" — the caption
        // keeps the useful last-run info instead of a third "offline"
        // mention on the same screen.
        put({
          op: "text",
          x: x + 4,
          y: y + 99,
          text: item.pending ? "MENGIRIM…" : item.active ? "BERJALAN" : (item.sub ?? "sentuh"),
          size: 10,
          weight: item.pending || item.active ? 800 : 500,
          color: item.pending || item.active ? item.color : item.disabled ? "#586D7E" : C.dim,
          align: "center",
          width: w - 8,
        });
        if (item.disabled) drawIcon("lock", x + w - 13, y + 13, 5, put, "#586D7E");
        if (enabled && item.onPress) tap({ x, y, w, h: tileH }, item.onPress);
      });
    },
  });
}

/* -------------------------------- stop bar ------------------------------- */

/** Full-width safety stop — filled red when armed, quiet outline offline. */
export function StopBar(props: { disabled?: boolean; pending?: boolean; onPress?: () => void }): WidgetNode {
  const h = 52;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      if (props.disabled) {
        put({ op: "outline", x: 0, y: 0, w, h, r: 14, color: "#5A2A33", width: 1.5 });
        const tw = textWidth("STOP", 15);
        drawIcon("lock", w / 2 - tw / 2 - 22, h / 2, 6, put, C.redFaint);
        put({
          op: "text",
          x: 0,
          y: h / 2 + 5,
          text: "STOP",
          size: 15,
          weight: 800,
          color: C.redFaint,
          align: "center",
          width: w,
        });
        return;
      }
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: props.pending ? C.redDark : C.red });
      const label = props.pending ? "MENGHENTIKAN…" : "STOP";
      const tw = textWidth(label, 17);
      if (!props.pending) drawIcon("stop", w / 2 - tw / 2 - 16, h / 2, 6, put, "#FFFFFF");
      put({
        op: "text",
        x: 0,
        y: h / 2 + 6,
        text: label,
        size: 17,
        weight: 800,
        color: "#FFFFFF",
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
      const x0 = props.icon ? 54 : 18;
      // Right-edge reserve for the tallest right-side element — label
      // and sub truncate against it instead of running under the pill.
      let rightEdge = w - 18;
      if (props.pill) rightEdge = w - 16 - (textWidth(props.pill.label, 11) + 30) - 10;
      else if (props.locked !== undefined) rightEdge = w - 34 - textWidth(props.locked, 10) - 8;
      else if (props.value !== undefined) rightEdge = w - 18 - textWidth(props.value, 16) - 8;
      if (props.icon) drawIcon(props.icon, 30, 30, 12, put, props.iconColor ?? C.dim);
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
          // Deep-accent fill + white text: the label used to vanish at
          // 1:1 (cyan on cyan).
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

/** Relay row — icon + name left, state chip right (ON tinted, OFF outline,
 *  unknown a quiet dash). */
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
      drawIcon(props.icon, 30, 28, 12, put, props.on === true ? props.iconColor : "#4E6272");
      put({
        op: "text",
        x: 54,
        y: 33,
        text: props.label,
        size: 13.5,
        weight: 700,
        color: props.on === true ? C.txt : "#9DB2C7",
      });
      const chipX = w - 16 - 56;
      if (props.on === null) {
        put({
          op: "text",
          x: chipX,
          y: 33,
          text: "—",
          size: 15,
          weight: 800,
          color: C.faint,
          align: "center",
          width: 56,
        });
      } else if (props.on) {
        put({ op: "rect", x: chipX, y: 14, w: 56, h: 28, r: 14, color: withAlpha(props.iconColor, 0x33) });
        put({
          op: "text",
          x: chipX,
          y: 32,
          text: "ON",
          size: 11.5,
          weight: 800,
          color: props.iconColor,
          align: "center",
          width: 56,
        });
      } else {
        put({ op: "outline", x: chipX, y: 14, w: 56, h: 28, r: 14, color: C.lineStrong, width: 1.5 });
        put({
          op: "text",
          x: chipX,
          y: 32,
          text: "OFF",
          size: 11.5,
          weight: 800,
          color: C.dim,
          align: "center",
          width: 56,
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
      put({
        op: "text",
        x: 18,
        y: 27,
        text: truncate(props.label, 13.5, w - sw - 44),
        size: 13.5,
        weight: 700,
        color: props.disabled ? "#9DB2C7" : C.txt,
      });
      if (props.sub) {
        put({ op: "text", x: 18, y: 46, text: props.sub, size: 10.5, weight: 400, color: C.dim });
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
      put({ op: "outline", x: sx, y: 8, w: sw, h: 48, r: 24, color: C.lineStrong, width: 1.5 });
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
          put({ op: "rect", x, y: 10, w: pw, h: 40, r: 20, color: withAlpha(C.acc, 0x2E) });
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
          color: props.disabled ? C.faint : sel ? C.acc : C.dim,
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

/* ------------------------------ program card ----------------------------- */

/** Program slot card: colored spine, name + human summary line, an
 *  [edit] [MULAI] action pair right-aligned on the name row, a locked
 *  note when offline, and a quiet disabled pill while the machine runs.
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
      put({ op: "rect", x: 12, y: 14, w: 5, h: h - 28, r: 3, color: props.color });
      const nameX = props.icon ? 58 : 30;
      if (props.icon) drawIcon(props.icon, 38, 36, 13, put, props.color);
      put({ op: "text", x: nameX, y: 34, text: props.name, size: 16, weight: 800, color: C.txt });
      // The summary spans the full card width below the action row —
      // "Cuci 10 mnt · Buang 30 dtk · Peras 5 mnt" no longer clips.
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
        // Machine running: visible but inert — the strip above says to
        // STOP on Home first; the buttons must not invite a tap.
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
        const ew = textWidth("edit", 11);
        put({
          op: "text",
          x: bx - 16 - ew,
          y: 43,
          text: "edit",
          size: 11,
          weight: 700,
          color: C.acc,
        });
        // 44px-tall region — the old 28px target was under every
        // touch-target guideline for a machine-room phone.
        tap({ x: bx - 16 - ew - 14, y: 18, w: ew + 28, h: 44 }, props.onEdit);
      }
    },
  });
}

/* ------------------------------ water sensor ----------------------------- */

/** Sensor air row: droplet + label + caption left, meter right. The meter
 *  narrows on small canvases and the label truncates against it — the old
 *  fixed 150px meter overlapped "SENSOR AIR" at 320px. */
export function SensorRow(props: { pct: number | null; caption: string }): WidgetNode {
  const h = 62;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C.card });
      const meterW = Math.min(150, Math.max(112, w * 0.44));
      const mx = w - 18 - meterW - 6;
      const labelEdge = mx - 10;
      drawIcon("droplet", 30, 31, 13, put, props.pct !== null ? C.aqua : "#4E6272");
      put({ op: "text", x: 54, y: 28, text: truncate("SENSOR AIR", 13.5, labelEdge - 54), size: 13.5, weight: 700, color: C.txt });
      put({
        op: "text",
        x: 54,
        y: 47,
        text: truncate(props.caption, 10.5, labelEdge - 54),
        size: 10.5,
        weight: 400,
        color: C.dim,
      });
      put({ op: "outline", x: mx, y: 16, w: meterW, h: 28, r: 9, color: C.lineStrong, width: 2 });
      put({ op: "rect", x: mx + meterW + 2, y: 24, w: 4, h: 12, r: 2, color: C.lineStrong });
      put({ op: "rect", x: mx + 3.5, y: 19.5, w: meterW - 7, h: 21, r: 6, color: C.track });
      if (props.pct !== null) {
        const pct = Math.max(0, Math.min(100, props.pct));
        const fw = Math.max(6, (meterW - 7) * (pct / 100));
        put({ op: "rect", x: mx + 3.5, y: 19.5, w: fw, h: 21, r: 6, color: pct < 20 ? C.amber : C.aqua });
      }
      const label = props.pct === null ? "?" : `${props.pct}%`;
      const tw = Math.min(textWidth(label, 12), meterW - 16);
      put({ op: "rect", x: mx + meterW / 2 - (tw + 12) / 2, y: 21, w: tw + 12, h: 18, r: 9, color: C.card });
      put({
        op: "text",
        x: mx + meterW / 2 - tw / 2,
        y: 34,
        text: label,
        size: 12,
        weight: 800,
        color: props.pct === null ? C.faint : C.txt,
      });
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
          color: "#7E93A6",
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
          color: "#CFDCE8",
        });
        const time = fmtHM(row.t);
        put({
          op: "text",
          x: origin.w - 14 - textWidth(time, 10.5),
          y: dotY + 4,
          text: time,
          size: 10.5,
          weight: 400,
          color: "#7E93A6",
        });
      });
    },
  });
}

/* -------------------------------- helpers -------------------------------- */

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

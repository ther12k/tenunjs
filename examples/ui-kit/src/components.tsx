/**
 * UI kit — Flutter-style components for the TenunJS examples.
 *
 * Material 3 visual language on the display-list contract: tonal color
 * roles (primary/primaryContainer/secondaryContainer/outline...), a
 * six-step typography scale, full-pill buttons and chips, soft layered
 * elevation, and state-forward details (thumb checkmarks, stop dots,
 * active indicator pills) — the details that make Flutter widgets read
 * as Flutter.
 *
 * Two component families:
 *  - composition components (ListTile) built from @tenunjs/widgets;
 *  - canvas components (Avatar, ProgressRing, Switch, Chip, FAB, ...)
 *    that draw through the virtual canvas kind — circles, arcs and
 *    gradients the host widgets cannot express yet.
 *
 * Canvas components never touch the HostWidgetKind ABI (the virtual symbol
 * follows the Fragment precedent), and their paint closures run at layout
 * time so the committed display list stays plain JSON data.
 *
 * Color convention for translucent paints: Android-style "#AARRGGBB"
 * (alpha first). The Android host parses it natively; the browser preview
 * normalizes it to rgba() at paint time.
 */

import type { WidgetNode } from "@tenunjs/jsx-runtime";
import { Column, Card, Row, Text } from "@tenunjs/widgets";
import { Canvas, textWidth, wrapText, type DisplayOp } from "./display-list";
import type { SchemeRoles } from "./scheme";

/** Material-3-style dark palette defaults, aligned with examples/gallery. */
const KIT = {
  surface: "#101014",
  surfaceRaised: "#1C1C24",
  surfaceContainer: "#16161D",
  surfaceContainerHigh: "#232330",
  text: "#F2F2F7",
  textMuted: "#9AA3B2",
  primary: "#4C8DFF",
  onPrimary: "#FFFFFF",
  primaryContainer: "#223354",
  onPrimaryContainer: "#D6E4FF",
  secondaryContainer: "#30354A",
  onSecondaryContainer: "#DCE4FF",
  outline: "#474B5A",
  outlineVariant: "#26262F",
  track: "#2A2A35",
  success: "#3DD68C",
  warning: "#F5A623",
  danger: "#FF5A5F",
  white: "#FFFFFF",
};

/** Semantic aliases so components read like the M3 color roles they use. */
const C = {
  primary: KIT.primary,
  onPrimary: KIT.onPrimary,
  primaryContainer: KIT.primaryContainer,
  onPrimaryContainer: KIT.onPrimaryContainer,
  secondaryContainer: KIT.secondaryContainer,
  onSecondaryContainer: KIT.onSecondaryContainer,
  surface: KIT.surface,
  surfaceContainer: KIT.surfaceContainer,
  surfaceContainerHigh: KIT.surfaceContainerHigh,
  onSurface: KIT.text,
  onSurfaceVariant: KIT.textMuted,
  outline: KIT.outline,
  outlineVariant: KIT.outlineVariant,
  error: KIT.danger,
  success: KIT.success,
  warning: KIT.warning,
  white: KIT.white,
} as const;

interface CanvasBoxProps {
  width?: number;
  height: number;
  /** Paint and hit-test this canvas in viewport coordinates. */
  fixed?: boolean;
  /** Default viewport anchor for fixed ops and taps. */
  anchor?: "bottom" | "center";
  anchorSize?: number;
  paint: (
    origin: { x: number; y: number; w: number },
    put: (op: DisplayOp) => void,
    tap: (
      region: {
        x: number;
        y: number;
        w: number;
        h: number;
        fixed?: boolean;
        anchor?: "bottom" | "center";
        anchorSize?: number;
      },
      run: () => void
    ) => void,
    palette: SchemeRoles
  ) => void;
}

/**
 * Builds the virtual canvas node. The cast is the one sanctioned escape
 * hatch of the prototype renderer: the symbol kind is virtual (Fragment
 * precedent) and every host-side consumer of WidgetNode treats symbols
 * generically.
 */
function canvasBox(props: CanvasBoxProps): WidgetNode {
  return { kind: Canvas, key: null, props, children: [] } as unknown as WidgetNode;
}

export type { CanvasBoxProps };

/**
 * JSX-usable form of the canvas node for screen-local custom drawing (the
 * Canvas escape hatch from 04-api/canvas.md). A function component so the
 * JSX transform accepts it; renders straight to the virtual canvas kind.
 */
export function CanvasBox(props: CanvasBoxProps): WidgetNode {
  return canvasBox(props);
}

/**
 * Layered elevation: two expanding translucent rounded rects under a
 * widget — the closest a plain-JSON display list gets to a blurred drop
 * shadow, identical on every host. Paint order does the layering, so
 * always call before drawing the widget fill.
 */
function softShadow(
  put: (op: DisplayOp) => void,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  level: 1 | 2 = 2
): void {
  if (level === 2) {
    put({ op: "rect", x: x - 6, y: y + 4, w: w + 12, h: h + 12, r: r + 6, color: "#22000000" });
  }
  put({ op: "rect", x: x - 3, y: y + 2, w: w + 6, h: h + 7, r: r + 3, color: "#44000000" });
}

/** Centers a single line of text in a box (canvas-relative coordinates). */
function centerText(
  put: (op: DisplayOp) => void,
  origin: { x: number; y: number; w: number },
  text: string,
  cy: number,
  size: number,
  weight: number,
  color: string
): void {
  put({
    op: "text",
    // Relative to the canvas origin: the engine offsets ops by (x, y)
    // itself, so adding origin here would double-shift the text.
    x: (origin.w - textWidth(text, size)) / 2,
    y: cy + size * 0.36,
    text,
    size,
    weight,
    color,
  });
}

/** Centers a line within [cx0, cx0 + span) — the segment-safe variant. */
function centerInSpan(
  put: (op: DisplayOp) => void,
  text: string,
  cx0: number,
  span: number,
  cy: number,
  size: number,
  weight: number,
  color: string
): void {
  put({
    op: "text",
    x: cx0 + (span - textWidth(text, size)) / 2,
    y: cy + size * 0.36,
    text,
    size,
    weight,
    color,
  });
}

/** ---------- Avatar ---------- */

export interface AvatarProps {
  /** Initials or a single glyph. */
  label: string;
  size?: number;
  color?: string;
  textColor?: string;
}

/** Filled circle with centered initials — Flutter's CircleAvatar. */
export function Avatar(props: AvatarProps): WidgetNode {
  const size = props.size ?? 44;
  const r = size / 2;
  return canvasBox({
    width: size,
    height: size,
    paint: (origin, put, _tap, pal) => {
      const C = pal;
      put({ op: "circle", cx: r, cy: r, r, color: props.color ?? C.primaryContainer });
      centerText(put, origin, props.label, r, Math.round(size * 0.38), 700, props.textColor ?? C.onPrimaryContainer);
    },
  });
}

/** ---------- ProgressRing ---------- */

export interface ProgressRingProps {
  value: number;
  goal: number;
  size?: number;
  color?: string;
  trackColor?: string;
  /** Caption drawn under the percentage, inside the ring. */
  caption?: string;
}

/** Activity ring: track circle plus a progress arc from 12 o'clock. */
export function ProgressRing(props: ProgressRingProps): WidgetNode {
  const size = props.size ?? 104;
  const stroke = 10;
  const r = size / 2 - stroke;
  const pct = Math.max(0, Math.min(1, props.goal > 0 ? props.value / props.goal : 0));
  const label = `${Math.round(pct * 100)}%`;
  return canvasBox({
    width: size,
    height: size,
    paint: (origin, put, _tap, pal) => {
      const C = pal;
      put({
        op: "ring",
        cx: size / 2,
        cy: size / 2,
        r,
        width: stroke,
        color: props.color ?? C.primary,
        progress: pct,
        track: props.trackColor ?? KIT.track,
      });
      centerText(put, origin, label, size / 2 - (props.caption ? 8 : 0), 24, 700, C.onSurface);
      if (props.caption) {
        centerText(put, origin, props.caption, size / 2 + 16, 13, 400, C.onSurfaceVariant);
      }
    },
  });
}

/** ---------- Switch ---------- */

export interface SwitchProps {
  on: boolean;
  onChange?: (next: boolean) => void;
}

/**
 * M3 switch: the ON state fills the track with primary and shows a
 * checked thumb; OFF keeps a smaller neutral thumb inside an outlined
 * track. The whole pill is the tap target.
 */
export function Switch(props: SwitchProps): WidgetNode {
  const w = 64;
  const h = 36;
  return canvasBox({
    width: w,
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      if (props.on) {
        put({ op: "rect", x: 0, y: 0, w, h, r: h / 2, color: C.primary });
        put({ op: "circle", cx: w - 18, cy: h / 2, r: 14, color: C.onPrimary });
        const check = "✓";
        put({
          op: "text",
          x: w - 18 - textWidth(check, 16) / 2,
          y: h / 2 + 16 * 0.36,
          text: check,
          size: 16,
          weight: 700,
          color: C.primary,
        });
      } else {
        put({ op: "rect", x: 0, y: 0, w, h, r: h / 2, color: C.surfaceContainerHigh });
        put({ op: "outline", x: 0, y: 0, w, h, r: h / 2, color: C.outline, width: 2 });
        put({ op: "circle", cx: h / 2, cy: h / 2, r: 8, color: C.outline });
      }
      if (props.onChange) {
        const next = !props.on;
        tap({ x: 0, y: 0, w, h }, () => props.onChange!(next));
      }
    },
  });
}

/** ---------- Chip ---------- */

export interface ChipProps {
  label: string;
  selected?: boolean;
  onSelect?: () => void;
}

/**
 * M3 filter chip: a leading check joins the label when selected, sitting
 * on the secondary container; unselected is a quiet outlined pill.
 */
export function Chip(props: ChipProps): WidgetNode {
  const h = 44;
  const size = 16;
  const check = props.selected ? "✓ " : "";
  const label = `${check}${props.label}`;
  const w = Math.max(textWidth(label, size) + 44, 72);
  return canvasBox({
    width: w,
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      if (props.selected) {
        put({ op: "rect", x: 0, y: 0, w, h, r: h / 2, color: C.secondaryContainer });
        centerText(put, origin, label, h / 2, size, 600, C.onSecondaryContainer);
      } else {
        put({ op: "outline", x: 0, y: 0, w, h, r: h / 2, color: C.outlineVariant, width: 2 });
        centerText(put, origin, label, h / 2, size, 500, C.onSurfaceVariant);
      }
      if (props.onSelect) tap({ x: 0, y: 0, w, h }, props.onSelect);
    },
  });
}

/** ---------- Divider ---------- */

export interface DividerProps {
  color?: string;
}

/** Full-width hairline. */
export function Divider(props: DividerProps = {}): WidgetNode {
  return canvasBox({
    height: 1,
    paint: (origin, put, _tap, pal) => {
      const C = pal;
      put({ op: "line", x1: 0, y1: 0, x2: origin.w, y2: 0, color: props.color ?? C.outlineVariant, width: 1 });
    },
  });
}

/** ---------- ProgressBar ---------- */

export interface ProgressBarProps {
  value: number;
  max: number;
  height?: number;
  color?: string;
  trackColor?: string;
  /** M3 stop indicator: a dot marking the end of the active track. */
  stopDot?: boolean;
}

/** Rounded linear bar — week steps, storage, any 0..max ratio. */
export function ProgressBar(props: ProgressBarProps): WidgetNode {
  const height = props.height ?? 12;
  const ratio = props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0;
  return canvasBox({
    height,
    paint: (origin, put, _tap, pal) => {
      const C = pal;
      const cy = height / 2;
      const inactive = height / 3;
      put({
        op: "rect",
        x: 0,
        y: cy - inactive / 2,
        w: origin.w,
        h: inactive,
        r: inactive / 2,
        color: props.trackColor ?? C.surfaceContainerHigh,
      });
      if (ratio > 0) {
        const activeW = Math.max(origin.w * ratio, height);
        put({
          op: "rect",
          x: 0,
          y: 0,
          w: activeW,
          h: height,
          r: height / 2,
          color: props.color ?? C.primary,
        });
        if (props.stopDot !== false) {
          put({
            op: "circle",
            cx: Math.max(activeW - height / 2 - 8, height / 2),
            cy,
            r: height / 2 + 2,
            color: props.color ?? C.primary,
          });
        }
      }
    },
  });
}

/** ---------- HeroCard ---------- */

export interface HeroCardProps {
  title: string;
  headline: string;
  caption?: string;
  height?: number;
  from?: string;
  to?: string;
}

/** Gradient banner card — the glanceable header of a module screen. */
export function HeroCard(props: HeroCardProps): WidgetNode {
  const height = props.height ?? 148;
  return canvasBox({
    height,
    paint: (origin, put, _tap, pal) => {
      const C = pal;
      softShadow(put, 0, 0, origin.w, height, 22, 2);
      put({
        op: "gradient",
        x: 0,
        y: 0,
        w: origin.w,
        h: height,
        r: 22,
        color: props.from ?? "#24345C",
        colorTo: props.to ?? "#141A2B",
      });
      put({ op: "text", x: 24, y: 34, text: props.title, size: 15, weight: 600, color: C.onSurfaceVariant });
      put({ op: "text", x: 24, y: 86, text: props.headline, size: 44, weight: 700, color: C.onSurface });
      if (props.caption) {
        put({ op: "text", x: 24, y: 122, text: props.caption, size: 15, weight: 400, color: C.onSurfaceVariant });
      }
    },
  });
}

/** ---------- Bubble ---------- */

export interface BubbleProps {
  text: string;
  /** Own messages align right with the accent fill; incoming left. */
  mine?: boolean;
}

/**
 * Chat bubble: intrinsic width from the wrapped text (capped), rounded
 * rect fill, left-aligned lines. Pair with Row justify start/end.
 */
export function Bubble(props: BubbleProps): WidgetNode {
  const size = 16;
  const lineHeight = 22;
  const padX = 18;
  const padY = 12;
  const maxText = 440 - padX * 2;
  const lines = wrapText(props.text, size, maxText);
  const widest = Math.max(...lines.map((line) => textWidth(line, size)));
  const w = Math.min(widest + padX * 2, 440);
  const h = lines.length * lineHeight + padY * 2;
  return canvasBox({
    width: w,
    height: h,
    paint: (origin, put, _tap, pal) => {
      const C = pal;
      const fill = props.mine ? C.primary : "#262631";
      const textColor = props.mine ? C.onPrimary : C.onSurface;
      put({ op: "rect", x: 0, y: 0, w: origin.w, h, r: 18, color: fill });
      lines.forEach((line, index) => {
        put({
          op: "text",
          x: padX,
          y: padY + index * lineHeight + size * 0.78,
          text: line,
          size,
          weight: 400,
          color: textColor,
        });
      });
    },
  });
}

/** ---------- IconButton ---------- */

export interface IconButtonProps {
  glyph: string;
  /**
   * M3 shapes: filled (primary circle), tonal (secondary-container
   * circle), outlined (stroked circle), standard (bare glyph).
   */
  variant?: "filled" | "tonal" | "outlined" | "standard";
  size?: number;
  glyphSize?: number;
  color?: string;
  onPress?: () => void;
}

/** Circular glyph button — media controls, icon actions, FAB-lets. */
export function IconButton(props: IconButtonProps): WidgetNode {
  const size = props.size ?? 52;
  const variant = props.variant ?? "tonal";
  const glyphSize = props.glyphSize ?? Math.round(size * 0.42);
  const r = size / 2;
  return canvasBox({
    width: size,
    height: size,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const tint = props.color ?? C.primary;
      if (variant === "filled") {
        put({ op: "circle", cx: r, cy: r, r, color: tint });
        centerText(put, origin, props.glyph, r, glyphSize, 600, C.onPrimary);
      } else if (variant === "tonal") {
        put({ op: "circle", cx: r, cy: r, r, color: C.secondaryContainer });
        centerText(put, origin, props.glyph, r, glyphSize, 600, C.onSecondaryContainer);
      } else if (variant === "outlined") {
        put({ op: "outline", x: 2, y: 2, w: size - 4, h: size - 4, r: r - 2, color: tint, width: 3 });
        centerText(put, origin, props.glyph, r, glyphSize, 600, tint);
      } else {
        centerText(put, origin, props.glyph, r, glyphSize, 600, tint);
      }
      if (props.onPress) tap({ x: 0, y: 0, w: size, h: size }, props.onPress);
    },
  });
}

/** ---------- FAB ---------- */

export interface FabProps {
  glyph: string;
  /** Extended FAB: pill with the label beside the glyph. */
  label?: string;
  size?: number;
  color?: string;
  onPress?: () => void;
}

/**
 * Floating action button — M3 primary-container circle (or extended pill)
 * over layered elevation, floating bottom-right by convention.
 */
export function FAB(props: FabProps): WidgetNode {
  const size = props.size ?? 104;
  const glyphSize = Math.round(size * 0.4);
  const label = props.label;
  const w = label ? textWidth(label, 17) + size + 40 : size;
  const h = size;
  return canvasBox({
    width: w,
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const bg = props.color ?? C.primaryContainer;
      const fg = C.onPrimaryContainer;
      softShadow(put, 0, 0, w, h, h / 2, 2);
      put({ op: "rect", x: 0, y: 0, w, h, r: h / 2, color: bg });
      if (label) {
        // Shared baseline for glyph + label (M3 extended FAB centers both).
        const baseline = h / 2 + 17 * 0.36;
        put({ op: "text", x: 32, y: baseline, text: props.glyph, size: glyphSize, weight: 600, color: fg });
        put({ op: "text", x: 32 + glyphSize + 14, y: baseline, text: label, size: 17, weight: 600, color: fg });
      } else {
        centerText(put, origin, props.glyph, h / 2, glyphSize, 600, fg);
      }
      if (props.onPress) tap({ x: 0, y: 0, w, h }, props.onPress);
    },
  });
}

/** ---------- Checkbox ---------- */

export interface CheckboxProps {
  checked: boolean;
  onToggle?: (next: boolean) => void;
  label?: string;
}

/** M3 checkbox: primary fill with a check mark when on, outlined when off. */
export function Checkbox(props: CheckboxProps): WidgetNode {
  const size = 40;
  const box = canvasBox({
    width: size,
    height: size,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      if (props.checked) {
        put({ op: "rect", x: 0, y: 0, w: size, h: size, r: 9, color: C.primary });
        centerText(put, origin, "✓", size / 2, 24, 700, C.onPrimary);
      } else {
        put({ op: "outline", x: 0, y: 0, w: size, h: size, r: 9, color: C.outline, width: 3 });
      }
      if (props.onToggle) {
        const next = !props.checked;
        tap({ x: 0, y: 0, w: size, h: size }, () => props.onToggle!(next));
      }
    },
  });
  if (!props.label) return box;
  return (
    <Row gap="sm" align="center">
      {box}
      <Text variant="body" color={C.onSurface}>{props.label}</Text>
    </Row>
  );
}

/** ---------- Slider ---------- */

export interface SliderProps {
  /** 0..1 position. */
  value: number;
  onChange?: (value: number) => void;
}

/**
 * M3 slider: thin inactive track, thick active track, and a vertical bar
 * handle with a gap on either side. The tap contract delivers hit regions
 * rather than pointer coordinates, so value-setting is exposed as BUCKETS
 * slices across the track, each committing its center fraction — finger-
 * sized targets at the 720-unit design width.
 */
const SLIDER_BUCKETS = 24;

export function Slider(props: SliderProps): WidgetNode {
  const h = 48;
  const value = Math.max(0, Math.min(1, props.value));
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const cy = h / 2;
      const handleX = Math.min(Math.max(origin.w * value, 12), origin.w - 12);
      put({ op: "rect", x: 0, y: cy - 4, w: origin.w, h: 8, r: 4, color: C.surfaceContainerHigh });
      if (handleX > 16) {
        put({ op: "rect", x: 0, y: cy - 6, w: handleX - 10, h: 12, r: 6, color: C.primary });
      }
      put({ op: "rect", x: handleX - 5, y: cy - 18, w: 10, h: 36, r: 5, color: C.primary });
      if (props.onChange) {
        const slice = origin.w / SLIDER_BUCKETS;
        for (let i = 0; i < SLIDER_BUCKETS; i++) {
          const target = (i + 0.5) / SLIDER_BUCKETS;
          tap({ x: i * slice, y: 0, w: slice, h }, () => props.onChange!(target));
        }
      }
    },
  });
}

/** ---------- TrackBar ---------- */

export interface TrackBarProps {
  /** 0..1 playback position. */
  ratio: number;
  /** Tapping anywhere on the bar seeks to that fraction. */
  onSeek?: (ratio: number) => void;
}

/**
 * Media seek bar: rounded track, filled progress, knob. Same BUCKETS tap
 * contract as Slider — 24 slices on a 720-unit design width is a 30-unit
 * target, comfortably finger-sized.
 */
const SEEK_BUCKETS = 24;

export function TrackBar(props: TrackBarProps): WidgetNode {
  const h = 28;
  const ratio = Math.max(0, Math.min(1, props.ratio));
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const cy = h / 2;
      put({ op: "rect", x: 0, y: cy - 4, w: origin.w, h: 8, r: 4, color: KIT.track });
      if (ratio > 0) {
        put({ op: "rect", x: 0, y: cy - 4, w: Math.max(origin.w * ratio, 8), h: 8, r: 4, color: C.primary });
      }
      put({ op: "circle", cx: Math.min(origin.w * ratio, origin.w - 10), cy, r: 10, color: C.onPrimaryFixed });
      if (props.onSeek) {
        const slice = origin.w / SEEK_BUCKETS;
        for (let i = 0; i < SEEK_BUCKETS; i++) {
          const target = (i + 0.5) / SEEK_BUCKETS;
          tap({ x: i * slice, y: 0, w: slice, h }, () => props.onSeek!(target));
        }
      }
    },
  });
}

/** ---------- Tabs ---------- */

export interface TabsProps {
  tabs: ReadonlyArray<string>;
  active: number;
  onSelect?: (index: number) => void;
}

/**
 * M3 primary tabs: equal-width columns, bold primary label on the active
 * tab, and a rounded secondary indicator pill hugging the active label.
 */
export function Tabs(props: TabsProps): WidgetNode {
  const h = 64;
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const each = origin.w / props.tabs.length;
      props.tabs.forEach((tab, index) => {
        const activeTab = index === props.active;
        const size = 17;
        const weight = activeTab ? 700 : 500;
        const tabColor = activeTab ? C.primary : C.onSurfaceVariant;
        const x0 = index * each;
        centerInSpan(put, tab, x0, each, 26, size, weight, tabColor);
        if (activeTab) {
          const labelW = textWidth(tab, size);
          put({
            op: "rect",
            x: x0 + (each - labelW) / 2 - 12,
            y: h - 12,
            w: labelW + 24,
            h: 6,
            r: 3,
            color: C.secondaryContainer,
          });
        }
        if (props.onSelect) {
          tap({ x: x0, y: 0, w: each, h }, () => props.onSelect!(index));
        }
      });
    },
  });
}

/** ---------- NavigationBar ---------- */

export interface NavigationBarItem {
  glyph: string;
  label: string;
}

export interface NavigationBarProps {
  items: ReadonlyArray<NavigationBarItem>;
  active: number;
  onSelect?: (index: number) => void;
}

/**
 * M3 bottom navigation: surface container bar; the active icon sits in a
 * secondary-container pill with a label beneath, inactive items stay
 * muted. Fixed to the bottom edge by the consuming Scaffold layout.
 */
export function NavigationBar(props: NavigationBarProps): WidgetNode {
  const h = 104;
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      put({ op: "rect", x: -40, y: 0, w: origin.w + 80, h, r: 0, color: C.surfaceContainer });
      put({ op: "line", x1: -40, y1: 0, x2: origin.w + 40, y2: 0, color: C.outlineVariant, width: 2 });
      const each = origin.w / props.items.length;
      props.items.forEach((item, index) => {
        const active = index === props.active;
        const cx = index * each + each / 2;
        if (active) {
          put({ op: "rect", x: cx - 40, y: 12, w: 80, h: 56, r: 28, color: C.secondaryContainer });
        }
        put({
          op: "text",
          x: cx - textWidth(item.glyph, 30) / 2,
          y: 46,
          text: item.glyph,
          size: 30,
          weight: 600,
          color: active ? C.onSecondaryContainer : C.onSurfaceVariant,
        });
        put({
          op: "text",
          x: cx - textWidth(item.label, 13) / 2,
          y: 84,
          text: item.label,
          size: 13,
          weight: active ? 700 : 500,
          color: active ? C.onSurface : C.onSurfaceVariant,
        });
        if (props.onSelect) {
          tap({ x: index * each, y: 0, w: each, h }, () => props.onSelect!(index));
        }
      });
    },
  });
}

/** ---------- Badge ---------- */

export interface BadgeProps {
  /** Number to show; a small dot when omitted. */
  count?: number;
  color?: string;
}

/** Notification badge — a dot, or a count capsule. */
export function Badge(props: BadgeProps = {}): WidgetNode {
  const color = props.color ?? C.error;
  return canvasBox({
    width: props.count === undefined ? 16 : 36,
    height: props.count === undefined ? 16 : 36,
    paint: (origin, put, _tap, pal) => {
      const C = pal;
      if (props.count === undefined) {
        put({ op: "circle", cx: 8, cy: 8, r: 7, color });
        return;
      }
      put({ op: "circle", cx: 18, cy: 18, r: 18, color });
      centerText(put, origin, props.count > 99 ? "99+" : String(props.count), 18, 19, 700, C.onPrimary);
    },
  });
}

/** ---------- SnackBar ---------- */

export interface SnackBarProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * M3 snack bar: an elevated inverse-surface pill with the message and an
 * optional action. Rendering and dismissal belong to the screen state.
 */
export function SnackBar(props: SnackBarProps): WidgetNode {
  const h = 88;
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      softShadow(put, 0, 0, origin.w, h, 16, 2);
      put({ op: "rect", x: 0, y: 0, w: origin.w, h, r: 16, color: C.inverseSurface });
      const actionW = props.actionLabel ? textWidth(props.actionLabel, 17) + 48 : 0;
      const messageW = origin.w - actionW - 64;
      const lines = wrapText(props.message, 16, messageW);
      const first = lines[0] ?? props.message;
      put({ op: "text", x: 32, y: h / 2 + 16 * 0.36, text: first, size: 16, weight: 400, color: C.onSurface });
      if (props.actionLabel) {
        put({
          op: "text",
          x: origin.w - actionW + 8,
          y: h / 2 + 17 * 0.36,
          text: props.actionLabel,
          size: 17,
          weight: 700,
          color: C.primary,
        });
        if (props.onAction) {
          tap({ x: origin.w - actionW, y: 0, w: actionW, h }, props.onAction);
        }
      }
    },
  });
}

/** ---------- TextField ---------- */

export interface TextFieldProps {
  label: string;
  value?: string;
  focused?: boolean;
  /** Tapping toggles the focus ring (prototype stand-in for real focus). */
  onFocusChange?: (focused: boolean) => void;
  leading?: string;
}

/**
 * M3 outlined text field: hairline border that turns primary and thickens
 * while focused; the label floats onto the border once editing starts or
 * a value is present.
 */
export function TextField(props: TextFieldProps): WidgetNode {
  const h = 88;
  const size = 17;
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const floating = props.focused || (props.value ?? "").length > 0;
      put({ op: "outline", x: 0, y: 0, w: origin.w, h, r: 16, color: props.focused ? C.primary : C.outlineVariant, width: props.focused ? 4 : 2 });
      const textX = props.leading ? 76 : 28;
      if (props.leading) {
        put({ op: "text", x: 28, y: h / 2 + 22 * 0.36, text: props.leading, size: 22, weight: 600, color: C.onSurfaceVariant });
      }
      if (floating) {
        const labelW = textWidth(props.label, 13);
        // Border patch so the floating label sits ON the outline.
        put({ op: "rect", x: textX - 8, y: -1, w: labelW + 16, h: 3, r: 0, color: C.surface });
        put({ op: "text", x: textX, y: 13 * 0.9, text: props.label, size: 13, weight: 600, color: props.focused ? C.primary : C.onSurfaceVariant });
        if (props.value) {
          put({ op: "text", x: textX, y: h / 2 + size * 0.36, text: props.value, size, weight: 400, color: C.onSurface });
        }
      } else {
        put({ op: "text", x: textX, y: h / 2 + size * 0.36, text: props.label, size, weight: 400, color: C.onSurfaceVariant });
      }
      if (props.onFocusChange) {
        const next = !props.focused;
        tap({ x: 0, y: 0, w: origin.w, h }, () => props.onFocusChange!(next));
      }
    },
  });
}

/** ---------- SegmentedButton ---------- */

export interface SegmentedButtonProps {
  options: ReadonlyArray<string>;
  /** Index of the selected segment, or -1 for none. */
  selected: number;
  onSelect?: (index: number) => void;
}

/**
 * M3 segmented button: one outlined capsule divided into segments; the
 * selected segment fills with the secondary container and gains a check.
 */
export function SegmentedButton(props: SegmentedButtonProps): WidgetNode {
  const h = 60;
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const each = origin.w / props.options.length;
      put({ op: "outline", x: 0, y: 0, w: origin.w, h, r: h / 2, color: C.outlineVariant, width: 2 });
      props.options.forEach((option, index) => {
        const active = index === props.selected;
        const x0 = index * each;
        if (active) {
          put({ op: "rect", x: x0 + 4, y: 4, w: each - 8, h: h - 8, r: (h - 8) / 2, color: C.secondaryContainer });
        }
        if (index > 0) {
          put({ op: "line", x1: x0, y1: 12, x2: x0, y2: h - 12, color: C.outlineVariant, width: 2 });
        }
        const label = `${active ? "✓ " : ""}${option}`;
        centerInSpan(put, label, x0, each, h / 2, 16, active ? 700 : 500, active ? C.onSecondaryContainer : C.onSurfaceVariant);
        if (props.onSelect) {
          tap({ x: x0, y: 0, w: each, h }, () => props.onSelect!(index));
        }
      });
    },
  });
}

/** ---------- PageIndicator ---------- */

export interface PageIndicatorProps {
  count: number;
  active: number;
  color?: string;
  inactiveColor?: string;
  /** Tapping a dot jumps to that page. */
  onSelect?: (index: number) => void;
}

/**
 * M3 page indicator: equal dot slots where the active dot elongates into a
 * pill centered on its slot (the smooth_page_indicator "worm" look). Slots
 * stay fixed so the tap targets never move when the active page changes.
 */
export function PageIndicator(props: PageIndicatorProps): WidgetNode {
  const dot = 14;
  const gap = 12;
  const pill = 30;
  const w = props.count * dot + (props.count - 1) * gap;
  const h = dot;
  return canvasBox({
    width: w,
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const slice = w / props.count;
      for (let i = 0; i < props.count; i++) {
        const center = i * (dot + gap) + dot / 2;
        const activeDot = i === props.active;
        put({
          op: "rect",
          x: activeDot ? center - pill / 2 : center - dot / 2,
          y: 0,
          w: activeDot ? pill : dot,
          h: dot,
          r: dot / 2,
          color: activeDot
            ? props.color ?? C.primary
            : props.inactiveColor ?? C.surfaceContainerHigh,
        });
        if (props.onSelect) {
          tap({ x: i * slice, y: 0, w: slice, h }, () => props.onSelect!(i));
        }
      }
    },
  });
}

/** ---------- StarRating ---------- */

export interface StarRatingProps {
  /** 0..5, rounded to whole stars. */
  value: number;
  size?: number;
  color?: string;
  inactiveColor?: string;
}

/** Five-star rating row — filled count from value, dim ghosts for the rest. */
export function StarRating(props: StarRatingProps): WidgetNode {
  const size = props.size ?? 16;
  const gap = 4;
  const h = Math.round(size * 1.2);
  const stars = Math.max(0, Math.min(5, Math.round(props.value)));
  return canvasBox({
    width: 5 * size + 4 * gap,
    height: h,
    paint: (origin, put, _tap, pal) => {
      const C = pal;
      for (let i = 0; i < 5; i++) {
        put({
          op: "text",
          x: i * (size + gap),
          y: h / 2 + size * 0.36,
          text: "★",
          size,
          weight: 600,
          color: i < stars ? props.color ?? C.warning : props.inactiveColor ?? C.outline,
        });
      }
    },
  });
}

/** ---------- ModalDrawer ---------- */

export interface DrawerItem {
  glyph: string;
  label: string;
}

export interface ModalDrawerProps {
  open: boolean;
  items: ReadonlyArray<DrawerItem>;
  /** Index of the active destination, or -1 for none. */
  active: number;
  onSelect?: (index: number) => void;
  /** Tapping the scrim dismisses the drawer. */
  onDismiss?: () => void;
  /** Headline shown at the top of the panel. */
  heading?: string;
}

/**
 * M3 modal navigation drawer as a zero-height overlay anchor: place it as
 * the LAST child of a screen body so its ops paint after everything (paint
 * order is z-order) and its tap regions register after all content — with
 * the hosts' topmost-region-wins hit test, the scrim safely swallows taps
 * that would otherwise reach the covered content. The paint compensates
 * the anchor's absolute origin, so the overlay always covers the whole
 * scene from its top-left, wherever the anchor sits in the tree. The
 * panel is the M3 480-unit drawer: surface-container fill, a headline,
 * and destination rows where the active item wears the
 * secondary-container pill.
 */
export function ModalDrawer(props: ModalDrawerProps): WidgetNode {
  if (!props.open) return canvasBox({ height: 0, paint: () => undefined });
  const itemH = 76;
  const headingH = 108;
  const panelW = 480;
  return canvasBox({
    height: 0,
    fixed: true,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      // Fixed canvas coordinates are already viewport-relative. The host
      // clips the full-height drawer to the visible viewport.
      const dx = 0;
      const dy = 0;
      const at = (x: number, y: number): { x: number; y: number } => ({ x, y });
      // Scrim over the whole visible viewport. Fixed ops are clipped by the
      // host, so the generous height remains safe on tall devices.
      put({ op: "rect", ...at(-80, 0), w: origin.w + 160, h: 3200, r: 0, color: "#8C000000", fixed: true });
      if (props.onDismiss) {
        tap({ x: dx + panelW, y: dy, w: origin.w - panelW + 160, h: 3200, fixed: true }, props.onDismiss);
      }
      // Panel: full-height slab with a hairline leading edge.
      put({ op: "rect", ...at(0, 0), w: panelW, h: 3200, r: 0, color: C.surfaceContainer, fixed: true });
      put({ op: "outline", ...at(0, 0), w: panelW, h: 3200, r: 0, color: C.outlineVariant, width: 2, fixed: true });
      put({
        op: "text",
        ...at(40, 64),
        text: props.heading ?? "Menu",
        size: 30,
        weight: 700,
        color: C.onSurface,
        fixed: true,
      });
      props.items.forEach((item, index) => {
        const top = headingH + index * itemH;
        const active = index === props.active;
        if (active) {
          put({ op: "rect", ...at(24, top + 6), w: panelW - 48, h: itemH - 12, r: (itemH - 12) / 2, color: C.secondaryContainer, fixed: true });
        }
        put({
          op: "text",
          ...at(52, top + itemH / 2 + 24 * 0.36),
          text: item.glyph,
          size: 24,
          weight: 600,
          color: active ? C.onSecondaryContainer : C.onSurfaceVariant,
          fixed: true,
        });
        put({
          op: "text",
          ...at(112, top + itemH / 2 + 17 * 0.36),
          text: item.label,
          size: 17,
          weight: active ? 700 : 500,
          color: active ? C.onSecondaryContainer : C.onSurfaceVariant,
          fixed: true,
        });
        if (props.onSelect) {
          tap({ x: dx, y: dy + top, w: panelW, h: itemH, fixed: true }, () => props.onSelect!(index));
        }
      });
    },
  });
}

/** ---------- SearchBar ---------- */

export interface SearchBarProps {
  /** Placeholder hint inside the pill. */
  hint: string;
  /** Trailing avatar initials or glyph. */
  avatar?: string;
  onTap?: () => void;
}

/**
 * M3 search bar: a full-pill tonal container with a leading magnifier,
 * hint, and trailing avatar — the docked-search anatomy from the M3 spec.
 */
export function SearchBar(props: SearchBarProps): WidgetNode {
  const h = 72;
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      put({ op: "rect", x: 0, y: 0, w: origin.w, h, r: h / 2, color: C.surfaceContainerHigh });
      put({
        op: "text",
        x: 28,
        y: h / 2 + 24 * 0.36,
        text: "🔍",
        size: 24,
        weight: 400,
        color: C.onSurfaceVariant,
      });
      put({
        op: "text",
        x: 76,
        y: h / 2 + 17 * 0.36,
        text: props.hint,
        size: 17,
        weight: 400,
        color: C.onSurfaceVariant,
      });
      if (props.avatar) {
        put({ op: "circle", cx: origin.w - 36, cy: h / 2, r: 20, color: C.primaryContainer });
        put({
          op: "text",
          x: origin.w - 36 - textWidth(props.avatar, 15) / 2,
          y: h / 2 + 15 * 0.36,
          text: props.avatar,
          size: 15,
          weight: 700,
          color: C.onPrimaryContainer,
        });
      }
      if (props.onTap) tap({ x: 0, y: 0, w: origin.w, h }, props.onTap);
    },
  });
}

/** ---------- ModalBottomSheet ---------- */

export interface SheetOption {
  glyph: string;
  label: string;
  selected?: boolean;
}

export interface ModalBottomSheetProps {
  open: boolean;
  title?: string;
  options: ReadonlyArray<SheetOption>;
  onToggle?: (index: number) => void;
  confirmLabel?: string;
  onConfirm?: () => void;
  /** Tapping the scrim dismisses the sheet. */
  onDismiss?: () => void;
}

/**
 * M3 modal bottom sheet — the same overlay-anchor contract as
 * ModalDrawer: place it last so it paints (and hit-tests) above all
 * content, compensating its absolute origin to cover the scene. Anatomy:
 * scrim, surface sheet with 28-unit top corners, drag handle pill, title,
 * option rows with the M3 checkbox look, and a full-width confirm pill.
 */
export function ModalBottomSheet(props: ModalBottomSheetProps): WidgetNode {
  if (!props.open) return canvasBox({ height: 0, paint: () => undefined });
  const rowH = 72;
  const headH = 96;
  const actionsH = props.confirmLabel ? 108 : 24;
  const sheetH = headH + props.options.length * rowH + actionsH;
  const r = 28;
  return canvasBox({
    height: 0,
    fixed: true,
    anchor: "bottom",
    anchorSize: sheetH,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const dx = 0;
      const dy = 0;
      const at = (x: number, y: number): { x: number; y: number } => ({ x, y });
      // Tap layering under topmost-wins hosts: a full-scene containment
      // region first, the dismiss scrim over it, then rows and confirm —
      // so gaps (handle, title) swallow taps instead of letting covered
      // content receive them.
      const noop = (): void => undefined;
      tap({ x: dx, y: dy, w: origin.w, h: 3200, fixed: true }, noop);
      // Scrim above the sheet dismisses. The anchored sheet containment below
      // wins over this region for taps inside the sheet itself.
      put({ op: "rect", ...at(-80, 0), w: origin.w + 160, h: 3200, r: 0, color: "#8C000000", fixed: true });
      if (props.onDismiss) {
        // The scrim is a top-anchored viewport region; the sheet containment
        // and rows below are independently bottom-anchored.
        tap({ x: dx, y: dy, w: origin.w, h: 3200 - sheetH, fixed: true }, props.onDismiss);
      }
      // The host resolves bottom anchoring against the visible viewport.
      const sheetTop = 0;
      put({ op: "rect", ...at(0, sheetTop), w: origin.w, h: sheetH, r, color: C.surfaceContainer, fixed: true, anchor: "bottom", anchorSize: sheetH });
      // Drag handle.
      put({ op: "rect", ...at((origin.w - 64) / 2, sheetTop + 20), w: 64, h: 6, r: 3, color: C.outlineVariant, fixed: true, anchor: "bottom", anchorSize: sheetH });
      if (props.title) {
        put({
          op: "text",
          ...at(32, sheetTop + 76),
          text: props.title,
          size: 22,
          weight: 600,
          color: C.onSurface,
          fixed: true,
          anchor: "bottom",
          anchorSize: sheetH,
        });
      }
      props.options.forEach((option, index) => {
        const top = sheetTop + headH + index * rowH;
        const box = 40;
        const selected = option.selected === true;
        if (selected) {
          put({ op: "rect", ...at(32, top + (rowH - box) / 2), w: box, h: box, r: 9, color: C.primary, fixed: true, anchor: "bottom", anchorSize: sheetH });
          put({
            op: "text",
            ...at(32 + (box - textWidth("✓", 24)) / 2, top + (rowH - box) / 2 + box / 2 + 24 * 0.36 - 12),
            text: "✓",
            size: 24,
            weight: 700,
            color: C.onPrimary,
            fixed: true,
            anchor: "bottom",
            anchorSize: sheetH,
          });
        } else {
          put({
            op: "outline",
            ...at(32, top + (rowH - box) / 2),
            w: box,
            h: box,
            r: 9,
            color: C.outline,
            width: 3,
            fixed: true,
            anchor: "bottom",
            anchorSize: sheetH,
          });
        }
        put({
          op: "text",
          ...at(96, top + rowH / 2 + 17 * 0.36),
          text: `${option.glyph}  ${option.label}`,
          size: 17,
          weight: selected ? 700 : 500,
          color: selected ? C.onSurface : C.onSurfaceVariant,
          fixed: true,
          anchor: "bottom",
          anchorSize: sheetH,
        });
        if (props.onToggle) {
          tap({ x: dx, y: dy + top, w: origin.w, h: rowH, fixed: true, anchor: "bottom", anchorSize: sheetH }, () => props.onToggle!(index));
        }
      });
      if (props.confirmLabel && props.onConfirm) {
        const btnTop = sheetTop + sheetH - actionsH + 8;
        put({ op: "rect", ...at(24, btnTop), w: origin.w - 48, h: 64, r: 32, color: C.primary, fixed: true, anchor: "bottom", anchorSize: sheetH });
        put({
          op: "text",
          ...at((origin.w - textWidth(props.confirmLabel, 17)) / 2, btnTop + 32 + 17 * 0.36),
          text: props.confirmLabel,
          size: 17,
          weight: 600,
          color: C.onPrimary,
          fixed: true,
          anchor: "bottom",
          anchorSize: sheetH,
        });
        tap({ x: dx + 24, y: dy + btnTop, w: origin.w - 48, h: 64, fixed: true, anchor: "bottom", anchorSize: sheetH }, props.onConfirm);
      }
    },
  });
}

/** ---------- AlertDialog ---------- */

export interface AlertDialogProps {
  open: boolean;
  glyph?: string;
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm?: () => void;
  dismissLabel?: string;
  /** Scrim/empty areas dismiss. */
  onDismiss?: () => void;
}

/**
 * M3 basic dialog: scrim, centered 560-unit card with a 48-unit glyph in
 * a secondary-container circle, headline, body, and a confirm/dismiss
 * text-button row. Overlay-anchor contract like ModalDrawer.
 */
export function AlertDialog(props: AlertDialogProps): WidgetNode {
  if (!props.open) return canvasBox({ height: 0, paint: () => undefined });
  const w = 560;
  const h = props.glyph ? 416 : 344;
  return canvasBox({
    height: 0,
    fixed: true,
    anchor: "center",
    anchorSize: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const dx = 0;
      const dy = 0;
      const at = (x: number, y: number): { x: number; y: number } => ({ x, y });
      // Layering: dismiss scrim first (tap-outside dismisses), then a
      // card-sized containment region over it, then the buttons — topmost
      // registration wins, so the card body never falls through.
      put({ op: "rect", ...at(-80, 0), w: origin.w + 160, h: 3200, r: 0, color: "#99000000", fixed: true });
      const noop: () => void = (): void => undefined;
      const x0 = (origin.w - w) / 2;
      const y0 = 0;
      if (props.onDismiss) {
        tap({ x: dx, y: dy, w: origin.w, h: 3200, fixed: true }, props.onDismiss);
      }
      tap({ x: dx + x0, y: dy + y0, w, h: h + 24, fixed: true, anchor: "center", anchorSize: h }, noop);
      // Layered elevation in scene-compensated coordinates (same look as
      // softShadow, kept consistent with the at() translation).
      put({ op: "rect", ...at(x0 - 6, y0 + 4), w: w + 12, h: h + 12, r: 34, color: "#22000000", fixed: true, anchor: "center", anchorSize: h });
      put({ op: "rect", ...at(x0 - 3, y0 + 2), w: w + 6, h: h + 7, r: 31, color: "#44000000", fixed: true, anchor: "center", anchorSize: h });
      put({ op: "rect", ...at(x0, y0), w, h, r: 28, color: C.surfaceContainerHigh, fixed: true, anchor: "center", anchorSize: h });
      let cursor = y0 + 40;
      if (props.glyph) {
        put({
          op: "circle",
          cx: dx + origin.w / 2,
          cy: dy + cursor + 48,
          r: 48,
          color: C.secondaryContainer,
          fixed: true,
          anchor: "center",
          anchorSize: h,
        });
        put({
          op: "text",
          ...at((origin.w - textWidth(props.glyph, 40)) / 2, cursor + 48 + 40 * 0.36),
          text: props.glyph,
          size: 40,
          weight: 600,
          color: C.onSecondaryContainer,
          fixed: true,
          anchor: "center",
          anchorSize: h,
        });
        cursor += 128;
      }
      put({
        op: "text",
        ...at((origin.w - textWidth(props.title, 24)) / 2, cursor + 24 * 0.36),
        text: props.title,
        size: 24,
        weight: 600,
          color: C.onSurface,
          fixed: true,
          anchor: "center",
          anchorSize: h,
        });
      cursor += 56;
      if (props.body) {
        const lines = wrapText(props.body, 15, w - 96);
        lines.forEach((line, index) => {
          put({
            op: "text",
            ...at((origin.w - textWidth(line, 15)) / 2, cursor + index * 22 + 15 * 0.36),
            text: line,
            size: 15,
            weight: 400,
            color: C.onSurfaceVariant,
            fixed: true,
            anchor: "center",
            anchorSize: h,
          });
        });
        cursor += lines.length * 22 + 16;
      }
      const by = y0 + h - 88;
      const half = w / 2 - 12;
      if (props.dismissLabel) {
        const lx = x0 + 24;
        put({
          op: "text",
          ...at(lx + (half - textWidth(props.dismissLabel, 17)) / 2, by + 17 * 0.36),
          text: props.dismissLabel,
          size: 17,
          weight: 600,
          color: C.primary,
          fixed: true,
          anchor: "center",
          anchorSize: h,
        });
        if (props.onDismiss) {
          tap({ x: dx + lx, y: dy + by - 12, w: half, h: 64, fixed: true, anchor: "center", anchorSize: h }, props.onDismiss);
        }
      }
      if (props.confirmLabel && props.onConfirm) {
        const rx = x0 + w - 24 - half;
        put({
          op: "text",
          ...at(rx + (half - textWidth(props.confirmLabel, 17)) / 2, by + 17 * 0.36),
          text: props.confirmLabel,
          size: 17,
          weight: 600,
          color: C.primary,
          fixed: true,
          anchor: "center",
          anchorSize: h,
        });
        tap({ x: dx + rx, y: dy + by - 12, w: half, h: 64, fixed: true, anchor: "center", anchorSize: h }, props.onConfirm);
      }
    },
  });
}

/** ---------- Carousel ---------- */

export interface CarouselItem {
  glyph: string;
  title: string;
  subtitle: string;
  tint: string;
}

export interface CarouselProps {
  items: ReadonlyArray<CarouselItem>;
  /** Index of the hero (large) item; others follow with wrap-around. */
  active: number;
  onSelect?: (index: number) => void;
  onCycle?: (direction: 1 | -1) => void;
}

/**
 * M3 hero carousel: one 372-unit hero card with smaller peeking cards
 * beside it (the "varying-height" carousel layout). Chevrons cycle the
 * hero; tapping a peek card promotes it. Height fixed at 420.
 */
export function Carousel(props: CarouselProps): WidgetNode {
  const h = 420;
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      const count = props.items.length;
      if (count === 0) return;
      const order = Array.from({ length: count }, (_, i) => (props.active + i) % count);
      // Hero: 372 wide, vertically centered; then two shrinking peeks.
      const heroW = 372;
      const heroH = h;
      const hero = order[0]!;
      const drawCard = (
        item: CarouselItem,
        x: number,
        y: number,
        w: number,
        cardH: number,
        index: number,
        isHero: boolean
      ): void => {
        put({ op: "rect", x, y, w, h: cardH, r: 24, color: item.tint, ...(isHero ? { shadow: 8 } : {}) });
        put({ op: "circle", cx: x + w / 2, cy: y + cardH * 0.38, r: Math.min(w, cardH) * 0.22, color: "#14FFFFFF" });
        put({
          op: "text",
          x: x + (w - textWidth(item.glyph, Math.round(Math.min(w, cardH) * 0.28))) / 2,
          y: y + cardH * 0.38 + Math.min(w, cardH) * 0.28 * 0.36,
          text: item.glyph,
          size: Math.round(Math.min(w, cardH) * 0.28),
          weight: 600,
          color: "#FFFFFF",
        });
        put({
          op: "text",
          x: x + 24,
          y: y + cardH - 96,
          text: item.title,
          size: isHero ? 22 : 17,
          weight: 700,
          color: "#FFFFFF",
        });
        const sub = wrapText(item.subtitle, isHero ? 15 : 13, w - 48);
        put({
          op: "text",
          x: x + 24,
          y: y + cardH - 62,
          text: sub[0] ?? "",
          size: isHero ? 15 : 13,
          weight: 400,
          color: "#C0FFFFFF",
        });
        if (isHero && props.onCycle) {
          // Chevron pills overlapping the hero edges: back on the left,
          // forward on the right.
          put({ op: "circle", cx: x + 16, cy: y + cardH / 2, r: 28, color: "#B31C1C24" });
          put({ op: "text", x: x + 16 - textWidth("‹", 30) / 2, y: y + cardH / 2 + 30 * 0.36, text: "‹", size: 30, weight: 700, color: "#FFFFFF" });
          tap({ x: x - 12, y: y + cardH / 2 - 44, w: 56, h: 88 }, () => props.onCycle!(-1));
          put({ op: "circle", cx: x + heroW - 16, cy: y + cardH / 2, r: 28, color: "#B31C1C24" });
          put({ op: "text", x: x + heroW - 16 - textWidth("›", 30) / 2, y: y + cardH / 2 + 30 * 0.36, text: "›", size: 30, weight: 700, color: "#FFFFFF" });
          tap({ x: x + heroW - 44, y: y + cardH / 2 - 44, w: 56, h: 88 }, () => props.onCycle!(1));
        }
        if (props.onSelect && !isHero) {
          tap({ x, y, w, h: cardH }, () => props.onSelect!(index));
        }
      };
      drawCard(props.items[hero]!, 0, 0, heroW, heroH, hero, true);
      let x = heroW + 16;
      const peeks = Math.max(0, Math.floor((origin.w - heroW - 16) / 200));
      for (let p = 1; p <= Math.min(peeks, count - 1); p++) {
        const idx = order[p]!;
        const pw = Math.max(184, origin.w - x);
        const ph = h - p * 64;
        drawCard(props.items[idx]!, x, (h - ph) / 2, pw, ph, idx, false);
        x += pw + 16;
      }
    },
  });
}

/** ---------- Sparkline ---------- */

export interface SparklineProps {
  data: ReadonlyArray<number>;
  width?: number;
  height?: number;
  color?: string;
  /** Dots at the last point. */
  dot?: boolean;
}

/** Compact line chart drawn as N-1 line segments, normalized to the box. */
export function Sparkline(props: SparklineProps): WidgetNode {
  const height = props.height ?? 44;
  return canvasBox({
    width: props.width,
    height,
    paint: (origin, put, _tap, pal) => {
      const C = pal;
      const color = props.color ?? C.success;
      const data = props.data;
      if (data.length < 2) return;
      const min = Math.min(...data);
      const max = Math.max(...data);
      const span = max - min || 1;
      const point = (i: number): { x: number; y: number } => ({
        x: (i / (data.length - 1)) * origin.w,
        y: 4 + (1 - (data[i]! - min) / span) * (height - 8),
      });
      for (let i = 0; i < data.length - 1; i++) {
        const a = point(i);
        const b = point(i + 1);
        put({ op: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, width: 3 });
      }
      if (props.dot) {
        const last = point(data.length - 1);
        put({ op: "circle", cx: last.x, cy: last.y, r: 4, color });
      }
    },
  });
}

/** ---------- ListTile ---------- */

export interface ListTileProps {
  leading?: WidgetNode;
  title: string;
  subtitle?: string;
  trailing?: WidgetNode | null;
  background?: string;
  /** Elevated cards carry layered elevation; outlined draw a hairline. */
  variant?: "filled" | "elevated" | "outlined";
}

/**
 * Material-style list row: leading avatar, title/subtitle column, trailing
 * control, inside a raised card with an M3 variant.
 */
export function ListTile(props: ListTileProps): WidgetNode {
  const variant = props.variant ?? "filled";
  const titleRow = props.subtitle ? (
    <Column gap="xs">
      <Text variant="title">{props.title}</Text>
      <Text variant="body" color={C.onSurfaceVariant}>{props.subtitle}</Text>
    </Column>
  ) : (
    <Text variant="title">{props.title}</Text>
  );
  const left = props.leading ? (
    <Row gap="sm">
      {props.leading}
      {titleRow}
    </Row>
  ) : (
    titleRow
  );
  return (
    <Card
      padding="md"
      radius="md"
      background={props.background ?? (variant === "outlined" ? "surface" : "surfaceRaised")}
      elevation={variant === "elevated"}
    >
      <Row gap="sm" justify="between">
        {left}
        {props.trailing ?? null}
      </Row>
    </Card>
  );
}

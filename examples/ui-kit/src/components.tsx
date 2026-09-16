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
  white: KIT.white,
} as const;

interface CanvasBoxProps {
  width?: number;
  height: number;
  paint: (
    origin: { x: number; y: number; w: number },
    put: (op: DisplayOp) => void,
    tap: (region: { x: number; y: number; w: number; h: number }, run: () => void) => void
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
    paint: (origin, put) => {
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
    paint: (origin, put) => {
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
    paint: (origin, put, tap) => {
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
    paint: (origin, put, tap) => {
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
    paint: (origin, put) => {
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
    paint: (origin, put) => {
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
    paint: (origin, put) => {
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
  const fill = props.mine ? C.primary : "#262631";
  const textColor = props.mine ? C.onPrimary : C.onSurface;
  return canvasBox({
    width: w,
    height: h,
    paint: (origin, put) => {
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
  const tint = props.color ?? (variant === "filled" ? C.primary : C.primary);
  return canvasBox({
    width: size,
    height: size,
    paint: (origin, put, tap) => {
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
  const bg = props.color ?? C.primaryContainer;
  const fg = C.onPrimaryContainer;
  const label = props.label;
  const w = label ? textWidth(label, 17) + size + 40 : size;
  const h = size;
  return canvasBox({
    width: w,
    height: h,
    paint: (origin, put, tap) => {
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
    paint: (origin, put, tap) => {
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
    paint: (origin, put, tap) => {
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
    paint: (origin, put, tap) => {
      const cy = h / 2;
      put({ op: "rect", x: 0, y: cy - 4, w: origin.w, h: 8, r: 4, color: KIT.track });
      if (ratio > 0) {
        put({ op: "rect", x: 0, y: cy - 4, w: Math.max(origin.w * ratio, 8), h: 8, r: 4, color: C.primary });
      }
      put({ op: "circle", cx: Math.min(origin.w * ratio, origin.w - 10), cy, r: 10, color: C.white });
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
    paint: (origin, put, tap) => {
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
    paint: (origin, put, tap) => {
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
    paint: (origin, put) => {
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
    paint: (origin, put, tap) => {
      softShadow(put, 0, 0, origin.w, h, 16, 2);
      put({ op: "rect", x: 0, y: 0, w: origin.w, h, r: 16, color: "#2E2E3C" });
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
    paint: (origin, put, tap) => {
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
    paint: (origin, put, tap) => {
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
  const color = props.color ?? C.success;
  return canvasBox({
    width: props.width,
    height,
    paint: (origin, put) => {
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

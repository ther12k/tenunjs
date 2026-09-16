/**
 * UI kit — Flutter-style components for the TenunJS examples.
 *
 * Two component families:
 *  - composition components (ListTile) built from @tenunjs/widgets;
 *  - canvas components (Avatar, ProgressRing, Switch, Chip, Divider,
 *    ProgressBar, HeroCard) that draw through the virtual canvas kind —
 *    circles, arcs and gradients the host widgets cannot express yet.
 *
 * Canvas components never touch the HostWidgetKind ABI (the virtual symbol
 * follows the Fragment precedent), and their paint closures run at layout
 * time so the committed display list stays plain JSON data.
 */

import type { WidgetNode } from "@tenunjs/jsx-runtime";
import { Column, Card, Row, Text } from "@tenunjs/widgets";
import { Canvas, textWidth, wrapText, type DisplayOp } from "./display-list";

/** Gallery dark palette defaults, aligned with examples/gallery theme. */
const KIT = {
  surfaceRaised: "#1C1C24",
  text: "#F2F2F7",
  textMuted: "#9AA3B2",
  accent: "#4C8DFF",
  accentSoft: "#232F49",
  track: "#2A2A35",
  success: "#3DD68C",
  warning: "#F5A623",
  danger: "#FF5A5F",
  white: "#FFFFFF",
};

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
      put({ op: "circle", cx: r, cy: r, r, color: props.color ?? KIT.accentSoft });
      centerText(put, origin, props.label, r, Math.round(size * 0.38), 700, props.textColor ?? KIT.accent);
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
        color: props.color ?? KIT.accent,
        progress: pct,
        track: props.trackColor ?? KIT.track,
      });
      centerText(put, origin, label, size / 2 - (props.caption ? 8 : 0), 24, 700, KIT.text);
      if (props.caption) {
        centerText(put, origin, props.caption, size / 2 + 16, 13, 400, KIT.textMuted);
      }
    },
  });
}

/** ---------- Switch ---------- */

export interface SwitchProps {
  on: boolean;
  onChange?: (next: boolean) => void;
}

/** Pill toggle with a sliding knob — the whole pill is the tap target. */
export function Switch(props: SwitchProps): WidgetNode {
  const w = 56;
  const h = 32;
  return canvasBox({
    width: w,
    height: h,
    paint: (origin, put, tap) => {
      put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: props.on ? KIT.accent : KIT.track });
      put({
        op: "circle",
        cx: props.on ? w - 16 : 16,
        cy: h / 2,
        r: 12,
        color: props.on ? KIT.white : "#7A8194",
      });
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

/** Pill filter chip — filled when selected, outlined otherwise. */
export function Chip(props: ChipProps): WidgetNode {
  const h = 40;
  const size = 16;
  const w = Math.max(textWidth(props.label, size) + 40, 64);
  return canvasBox({
    width: w,
    height: h,
    paint: (origin, put, tap) => {
      if (props.selected) {
        put({ op: "rect", x: 0, y: 0, w, h, r: 20, color: KIT.accent });
      } else {
        put({ op: "outline", x: 0, y: 0, w, h, r: 20, color: KIT.accent, width: 2 });
      }
      centerText(put, origin, props.label, h / 2, size, 600, props.selected ? KIT.white : KIT.accent);
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
      put({ op: "line", x1: 0, y1: 0, x2: origin.w, y2: 0, color: props.color ?? "#2E2E3A", width: 1 });
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
}

/** Rounded linear bar — week steps, storage, any 0..max ratio. */
export function ProgressBar(props: ProgressBarProps): WidgetNode {
  const height = props.height ?? 10;
  return canvasBox({
    height,
    paint: (origin, put) => {
      put({ op: "rect", x: 0, y: 0, w: origin.w, h: height, r: height / 2, color: props.trackColor ?? KIT.track });
      const ratio = props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0;
      if (ratio > 0) {
        put({
          op: "rect",
          x: 0,
          y: 0,
          w: Math.max(origin.w * ratio, height),
          h: height,
          r: height / 2,
          color: props.color ?? KIT.accent,
        });
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
      put({
        op: "gradient",
        x: 0,
        y: 0,
        w: origin.w,
        h: height,
        r: 22,
        color: props.from ?? "#24345C",
        colorTo: props.to ?? "#141A2B",
        shadow: 14,
      });
      put({ op: "text", x: 24, y: 34, text: props.title, size: 15, weight: 600, color: KIT.textMuted });
      put({ op: "text", x: 24, y: 86, text: props.headline, size: 44, weight: 700, color: KIT.text });
      if (props.caption) {
        put({ op: "text", x: 24, y: 122, text: props.caption, size: 15, weight: 400, color: KIT.textMuted });
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
  const fill = props.mine ? KIT.accent : "#262631";
  const textColor = props.mine ? KIT.white : KIT.text;
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
  /** Filled circle (primary action) or outlined. */
  filled?: boolean;
  size?: number;
  glyphSize?: number;
  color?: string;
  onPress?: () => void;
}

/** Circular glyph button — media controls, icon actions. */
export function IconButton(props: IconButtonProps): WidgetNode {
  const size = props.size ?? 52;
  const glyphSize = props.glyphSize ?? Math.round(size * 0.42);
  const r = size / 2;
  return canvasBox({
    width: size,
    height: size,
    paint: (origin, put, tap) => {
      if (props.filled) {
        put({ op: "circle", cx: r, cy: r, r, color: props.color ?? KIT.accent });
      } else {
        put({ op: "outline", x: 2, y: 2, w: size - 4, h: size - 4, r: r - 2, color: props.color ?? KIT.accent, width: 3 });
      }
      centerText(put, origin, props.glyph, r, glyphSize, 600, props.filled ? KIT.white : (props.color ?? KIT.accent));
      if (props.onPress) tap({ x: 0, y: 0, w: size, h: size }, props.onPress);
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
 * Media seek bar: rounded track, filled progress, knob. The tap contract
 * delivers hit regions rather than pointer coordinates, so seek-to-position
 * is exposed as BUCKETS slices across the bar, each seeking to its center
 * fraction — 24 slices on a 720-unit design width is a 30-unit target,
 * comfortably finger-sized.
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
        put({ op: "rect", x: 0, y: cy - 4, w: Math.max(origin.w * ratio, 8), h: 8, r: 4, color: KIT.accent });
      }
      put({ op: "circle", cx: Math.min(origin.w * ratio, origin.w - 10), cy, r: 10, color: KIT.white });
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
  const color = props.color ?? KIT.success;
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
}

/**
 * Material-style list row: leading avatar, title/subtitle column, trailing
 * control, inside a raised card.
 */
export function ListTile(props: ListTileProps): WidgetNode {
  const titleRow = props.subtitle ? (
    <Column gap="xs">
      <Text variant="title">{props.title}</Text>
      <Text variant="body" color={KIT.textMuted}>{props.subtitle}</Text>
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
    <Card padding="md" radius="md" background={props.background ?? "surfaceRaised"}>
      <Row gap="sm" justify="between">
        {left}
        {props.trailing ?? null}
      </Row>
    </Card>
  );
}

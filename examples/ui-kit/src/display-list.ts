/**
 * Display-list engine — the shared rendering contract of the TenunJS UI kit.
 *
 * Walks a real @tenunjs/widgets tree (the same `view()` output the tests
 * mount) plus UI-kit canvas components and emits a flat display list that
 * every prototype host paints directly:
 *
 *   { tenun: "display-list", version: 1, designWidth, contentHeight,
 *     background, ops: [...], taps: [...] }
 *
 * Ops: "rect" (filled rounded rect, optional elevation shadow), "outline"
 * (stroked rounded rect), "text" (single line, y is the baseline), "circle"
 * (filled circle), "ring" (stroked progress arc), "line" (straight line),
 * "gradient" (vertical two-stop gradient rect). Taps are hit-test regions
 * whose payloads index back into the JS callback table rebuilt on every
 * render, so hosts stay dumb painter/dispatchers.
 *
 * UI-kit components draw through the virtual canvas node
 * (`Symbol.for("tenun.preview.canvas")`, the Fragment precedent: a virtual
 * kind that never touches the HostWidgetKind ABI — TN-034 owns that map).
 * Its paint closure runs at layout time and emits plain data ops, so the
 * committed scene stays JSON-serializable.
 *
 * Layout is deliberately simple (single-direction stacks, approximate text
 * metrics, word wrap, no clipping/multi-pass) — prototype-grade, not a
 * widget-host implementation.
 */

import type { WidgetChild, WidgetNode } from "@tenunjs/jsx-runtime";
import type { ThemeConfig } from "@tenunjs/widgets";

/** ---------- scene types ---------- */

export interface RectOp {
  op: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  color: string;
  /** Elevation 0..24: soft drop shadow painted under the rect. */
  shadow?: number;
}

export interface OutlineOp {
  op: "outline";
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  color: string;
  width: number;
}

export interface TextOp {
  op: "text";
  x: number;
  /** Baseline of the line. */
  y: number;
  text: string;
  size: number;
  weight: number;
  color: string;
  /** Horizontal alignment within [x, x + width) when width is given. */
  align?: "left" | "center";
  width?: number;
}

export interface CircleOp {
  op: "circle";
  cx: number;
  cy: number;
  r: number;
  color: string;
}

export interface RingOp {
  op: "ring";
  cx: number;
  cy: number;
  r: number;
  width: number;
  color: string;
  /** 0..1 swept from the 12 o'clock position clockwise. */
  progress: number;
  /** Optional full-circle track painted under the arc. */
  track?: string;
}

export interface LineOp {
  op: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface GradientOp {
  op: "gradient";
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  color: string;
  colorTo: string;
  shadow?: number;
}

export type DisplayOp = RectOp | OutlineOp | TextOp | CircleOp | RingOp | LineOp | GradientOp;

export interface SerializedTap {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
  payload: { id: number };
}

export interface DisplayListScene {
  tenun: "display-list";
  version: 1;
  designWidth: number;
  contentHeight: number;
  background: string;
  ops: DisplayOp[];
  taps: SerializedTap[];
}

export interface RenderContext {
  readonly theme: ThemeConfig;
  finish(): DisplayListScene;
}

interface InternalContext extends RenderContext {
  ops: DisplayOp[];
  tapRegions: SerializedTap[];
  tapRuns: Array<() => void>;
}

/**
 * Virtual canvas kind for UI-kit components (Fragment precedent: a virtual
 * symbol kind, never a HostWidgetKind value, so the TN-034 numeric ABI is
 * untouched).
 */
export const Canvas = Symbol.for("tenun.preview.canvas");

export interface CanvasProps {
  /** Explicit height; width comes from the parent layout unless fixed. */
  height: number;
  width?: number;
  /**
   * Paints relative to the canvas origin (0,0 = top-left of the box) and
   * may register tap regions through the same callback table as widgets.
   */
  paint: (
    origin: { x: number; y: number; w: number },
    put: (op: DisplayOp) => void,
    tap: (region: { x: number; y: number; w: number; h: number }, run: () => void) => void
  ) => void;
}

/** ---------- theme resolution ---------- */

const SPACING: Record<string, number> = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
const RADIUS: Record<string, number> = { sm: 8, md: 14, lg: 22 };

interface Typography {
  size: number;
  lineHeight: number;
  weight: number;
}

const TYPOGRAPHY: Record<string, Typography> = {
  body: { size: 17, lineHeight: 24, weight: 400 },
  title: { size: 22, lineHeight: 30, weight: 600 },
  display: { size: 44, lineHeight: 52, weight: 700 },
};

const DESIGN_WIDTH = 720;

function spacing(value: unknown, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value in SPACING) return SPACING[value]!;
  return fallback;
}

function radius(value: unknown, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value in RADIUS) return RADIUS[value]!;
  return fallback;
}

function color(theme: ThemeConfig, token: unknown, fallback: string): string {
  if (typeof token === "string") {
    if (token.startsWith("#")) return token;
    const named = theme.colors?.[token];
    if (typeof named === "string") return named;
  }
  return fallback;
}

function typography(variant: unknown): Typography {
  if (typeof variant === "string" && variant in TYPOGRAPHY) return TYPOGRAPHY[variant]!;
  return TYPOGRAPHY.body!;
}

/** ---------- text metrics (approximate, prototype-grade) ---------- */

const CHAR_WIDTH_FACTOR = 0.56;

export function textWidth(text: string, size: number): number {
  return text.length * size * CHAR_WIDTH_FACTOR;
}

/** Greedy word wrap against [maxWidth]; never returns an empty array. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (textWidth(candidate, size) <= maxWidth || current.length === 0) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** ---------- widget-tree helpers ---------- */

interface AnyNode {
  kind: unknown;
  props: Record<string, unknown>;
  children: readonly WidgetChild[];
}

function isWidgetNode(child: WidgetChild): child is WidgetNode {
  return typeof child === "object" && child !== null && "kind" in child;
}

function asNode(node: WidgetNode): AnyNode {
  return { kind: node.kind, props: node.props as Record<string, unknown>, children: node.children };
}

/** Concatenates string/number children (JSX text interpolation output). */
function textContent(node: AnyNode): string {
  return node.children
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
    .join("");
}

/** Direct widget children, dropping text (text children are leaf content). */
function widgetChildren(node: AnyNode): AnyNode[] {
  return node.children.filter(isWidgetNode).map(asNode);
}

/** Flattens string/number children into synthetic text nodes. */
function childNodes(node: AnyNode): AnyNode[] {
  const result: AnyNode[] = [];
  for (const child of node.children) {
    if (typeof child === "string" || typeof child === "number") {
      result.push({ kind: "text", props: {}, children: [child] });
    } else if (isWidgetNode(child)) {
      result.push(asNode(child));
    }
  }
  return result;
}

/**
 * Invokes a function-component node. buildNode moves `children` out of
 * props onto the node, so the call hands them back the way JSX would.
 */
function callComponent(node: AnyNode): AnyNode {
  const fn = node.kind as (props: Record<string, unknown>) => WidgetNode;
  return asNode(fn({ ...node.props, children: node.children }));
}

/** ---------- layout ---------- */

interface Frame {
  w: number;
  h: number;
}

function gapOf(props: Record<string, unknown>): number {
  return spacing(props.gap, 0);
}

function paddingOf(props: Record<string, unknown>, fallback: number): number {
  return spacing(props.padding, fallback);
}

function measure(ctx: InternalContext, node: AnyNode, maxWidth: number): Frame {
  const { kind, props } = node;
  if (typeof kind === "function") {
    return measure(ctx, callComponent(node), maxWidth);
  }
  if (kind === Canvas) {
    return { w: Math.min(typeof props.width === "number" ? props.width : maxWidth, maxWidth), h: Number(props.height ?? 0) };
  }
  // Fragments are the one other virtual kind (Symbol.for("tenun.fragment")):
  // a bare stack of children, no box of their own.
  if (typeof kind === "symbol") {
    return measureStack(ctx, node, maxWidth, 0, 0);
  }
  switch (kind) {
    case "text": {
      const ty = typography(props.variant);
      const lines = wrapText(textContent(node), ty.size, Math.max(maxWidth, 1));
      const widest = Math.max(...lines.map((line) => textWidth(line, ty.size)));
      return { w: Math.min(widest, maxWidth), h: lines.length * ty.lineHeight };
    }
    case "button": {
      const ty = TYPOGRAPHY.body!;
      const label = textContent(node) || "Button";
      const w = Math.min(maxWidth, Math.max(96, textWidth(label, ty.size) + 48));
      return { w, h: 56 };
    }
    case "card": {
      const pad = paddingOf(props, 16);
      return measureStack(ctx, node, Math.max(maxWidth - pad * 2, 1), pad, spacing("sm", 8));
    }
    case "column": {
      const pad = paddingOf(props, 0);
      return measureStack(ctx, node, Math.max(maxWidth - pad * 2, 1), pad, gapOf(props));
    }
    case "row": {
      const pad = paddingOf(props, 0);
      const inner = Math.max(maxWidth - pad * 2, 1);
      const kids = childNodes(node);
      let h = 0;
      for (const kid of kids) h = Math.max(h, measure(ctx, kid, inner).h);
      return { w: maxWidth, h: pad * 2 + h };
    }
    case "app-bar":
      return { w: maxWidth, h: 96 };
    case "spacer":
      return { w: 0, h: spacing(props.size, 16) };
    case "scaffold": {
      // Children arrive as function components (Scaffold/AppBar usage);
      // resolve before matching by host kind.
      const kids = widgetChildren(node).map((kid) =>
        typeof kid.kind === "function" ? callComponent(kid) : kid
      );
      const appBar = kids.find((kid) => kid.kind === "app-bar");
      const body = kids.find((kid) => kid.kind !== "app-bar");
      const appBarH = appBar ? measure(ctx, appBar, maxWidth).h : 0;
      const bodyH = body ? measure(ctx, body, maxWidth).h : 0;
      return { w: maxWidth, h: appBarH + bodyH };
    }
    default:
      return { w: 0, h: 0 };
  }
}

/** Measures a node whose children stack vertically (card/column/fragment). */
function measureStack(
  ctx: InternalContext,
  node: AnyNode,
  innerWidth: number,
  pad: number,
  gap: number
): Frame {
  const kids = childNodes(node);
  let h = pad * 2;
  let widest = 0;
  for (let i = 0; i < kids.length; i++) {
    const frame = measure(ctx, kids[i]!, innerWidth);
    h += frame.h + (i > 0 ? gap : 0);
    widest = Math.max(widest, frame.w);
  }
  return { w: Math.min(pad * 2 + widest, Math.max(pad * 2 + innerWidth, 0)), h };
}

/**
 * Places [node] at (x, y) with width [w] and emits its ops. Returns the
 * consumed height.
 */
function place(ctx: InternalContext, node: AnyNode, x: number, y: number, w: number): number {
  const { kind, props } = node;

  if (typeof kind === "function") {
    return place(ctx, callComponent(node), x, y, w);
  }
  if (kind === Canvas) {
    const width = Math.min(typeof props.width === "number" ? props.width : w, w);
    const height = Number(props.height ?? 0);
    const paint = props.paint as CanvasProps["paint"] | undefined;
    if (typeof paint === "function") {
      paint(
        { x, y, w: width },
        (op) => ctx.ops.push(offsetOp(op, x, y)),
        (region, run) => addTap(ctx, x + region.x, y + region.y, region.w, region.h, run)
      );
    }
    return height;
  }
  if (typeof kind === "symbol") {
    return placeStack(ctx, node, x, y, w, 0, 0);
  }

  switch (kind) {
    case "text": {
      const ty = typography(props.variant);
      const lines = wrapText(textContent(node), ty.size, Math.max(w, 1));
      const align = props.align === "center" ? "center" : "left";
      const boxWidth = typeof props.width === "number" ? props.width : w;
      lines.forEach((line, index) => {
        const lineWidth = textWidth(line, ty.size);
        const lineX = align === "center" ? x + Math.max((boxWidth - lineWidth) / 2, 0) : x;
        ctx.ops.push({
          op: "text",
          x: lineX,
          y: y + index * ty.lineHeight + ty.lineHeight * 0.78,
          text: line,
          size: ty.size,
          weight: ty.weight,
          color: color(ctx.theme, props.color, ctx.theme.colors?.text ?? "#F2F2F7"),
        });
      });
      return lines.length * ty.lineHeight;
    }
    case "button": {
      const ty = TYPOGRAPHY.body!;
      const label = textContent(node) || "Button";
      const variant = typeof props.variant === "string" ? props.variant : "primary";
      const accent = ctx.theme.colors?.accent ?? "#4C8DFF";
      const danger = ctx.theme.colors?.danger ?? "#FF5A5F";
      const h = 52;
      if (variant === "secondary") {
        ctx.ops.push({ op: "outline", x, y, w, h, r: 16, color: accent, width: 3 });
      } else {
        ctx.ops.push({ op: "rect", x, y, w, h, r: 16, color: variant === "danger" ? danger : accent });
      }
      const textColor = variant === "secondary" ? accent : "#FFFFFF";
      ctx.ops.push({
        op: "text",
        x: x + (w - textWidth(label, ty.size)) / 2,
        y: y + h / 2 + ty.size * 0.36,
        text: label,
        size: ty.size,
        weight: 600,
        color: textColor,
      });
      if (typeof props.onPress === "function") {
        addTap(ctx, x, y, w, h, props.onPress as () => void);
      }
      return h;
    }
    case "card": {
      const pad = paddingOf(props, 16);
      const inner = Math.max(w - pad * 2, 1);
      const h = measureStack(ctx, node, inner, pad, spacing("sm", 8)).h;
      const elevated = props.background === "surface" || props.elevation === true;
      ctx.ops.push({
        op: "rect",
        x,
        y,
        w,
        h,
        r: radius(props.radius, 14),
        color: color(ctx.theme, props.background, ctx.theme.colors?.surfaceRaised ?? "#1C1C24"),
        ...(elevated ? { shadow: 12 } : {}),
      });
      return placeStack(ctx, node, x, y, w, pad, spacing("sm", 8));
    }
    case "column": {
      const pad = paddingOf(props, 0);
      return placeStack(ctx, node, x, y, w, pad, gapOf(props));
    }
    case "row":
      return placeRow(ctx, node, x, y, w);
    case "app-bar": {
      ctx.ops.push({ op: "rect", x, y, w, h: 96, r: 0, color: ctx.theme.colors?.surface ?? "#101014" });
      const title = typeof props.title === "string" ? props.title : "";
      ctx.ops.push({
        op: "text",
        x: x + 40,
        y: y + 60,
        text: title,
        size: 30,
        weight: 700,
        color: ctx.theme.colors?.text ?? "#F2F2F7",
      });
      ctx.ops.push({
        op: "rect",
        x,
        y: y + 92,
        w,
        h: 3,
        r: 0,
        color: ctx.theme.colors?.accent ?? "#4C8DFF",
      });
      return 96;
    }
    case "spacer":
      return spacing(props.size, 16);
    case "scaffold": {
      const frame = measure(ctx, node, w);
      ctx.ops.push({ op: "rect", x, y, w, h: frame.h, r: 0, color: ctx.theme.colors?.surface ?? "#101014" });
      const kids = widgetChildren(node);
      let consumed = 0;
      for (const kid of kids) {
        consumed += place(ctx, kid, x, y + consumed, w);
      }
      return consumed;
    }
    default:
      return 0;
  }
}

/** Translates a canvas-relative op into absolute scene coordinates. */
function offsetOp(op: DisplayOp, dx: number, dy: number): DisplayOp {
  switch (op.op) {
    case "circle":
      return { ...op, cx: op.cx + dx, cy: op.cy + dy };
    case "ring":
      return { ...op, cx: op.cx + dx, cy: op.cy + dy };
    case "line":
      return { ...op, x1: op.x1 + dx, y1: op.y1 + dy, x2: op.x2 + dx, y2: op.y2 + dy };
    case "text":
      return { ...op, x: op.x + dx, y: op.y + dy };
    default:
      return { ...op, x: op.x + dx, y: op.y + dy };
  }
}

function placeStack(
  ctx: InternalContext,
  node: AnyNode,
  x: number,
  y: number,
  w: number,
  pad: number,
  gap: number
): number {
  const innerX = x + pad;
  const innerW = Math.max(w - pad * 2, 1);
  let cursor = y + pad;
  const kids = childNodes(node);
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!;
    const frame = measure(ctx, kid, innerW);
    cursor += place(ctx, kid, innerX, cursor, innerW) + (i < kids.length - 1 ? gap : 0);
  }
  return cursor + pad - y;
}

function placeRow(ctx: InternalContext, node: AnyNode, x: number, y: number, w: number): number {
  const pad = paddingOf(node.props, 0);
  const innerX = x + pad;
  const innerW = Math.max(w - pad * 2, 1);
  const kids = childNodes(node);
  const justify = typeof node.props.justify === "string" ? node.props.justify : "start";
  const gap = gapOf(node.props);

  const frames = kids.map((kid) => measure(ctx, kid, innerW));
  // Flex shrink pass: when the natural widths overflow the row, text (and
  // text-stacking) children give back width and re-wrap — the prototype
  // stand-in for Flutter's Flexible/Expanded behavior.
  const gapsTotal = kids.length > 1 ? gap * (kids.length - 1) : 0;
  const available = Math.max(innerW - gapsTotal, 1);
  let naturalW = frames.reduce((sum, frame) => sum + frame.w, 0);
  if (naturalW > available) {
    const SHRINK_MIN = 96;
    // Function components (e.g. a ListTile's leading <Row>) resolve to a
    // host layout kind only when called, so resolve before matching.
    const shrinkable = kids
      .map((kid, index) => ({
        kid,
        index,
        kind:
          typeof kid.kind === "function"
            ? callComponent(kid).kind
            : kid.kind,
      }))
      .filter(({ kind }) => kind === "text" || kind === "column" || kind === "row");
    let excess = naturalW - available;
    if (shrinkable.length > 0) {
      const shrinkTotal = shrinkable.reduce((sum, entry) => sum + frames[entry.index]!.w, 0);
      for (const entry of shrinkable) {
        const frame = frames[entry.index]!;
        const share = shrinkTotal > 0 ? frame.w / shrinkTotal : 1 / shrinkable.length;
        const reduced = Math.max(frame.w - excess * share, Math.min(SHRINK_MIN, frame.w));
        const taken = frame.w - reduced;
        if (taken > 0) {
          frames[entry.index] = measure(ctx, entry.kid, reduced);
          excess -= taken;
        }
        if (excess <= 0) break;
      }
      naturalW = frames.reduce((sum, frame) => sum + frame.w, 0);
    }
  }
  const rowHeight = frames.reduce((max, frame) => Math.max(max, frame.h), 0);
  const between = justify === "between" && kids.length > 1;
  const slack = Math.max(innerW - naturalW - (between ? 0 : gap * (kids.length - 1)), 0);
  const extra = between ? slack / (kids.length - 1) : 0;
  // MainAxisAlignment.end / center: shift the packed run instead of
  // spreading it (between already consumes the slack above).
  const lead = !between && justify === "end" ? slack : !between && justify === "center" ? slack / 2 : 0;

  let cursor = innerX + lead;
  kids.forEach((kid, index) => {
    const frame = frames[index]!;
    const childY = y + pad + (rowHeight - frame.h) / 2;
    place(ctx, kid, cursor, childY, frame.w);
    cursor += frame.w + (index < kids.length - 1 ? (between ? extra : gap) : 0);
  });
  return pad * 2 + rowHeight;
}

/** ---------- context / entry ---------- */

function addTap(ctx: InternalContext, x: number, y: number, w: number, h: number, run: () => void): void {
  const id = ctx.tapRuns.length;
  ctx.tapRuns.push(run);
  ctx.tapRegions.push({ x, y, w, h, action: "tap", payload: { id } });
}

/**
 * Lays out a full screen tree at design width and returns the committed
 * display-list scene plus the live tap callback table (index-aligned with
 * `scene.taps`).
 */
export function layoutScreen(
  theme: ThemeConfig,
  tree: WidgetNode,
  designWidth: number = DESIGN_WIDTH
): { scene: DisplayListScene; tapRuns: Array<() => void> } {
  const ctx: InternalContext = {
    theme,
    ops: [],
    tapRegions: [],
    tapRuns: [],
    finish() {
      return {
        tenun: "display-list" as const,
        version: 1 as const,
        designWidth,
        contentHeight: 0,
        background: theme.colors?.surface ?? "#101014",
        ops: ctx.ops,
        taps: ctx.tapRegions,
      };
    },
  };
  const frame = measure(ctx, asNode(tree), designWidth);
  place(ctx, asNode(tree), 0, 0, designWidth);
  const scene = ctx.finish();
  scene.contentHeight = frame.h;
  return { scene, tapRuns: ctx.tapRuns };
}

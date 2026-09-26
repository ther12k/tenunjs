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
import {
  CenterKind,
  ContainerKind,
  ExpandedKind,
  GestureDetectorKind,
  IconKind,
  PositionedKind,
  SizedBoxKind,
  StackKind,
  WrapKind,
} from "./structural";
import type { ThemeConfig } from "./index";

/**
 * Role set the theme-scope narrows colors with (TN-133 extraction: the
 * type moved with the lowering, field-for-field; the seed-driven scheme
 * GENERATOR remains example-side in examples/ui-kit/src/scheme.ts).
 */
export interface SchemeRoles {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  surface: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  error: string;
  success: string;
  warning: string;
  inverseSurface: string;
  onInverseSurface: string;
  onPrimaryFixed: string;
}

/** ---------- scene types ---------- */

export type FixedAnchor = "bottom" | "center";

export interface FixedPosition {
  /** Paint or hit-test in viewport coordinates instead of the scrollable scene. */
  fixed?: boolean;
  /** Optional viewport anchor for a group of fixed coordinates. */
  anchor?: FixedAnchor;
  /** Height of the anchored group in design units. */
  anchorSize?: number;
}

export interface RectOp extends FixedPosition {
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

export interface OutlineOp extends FixedPosition {
  op: "outline";
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  color: string;
  width: number;
}

export interface TextOp extends FixedPosition {
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

export interface CircleOp extends FixedPosition {
  op: "circle";
  cx: number;
  cy: number;
  r: number;
  color: string;
}

export interface RingOp extends FixedPosition {
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

export interface LineOp extends FixedPosition {
  op: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface GradientOp extends FixedPosition {
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

export interface SerializedTap extends FixedPosition {
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
  /** Design width is needed when fixed canvas layers leave normal layout. */
  designWidth: number;
  /** Active color roles: theme-derived defaults until a ThemeScope narrows them. */
  palette: SchemeRoles;
}

/**
 * Virtual canvas kind for UI-kit components (Fragment precedent: a virtual
 * symbol kind, never a HostWidgetKind value, so the TN-034 numeric ABI is
 * untouched).
 */
export const Canvas = Symbol.for("tenun.preview.canvas");

/**
 * Virtual theme-scope kind — the kit's answer to Flutter's `Theme` widget:
 * every widget below it resolves colors from the wrapped scheme instead of
 * the ambient one. Layout is unaffected; only color resolution changes.
 */
export const ThemeScope = Symbol.for("tenun.preview.theme-scope");

export interface ThemeScopeProps {
  /** Role overrides merged over the ambient palette. */
  scheme: Partial<SchemeRoles>;
  children?: WidgetChild;
}

/**
 * JSX-usable form of the theme scope (the CanvasBox precedent): a function
 * component so the transform accepts it; resolves to the virtual symbol
 * kind the layout engine narrows colors with.
 */
export function ThemeScopeBox(props: ThemeScopeProps): WidgetNode {
  return {
    kind: ThemeScope,
    key: null,
    props: { scheme: props.scheme },
    children: (props as { children?: WidgetChild[] }).children ?? [],
  } as unknown as WidgetNode;
}

/**
 * Maps a full role set onto the engine's free-form color tokens so the
 * engine widgets (button/card/app-bar/scaffold/text) inside a scope follow
 * the same scheme as the canvas components.
 */
function scopeThemeColors(palette: SchemeRoles): Record<string, string> {
  return {
    accent: palette.primary,
    danger: palette.error,
    surface: palette.surface,
    surfaceRaised: palette.surfaceContainer,
    text: palette.onSurface,
    primaryContainer: palette.primaryContainer,
    onPrimaryContainer: palette.onPrimaryContainer,
    outlineVariant: palette.outlineVariant,
  };
}

/**
 * The default role set: the kit's dark Material-3 palette, tightened by
 * whatever matching tokens the ambient theme declares.
 */
export function resolveRoles(theme: ThemeConfig): SchemeRoles {
  const c = theme.colors ?? {};
  return {
    primary: c.accent ?? "#4C8DFF",
    onPrimary: "#FFFFFF",
    primaryContainer: c.primaryContainer ?? "#223354",
    onPrimaryContainer: c.onPrimaryContainer ?? "#D6E4FF",
    secondaryContainer: c.secondaryContainer ?? "#30354A",
    onSecondaryContainer: c.onSecondaryContainer ?? "#DCE4FF",
    surface: c.surface ?? "#101014",
    surfaceContainer: "#16161D",
    surfaceContainerHigh: "#232330",
    onSurface: c.text ?? "#F2F2F7",
    onSurfaceVariant: "#9AA3B2",
    outline: c.outline ?? "#474B5A",
    outlineVariant: c.outlineVariant ?? "#26262F",
    error: c.danger ?? "#FF5A5F",
    success: c.success ?? "#3DD68C",
    warning: c.warning ?? "#F5A623",
    inverseSurface: "#2E2E3C",
    onInverseSurface: "#F2F2F7",
    onPrimaryFixed: "#FFFFFF",
  };
}

export interface CanvasProps {
  /** Explicit height; width comes from the parent layout unless fixed. */
  height: number;
  width?: number;
  /** Make every operation and tap use viewport design coordinates. */
  fixed?: boolean;
  /** Default anchor metadata for fixed operations and taps. */
  anchor?: FixedAnchor;
  anchorSize?: number;
  /**
   * Paints relative to the canvas origin (0,0 = top-left of the box) and
   * may register tap regions through the same callback table as widgets.
   * The active color roles arrive last, so components read the ambient
   * (or ThemeScope-narrowed) palette instead of global constants.
   */
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
        anchor?: FixedAnchor;
        anchorSize?: number;
      },
      run: () => void
    ) => void,
    palette: SchemeRoles
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
  label: { size: 14, lineHeight: 20, weight: 600 },
  caption: { size: 13, lineHeight: 18, weight: 400 },
  body: { size: 17, lineHeight: 24, weight: 400 },
  title: { size: 22, lineHeight: 30, weight: 600 },
  headline: { size: 30, lineHeight: 38, weight: 700 },
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

/**
 * Fully resolves function-component wrappers so parent layouts can match
 * the concrete kind (e.g. JSX `<Positioned>` resolving to PositionedKind).
 */
function resolveNode(kid: AnyNode): AnyNode {
  let current = kid;
  while (typeof current.kind === "function") current = callComponent(current);
  return current;
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
  // ThemeScope changes only color resolution, never geometry.
  if (kind === ThemeScope) {
    return measureStack(ctx, node, maxWidth, 0, 0);
  }
  if (kind === SizedBoxKind) {
    const width = typeof props.width === "number" ? props.width : undefined;
    const tight = width !== undefined ? Math.min(width, maxWidth) : maxWidth;
    let contentW = 0;
    let contentH = 0;
    for (const kid of childNodes(node)) {
      const frame = measure(ctx, kid, tight);
      contentW = Math.max(contentW, frame.w);
      contentH = Math.max(contentH, frame.h);
    }
    return {
      w: width !== undefined ? tight : Math.min(contentW, maxWidth),
      h: typeof props.height === "number" ? props.height : contentH,
    };
  }
  if (kind === CenterKind) {
    let contentH = 0;
    for (const kid of childNodes(node)) contentH = Math.max(contentH, measure(ctx, kid, maxWidth).h);
    return { w: maxWidth, h: contentH };
  }
  if (kind === StackKind) {
    // Positioned children never size the stack (Flutter semantics).
    let w = 0;
    let h = 0;
    for (const kid of childNodes(node).map(resolveNode)) {
      if (kid.kind === PositionedKind) continue;
      const frame = measure(ctx, kid, maxWidth);
      w = Math.max(w, frame.w);
      h = Math.max(h, frame.h);
    }
    return { w: Math.min(w, maxWidth), h };
  }
  if (kind === WrapKind) {
    const flow = layoutWrapChildren(ctx, node, maxWidth);
    return { w: Math.min(flow.width, maxWidth), h: flow.height };
  }
  if (kind === ContainerKind) {
    const pad = paddingOf(props, 0);
    const width = typeof props.width === "number" ? props.width : undefined;
    const height = typeof props.height === "number" ? props.height : undefined;
    if (width !== undefined && height !== undefined) {
      return { w: Math.min(width, maxWidth), h: height };
    }
    // Flutter sizing: fixed size wins; with children the container hugs
    // them; a childless container fills the available space.
    if (childNodes(node).length === 0 && width === undefined) {
      return { w: maxWidth, h: height ?? 0 };
    }
    const inner = measureStack(ctx, node, Math.max((width ?? maxWidth) - pad * 2, 1), pad, 0);
    return {
      w: width !== undefined ? Math.min(width, maxWidth) : inner.w,
      h: height ?? inner.h,
    };
  }
  if (kind === IconKind) {
    const size = typeof props.size === "number" ? props.size : 24;
    return {
      w: textWidth(typeof props.glyph === "string" ? props.glyph : "", size),
      h: Math.round(size * 1.2),
    };
  }
  // Positioned/Expanded outside their parent widget are transparent
  // wrappers; GestureDetector measures what it wraps.
  if (kind === PositionedKind || kind === ExpandedKind || kind === GestureDetectorKind) {
    return measureStack(ctx, node, maxWidth, 0, 0);
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
      return { w: Math.min(maxWidth, Math.max(96, textWidth(label, ty.size) + 48)), h: 64 };
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
      const kids = childNodes(node).map(resolveNode);
      // Expanded children re-measure at their flex share, which can change
      // their wrapped height — resolve frames the same way place does.
      if (kids.some((kid) => kid.kind === ExpandedKind)) {
        return { w: maxWidth, h: pad * 2 + layoutRowChildren(ctx, node, inner).rowHeight };
      }
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
    const fixedCanvas = props.fixed === true;
    const width = fixedCanvas
      ? ctx.designWidth
      : Math.min(typeof props.width === "number" ? props.width : w, w);
    const height = Number(props.height ?? 0);
    const paint = props.paint as CanvasProps["paint"] | undefined;
    if (typeof paint === "function") {
      paint(
        { x: fixedCanvas ? 0 : x, y: fixedCanvas ? 0 : y, w: width },
        (op) => ctx.ops.push(offsetOp(op, x, y, {
          fixed: fixedCanvas,
          anchor: props.anchor as FixedAnchor | undefined,
          anchorSize: typeof props.anchorSize === "number" ? props.anchorSize : undefined,
        })),
        (region, run) => {
          const inheritedFixed = region.fixed === undefined && fixedCanvas;
          const fixed = region.fixed ?? fixedCanvas;
          const anchor = region.anchor ?? (inheritedFixed ? props.anchor as FixedAnchor | undefined : undefined);
          const anchorSize = typeof region.anchorSize === "number"
            ? region.anchorSize
            : inheritedFixed && typeof props.anchorSize === "number"
              ? props.anchorSize
              : undefined;
          addTap(
            ctx,
            fixed ? region.x : x + region.x,
            fixed ? region.y : y + region.y,
            region.w,
            region.h,
            run,
            fixed,
            anchor,
            anchorSize
          );
        },
        ctx.palette
      );
    }
    return height;
  }
  if (kind === ThemeScope) {
    const merged: SchemeRoles = { ...ctx.palette, ...((props.scheme as Partial<SchemeRoles>) ?? {}) };
    const scoped: InternalContext = {
      ...ctx,
      palette: merged,
      theme: { ...ctx.theme, colors: { ...ctx.theme.colors, ...scopeThemeColors(merged) } },
    };
    return placeStack(scoped, node, x, y, w, 0, 0);
  }
  if (kind === SizedBoxKind) {
    const tight = Math.min(typeof props.width === "number" ? props.width : w, w);
    let maxH = 0;
    for (const kid of childNodes(node)) {
      const frame = measure(ctx, kid, tight);
      maxH = Math.max(maxH, place(ctx, kid, x, y, frame.w));
    }
    return typeof props.height === "number" ? props.height : maxH;
  }
  if (kind === CenterKind) {
    const kids = childNodes(node);
    const frames = kids.map((kid) => measure(ctx, kid, w));
    const contentH = Math.max(...frames.map((frame) => frame.h), 0);
    kids.forEach((kid, index) => {
      const frame = frames[index]!;
      place(ctx, kid, x + Math.max((w - frame.w) / 2, 0), y + Math.max((contentH - frame.h) / 2, 0), frame.w);
    });
    return contentH;
  }
  if (kind === StackKind) {
    return placeStackWidget(ctx, node, x, y, w);
  }
  if (kind === ExpandedKind) {
    // Tight width: the row assigned this frame, so children stretch to it
    // instead of re-measuring at their intrinsic width.
    let h = 0;
    for (const kid of childNodes(node)) {
      h = Math.max(h, place(ctx, kid, x, y, w));
    }
    return h;
  }
  if (kind === PositionedKind) {
    return placeStack(ctx, node, x, y, w, 0, 0);
  }
  if (kind === GestureDetectorKind) {
    const h = placeStack(ctx, node, x, y, w, 0, 0);
    if (typeof props.onTap === "function") {
      addTap(ctx, x, y, w, h, props.onTap as () => void);
    }
    return h;
  }
  if (kind === ContainerKind) {
    const pad = paddingOf(props, 0);
    const tight = Math.min(typeof props.width === "number" ? props.width : w, w);
    const height = typeof props.height === "number" ? props.height : undefined;
    const h = height ?? measureStack(ctx, node, Math.max(tight - pad * 2, 1), pad, 0).h;
    const radius = typeof props.radius === "number" ? props.radius : 0;
    const fill = roleColor(ctx, props.color);
    if (fill !== undefined) {
      const shadow = typeof props.shadow === "number" ? props.shadow : undefined;
      ctx.ops.push({ op: "rect", x, y, w: tight, h, r: radius, color: fill, ...(shadow ? { shadow } : {}) });
    }
    const stroke = roleColor(ctx, props.borderColor);
    if (stroke !== undefined) {
      const width = typeof props.borderWidth === "number" ? props.borderWidth : 3;
      ctx.ops.push({ op: "outline", x, y, w: tight, h, r: radius, color: stroke, width });
    }
    const stacked = placeStack(ctx, node, x, y, tight, pad, 0);
    return height !== undefined ? height : stacked;
  }
  if (kind === IconKind) {
    const size = typeof props.size === "number" ? props.size : 24;
    const glyph = typeof props.glyph === "string" ? props.glyph : "";
    const h = Math.round(size * 1.2);
    ctx.ops.push({
      op: "text",
      x: x + (w - textWidth(glyph, size)) / 2,
      y: y + h / 2 + size * 0.36,
      text: glyph,
      size,
      weight: 600,
      color: roleColor(ctx, props.color) ?? ctx.palette.onSurface,
    });
    return h;
  }
  if (kind === WrapKind) {
    const flow = layoutWrapChildren(ctx, node, w);
    let cursorY = y;
    for (const line of flow.lines) {
      let cursorX = x;
      for (const entry of line.entries) {
        place(ctx, entry.kid, cursorX, cursorY, entry.frame.w);
        cursorX += entry.frame.w + flow.spacing;
      }
      cursorY += line.height + flow.runSpacing;
    }
    return flow.height;
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
          color: roleColor(ctx, props.color) ?? ctx.theme.colors?.text ?? "#F2F2F7",
        });
      });
      return lines.length * ty.lineHeight;
    }
    case "button": {
      const ty = TYPOGRAPHY.body!;
      const label = textContent(node) || "Button";
      const variant = typeof props.variant === "string" ? props.variant : "primary";
      const palette = ctx.theme.colors ?? {};
      const accent = palette.accent ?? "#4C8DFF";
      const danger = palette.danger ?? "#FF5A5F";
      const h = 64;
      const r = 32;
      const onPrimary = ctx.palette.onPrimary;
      const container = palette.primaryContainer ?? "#223354";
      const onContainer = palette.onPrimaryContainer ?? "#D6E4FF";
      // M3 button anatomy: a full-pill shape, one typography style, and
      // variant color roles — filled carries elevation, tonal/outlined/text
      // decline it, exactly like Flutter's Filled/Tonal/Outlined/Text.
      let fill: string | null = accent;
      let labelColor = onPrimary;
      let stroked = false;
      let shadow: number | undefined;
      if (variant === "secondary") {
        fill = null;
        stroked = true;
        labelColor = accent;
      } else if (variant === "tonal") {
        fill = container;
        labelColor = onContainer;
      } else if (variant === "text") {
        fill = null;
        labelColor = accent;
      } else if (variant === "danger") {
        fill = danger;
      } else {
        shadow = 10;
      }
      if (fill !== null) {
        ctx.ops.push({ op: "rect", x, y, w, h, r, color: fill, ...(shadow ? { shadow } : {}) });
      } else if (stroked) {
        ctx.ops.push({ op: "outline", x, y, w, h, r, color: accent, width: 3 });
      }
      ctx.ops.push({
        op: "text",
        x: x + (w - textWidth(label, ty.size)) / 2,
        y: y + h / 2 + ty.size * 0.36,
        text: label,
        size: ty.size,
        weight: 600,
        color: labelColor,
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
        color: roleColor(ctx, props.background) ?? ctx.theme.colors?.surfaceRaised ?? "#1C1C24",
        ...(elevated ? { shadow: 12 } : {}),
      });
      return placeStack(ctx, node, x, y, w, pad, spacing("sm", 8));
    }
    case "column": {
      const pad = paddingOf(props, 0);
      return placeStack(ctx, node, x, y, w, pad, gapOf(props), crossAlignOf(props, "start"));
    }
    case "row":
      return placeRow(ctx, node, x, y, w);
    case "app-bar": {
      ctx.ops.push({ op: "rect", x, y, w, h: 96, r: 0, color: ctx.theme.colors?.surface ?? "#101014" });
      // Optional leading burger — the M3 modal-drawer affordance.
      const hasMenu = typeof props.onMenu === "function";
      const titleX = hasMenu ? 100 : 40;
      if (hasMenu) {
        ctx.ops.push({ op: "text", x: x + 36, y: y + 62, text: "☰", size: 34, weight: 600, color: ctx.theme.colors?.text ?? "#F2F2F7" });
        addTap(ctx, x + 12, y + 12, 72, 72, props.onMenu as () => void);
      }
      const title = typeof props.title === "string" ? props.title : "";
      ctx.ops.push({
        op: "text",
        x: x + titleX,
        y: y + 62,
        text: title,
        size: 32,
        weight: 700,
        color: ctx.theme.colors?.text ?? "#F2F2F7",
      });
      // M3 separation: a quiet outlineVariant hairline instead of a loud
      // accent strip — the bar reads as part of the surface, not a banner.
      ctx.ops.push({
        op: "line",
        x1: x,
        y1: y + 94,
        x2: x + w,
        y2: y + 94,
        color: ctx.theme.colors?.outlineVariant ?? "#26262F",
        width: 2,
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

/**
 * Translates a canvas-relative op into scene coordinates unless it is fixed.
 * Fixed ops remain in viewport design coordinates; hosts resolve their optional
 * anchor against the visible viewport height.
 */
function offsetOp(
  op: DisplayOp,
  dx: number,
  dy: number,
  defaults: FixedPosition = {}
): DisplayOp {
  const explicitlyFixed = op.fixed !== undefined;
  const fixed = op.fixed ?? defaults.fixed === true;
  const anchor = op.anchor ?? (!explicitlyFixed && fixed ? defaults.anchor : undefined);
  const anchorSize = op.anchorSize ?? (!explicitlyFixed && fixed ? defaults.anchorSize : undefined);
  const meta = fixed
    ? { fixed: true as const, ...(anchor ? { anchor } : {}), ...(anchorSize !== undefined ? { anchorSize } : {}) }
    : {};
  switch (op.op) {
    case "circle":
      return fixed
        ? { ...op, ...meta, cx: op.cx, cy: op.cy }
        : { ...op, cx: op.cx + dx, cy: op.cy + dy };
    case "ring":
      return fixed
        ? { ...op, ...meta, cx: op.cx, cy: op.cy }
        : { ...op, cx: op.cx + dx, cy: op.cy + dy };
    case "line":
      return fixed
        ? { ...op, ...meta, x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2 }
        : { ...op, x1: op.x1 + dx, y1: op.y1 + dy, x2: op.x2 + dx, y2: op.y2 + dy };
    case "text":
      return fixed
        ? { ...op, ...meta, x: op.x, y: op.y }
        : { ...op, x: op.x + dx, y: op.y + dy };
    default:
      return fixed
        ? { ...op, ...meta, x: op.x, y: op.y }
        : { ...op, x: op.x + dx, y: op.y + dy };
  }
}

type CrossAlign = "start" | "center" | "end" | "stretch";

/**
 * Resolves a color prop for the structural widgets: hash-prefixed literals pass
 * through, SchemeRoles names ("primary", "onSurfaceVariant", ...) resolve
 * against the active palette, then theme tokens; anything else paints
 * nothing rather than guessing.
 */
function roleColor(ctx: InternalContext, token: unknown): string | undefined {
  if (typeof token !== "string") return undefined;
  if (token.startsWith("#")) return token;
  const byRole = (ctx.palette as unknown as Record<string, string | undefined>)[token];
  if (typeof byRole === "string") return byRole;
  const themed = ctx.theme.colors?.[token];
  if (typeof themed === "string") return themed;
  return undefined;
}

/** Stack alignment: fractional position of non-positioned children. */
const STACK_ALIGNMENT: Record<string, { ax: number; ay: number }> = {
  topLeft: { ax: 0, ay: 0 },
  topCenter: { ax: 0.5, ay: 0 },
  topRight: { ax: 1, ay: 0 },
  centerLeft: { ax: 0, ay: 0.5 },
  center: { ax: 0.5, ay: 0.5 },
  centerRight: { ax: 1, ay: 0.5 },
  bottomLeft: { ax: 0, ay: 1 },
  bottomCenter: { ax: 0.5, ay: 1 },
  bottomRight: { ax: 1, ay: 1 },
};

/**
 * Places a Stack: children in declaration order (later paints on top, and
 * its taps register later so the hosts' topmost-wins hit test matches the
 * paint order). The frame height comes from non-positioned children;
 * Positioned children place by offset, stretching across an axis when both
 * sides are given.
 */
function placeStackWidget(ctx: InternalContext, node: AnyNode, x: number, y: number, w: number): number {
  const kids = childNodes(node).map(resolveNode);
  let frameH = 0;
  for (const kid of kids) {
    if (kid.kind === PositionedKind) continue;
    frameH = Math.max(frameH, measure(ctx, kid, w).h);
  }
  const rawAlign = typeof node.props.alignment === "string" ? node.props.alignment : "topLeft";
  const align = STACK_ALIGNMENT[rawAlign] ?? STACK_ALIGNMENT.topLeft!;
  for (const kid of kids) {
    if (kid.kind === PositionedKind) {
      const { props } = kid;
      const left = typeof props.left === "number" ? props.left : undefined;
      const right = typeof props.right === "number" ? props.right : undefined;
      const top = typeof props.top === "number" ? props.top : undefined;
      const bottom = typeof props.bottom === "number" ? props.bottom : undefined;
      const inner = childNodes(kid);
      // left+right stretches the child across the frame width.
      const tightW = left !== undefined && right !== undefined ? Math.max(w - left - right, 0) : undefined;
      const frames = inner.map((child) => measure(ctx, child, tightW ?? w));
      const useW = tightW ?? Math.max(...frames.map((frame) => frame.w), 0);
      const firstH = frames[0]?.h ?? 0;
      const cx = left !== undefined ? x + left : right !== undefined ? x + w - right - useW : x;
      const cy = top !== undefined ? y + top : bottom !== undefined ? y + frameH - bottom - firstH : y;
      inner.forEach((child, index) => {
        place(ctx, child, cx, cy, index === 0 ? useW : frames[index]!.w);
      });
    } else {
      const frame = measure(ctx, kid, w);
      place(ctx, kid, x + (w - frame.w) * align.ax, y + (frameH - frame.h) * align.ay, frame.w);
    }
  }
  return frameH;
}

interface WrapEntry {
  kid: AnyNode;
  frame: Frame;
}

interface WrapLine {
  entries: WrapEntry[];
  width: number;
  height: number;
}

interface WrapLayout {
  lines: WrapLine[];
  width: number;
  height: number;
  spacing: number;
  runSpacing: number;
}

/** Greedy line-fill of children within [maxWidth] (Flutter's Wrap). */
function layoutWrapChildren(ctx: InternalContext, node: AnyNode, maxWidth: number): WrapLayout {
  const spacingValue = spacing(node.props.spacing, 8);
  const runSpacing = spacing(node.props.runSpacing, 8);
  const lines: WrapLine[] = [];
  let entries: WrapEntry[] = [];
  let lineWidth = 0;
  const flush = (): void => {
    if (entries.length === 0) return;
    lines.push({
      entries,
      width: lineWidth,
      height: Math.max(...entries.map((entry) => entry.frame.h), 0),
    });
    entries = [];
    lineWidth = 0;
  };
  for (const kid of childNodes(node)) {
    const frame = measure(ctx, kid, maxWidth);
    if (entries.length > 0 && lineWidth + spacingValue + frame.w > maxWidth) flush();
    lineWidth += (entries.length > 0 ? spacingValue : 0) + frame.w;
    entries.push({ kid, frame });
  }
  flush();
  return {
    lines,
    width: lines.reduce((max, line) => Math.max(max, line.width), 0),
    height:
      lines.reduce((sum, line) => sum + line.height, 0) +
      runSpacing * Math.max(lines.length - 1, 0),
    spacing: spacingValue,
    runSpacing,
  };
}

function crossAlignOf(props: Record<string, unknown>, fallback: CrossAlign): CrossAlign {
  const value = props.align;
  if (value === "start" || value === "center" || value === "end" || value === "stretch") return value;
  return fallback;
}

/**
 * Places a vertically stacking box (column/card/fragment). [align] is the
 * cross-axis placement of children; "start" keeps the original
 * left-packed behavior, so callers that never pass `align` render exactly
 * as before.
 */
function placeStack(
  ctx: InternalContext,
  node: AnyNode,
  x: number,
  y: number,
  w: number,
  pad: number,
  gap: number,
  align: CrossAlign = "start"
): number {
  const innerX = x + pad;
  const innerW = Math.max(w - pad * 2, 1);
  let cursor = y + pad;
  const kids = childNodes(node);
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!;
    const frame = measure(ctx, kid, innerW);
    const kidW = align === "stretch" ? innerW : frame.w;
    const kidX =
      align === "center"
        ? innerX + Math.max((innerW - frame.w) / 2, 0)
        : align === "end"
          ? innerX + Math.max(innerW - frame.w, 0)
          : innerX;
    cursor += place(ctx, kid, kidX, cursor, kidW) + (i < kids.length - 1 ? gap : 0);
  }
  return cursor + pad - y;
}

interface RowLayout {
  kids: AnyNode[];
  frames: Frame[];
  rowHeight: number;
}

/**
 * Resolves a row's children into final frames, shared by measure and place
 * so an Expanded child can never measure at one width and place at another.
 *
 * Without Expanded children this is the legacy pass, including the implicit
 * text-shrink heuristic, so existing scenes stay byte-identical. With
 * Expanded children, fixed children keep their natural width and expanded
 * children share the free width proportionally to flex.
 */
function layoutRowChildren(ctx: InternalContext, node: AnyNode, innerW: number): RowLayout {
  const kids = childNodes(node).map(resolveNode);
  const gap = gapOf(node.props);
  const frames = kids.map((kid) => measure(ctx, kid, innerW));

  if (!kids.some((kid) => kid.kind === ExpandedKind)) {
    // Flex shrink pass: when the natural widths overflow the row, text (and
    // text-stacking) children give back width and re-wrap — the prototype
    // stand-in for Flutter's Flexible behavior when no Expanded is present.
    const gapsTotal = kids.length > 1 ? gap * (kids.length - 1) : 0;
    const available = Math.max(innerW - gapsTotal, 1);
    let naturalW = frames.reduce((sum, frame) => sum + frame.w, 0);
    if (naturalW > available) {
      const SHRINK_MIN = 96;
      const shrinkable = kids
        .map((kid, index) => ({ kid, index, kind: kid.kind }))
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
      }
    }
    return { kids, frames, rowHeight: frames.reduce((max, frame) => Math.max(max, frame.h), 0) };
  }

  // Expanded pass: fixed children keep natural width; expanded children
  // re-measure at their flex share of the free space.
  const gapsTotal = kids.length > 1 ? gap * (kids.length - 1) : 0;
  let fixedW = 0;
  let flexSum = 0;
  const flexes = kids.map((kid) => {
    if (kid.kind !== ExpandedKind) return 0;
    const raw = kid.props.flex;
    return typeof raw === "number" && raw > 0 ? raw : 1;
  });
  flexes.forEach((flex, index) => {
    if (flex > 0) flexSum += flex;
    else fixedW += frames[index]!.w;
  });
  const free = Math.max(innerW - gapsTotal - fixedW, 0);
  const unit = flexSum > 0 ? free / flexSum : 0;
  flexes.forEach((flex, index) => {
    if (flex > 0) {
      // Tight constraints: the flex share IS the child's width (Flutter's
      // Expanded), so intrinsic measurers (buttons, text) stretch at place
      // time instead of packing at their natural width.
      const share = Math.max(unit * flex, 1);
      frames[index] = { w: share, h: measure(ctx, kids[index]!, share).h };
    }
  });
  return { kids, frames, rowHeight: frames.reduce((max, frame) => Math.max(max, frame.h), 0) };
}

function placeRow(ctx: InternalContext, node: AnyNode, x: number, y: number, w: number): number {
  const pad = paddingOf(node.props, 0);
  const innerX = x + pad;
  const innerW = Math.max(w - pad * 2, 1);
  const justify = typeof node.props.justify === "string" ? node.props.justify : "start";
  const gap = gapOf(node.props);
  // CrossAxisAlignment: center is the historical (and Flutter) row default;
  // stretch degrades to start — the engine has no cross-axis size forcing.
  const align = crossAlignOf(node.props, "center");

  const { kids, frames, rowHeight } = layoutRowChildren(ctx, node, innerW);
  const naturalW = frames.reduce((sum, frame) => sum + frame.w, 0);
  const between = justify === "between" && kids.length > 1;
  const slack = Math.max(innerW - naturalW - (between ? 0 : gap * (kids.length - 1)), 0);
  const extra = between ? slack / Math.max(kids.length - 1, 1) : 0;
  // MainAxisAlignment.end / center: shift the packed run instead of
  // spreading it (between already consumes the slack above).
  const lead = !between && justify === "end" ? slack : !between && justify === "center" ? slack / 2 : 0;

  let cursor = innerX + lead;
  kids.forEach((kid, index) => {
    const frame = frames[index]!;
    const childY =
      align === "start" || align === "stretch"
        ? y + pad
        : align === "end"
          ? y + pad + rowHeight - frame.h
          : y + pad + (rowHeight - frame.h) / 2;
    place(ctx, kid, cursor, childY, frame.w);
    cursor += frame.w + (index < kids.length - 1 ? (between ? extra : gap) : 0);
  });
  return pad * 2 + rowHeight;
}

/** ---------- context / entry ---------- */

function addTap(
  ctx: InternalContext,
  x: number,
  y: number,
  w: number,
  h: number,
  run: () => void,
  fixed = false,
  anchor?: FixedAnchor,
  anchorSize?: number
): void {
  const id = ctx.tapRuns.length;
  ctx.tapRuns.push(run);
  ctx.tapRegions.push({
    x,
    y,
    w,
    h,
    action: "tap",
    payload: { id },
    ...(fixed ? { fixed: true } : {}),
    ...(fixed && anchor ? { anchor } : {}),
    ...(fixed && anchorSize !== undefined ? { anchorSize } : {}),
  });
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
    designWidth,
    palette: resolveRoles(theme),
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

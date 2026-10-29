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
 * "gradient" (vertical two-stop gradient rect), and "text-input" (required
 * nonpainting host input descriptor). Taps are hit-test regions
 * whose payloads index back into the JS callback table rebuilt on every
 * render, so hosts stay dumb painter/dispatchers.
 *
 * UI-kit components draw through the virtual canvas node
 * (`Symbol.for("tenun.preview.canvas")`, the Fragment precedent: a virtual
 * kind that never touches the HostWidgetKind ABI — TN-034 owns that map).
 * Its paint closure runs at layout time and emits plain data ops, so the
 * committed scene stays JSON-serializable.
 *
 * Layout executes in TypeScript with bounded/unbounded constraints in both
 * axes. Text metrics remain approximate; TextField text has a local hard clip.
 * Independent scrolling and general widget clipping remain separate contracts.
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
import { TextFieldKind, TextInputError, resolveTextFieldProps, textInputDescriptor } from "./text-input";
import type { TextFieldBinding, TextInputLayoutDelegate, TextInputOp } from "./text-input";

/** A finite surface expressed in the same design units as widget geometry. */
export interface LayoutViewport {
  readonly width: number;
  readonly height: number;
}

export type LayoutErrorCode = "INVALID_VIEWPORT" | "INVALID_CONSTRAINT" | "UNBOUNDED_FLEX" | "INVALID_TRANSITION";

export class LayoutError extends Error {
  constructor(readonly code: LayoutErrorCode, message: string) {
    super(`[TENUN_LAYOUT_ERROR] ${message}`);
    this.name = "LayoutError";
  }
}

/** Validate before storing a viewport; callers cannot mutate the saved dimensions. */
export function validateLayoutViewport(viewport: LayoutViewport): Readonly<LayoutViewport> {
  if (!viewport || typeof viewport !== "object") {
    throw new LayoutError("INVALID_VIEWPORT", "Viewport width and height must be positive finite numbers");
  }
  const width = viewport.width;
  const height = viewport.height;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new LayoutError("INVALID_VIEWPORT", "Viewport width and height must be positive finite numbers");
  }
  return Object.freeze({ width, height });
}

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

/** Absolute scene-coordinate clip; fixed operations apply their anchor to it too. */
export interface TextClip {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A copied finite rectangle; clipping never coerces malformed host geometry. */
export function validateTextClip(value: unknown): TextClip {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LayoutError("INVALID_CONSTRAINT", "Text clip must be a rectangle");
  }
  const { x, y, w, h } = value as Record<string, unknown>;
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y) ||
      typeof w !== "number" || !Number.isFinite(w) || w < 0 ||
      typeof h !== "number" || !Number.isFinite(h) || h < 0) {
    throw new LayoutError("INVALID_CONSTRAINT", "Text clip must have finite coordinates and nonnegative finite dimensions");
  }
  return { x, y, w, h };
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
  /** Optional hard clip for this text operation, in the same coordinate space. */
  clip?: TextClip;
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

export type DisplayOp = RectOp | OutlineOp | TextOp | CircleOp | RingOp | LineOp | GradientOp | TextInputOp | ScrollRegionOp;

/**
 * TN-161 independent scroll region: a bounded viewport box with content
 * that laid out under an UNBOUNDED main axis (the frozen TN-156 scroll
 * semantics). Children ops and any taps carrying the region's id are in
 * the region's CONTENT space; the host scrolls by changing this region's
 * paint offset only — never layout. Scenes that use this op require a
 * host that knows it: older hosts reject the scene visibly (unknown op
 * kind), which is exactly the pairing rule.
 */
export interface ScrollRegionOp {
  readonly op: "scroll-region";
  /** Stable paint-state key: app-supplied, else derived from the viewport box. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Viewport size in scene units. */
  readonly w: number;
  readonly h: number;
  /** Laid-out content extent along the unbounded axis. */
  readonly contentHeight: number;
  readonly ops: readonly DisplayOp[];
}

/**
 * Hit region gesture kinds a host can dispatch back. "long-press" is
 * the TN-148 gesture: hosts fire it on a hold over the region (Android
 * ~500 ms, scroll/move cancels) and must NOT also dispatch "tap" for
 * the same press. Both gestures share the tap-run table.
 */
export type TapRegionAction = "tap" | "long-press";

export interface SerializedTap extends FixedPosition {
  x: number;
  y: number;
  w: number;
  h: number;
  action: TapRegionAction;
  payload: { id: number };
  /** TN-161: set when the region lives in this scroll region's CONTENT space. */
  scroll?: string;
}

export interface DisplayListScene {
  tenun: "display-list";
  version: 1;
  designWidth: number;
  contentHeight: number;
  background: string;
  ops: DisplayOp[];
  taps: SerializedTap[];
  /**
   * TN-169: host-evaluated route transition. Present on exactly the first
   * scene committed after a navigation that requested one; hosts animate
   * between their previous settled scene and this scene on their own frame
   * clock and then settle. Optional and ignored by hosts that predate it
   * (an unknown top-level field, not a new op kind). Never part of state
   * snapshots.
   */
  transition?: SceneTransition;
}

/** A requested route transition, normalized before it reaches a scene. */
export interface SceneTransition {
  kind: "slide" | "fade";
  durationMs: number;
  direction: "forward" | "backward";
}

export interface SceneTransitionRequest {
  kind?: "slide" | "fade";
  durationMs?: number;
  direction?: "forward" | "backward";
}

const TRANSITION_KINDS: ReadonlySet<string> = new Set(["slide", "fade"]);
const TRANSITION_DIRECTIONS: ReadonlySet<string> = new Set(["forward", "backward"]);
export const TRANSITION_DEFAULT_DURATION_MS = 240;

/**
 * Normalizes a transition request into the full wire descriptor, failing
 * visibly on malformed input. Shared by the runtime (navigation options)
 * and hosts (scene validation), so both sides enforce one shape.
 */
export function normalizeSceneTransition(request: SceneTransitionRequest): SceneTransition {
  const kind = request.kind ?? "slide";
  const direction = request.direction ?? "forward";
  const durationMs = request.durationMs ?? TRANSITION_DEFAULT_DURATION_MS;
  if (!TRANSITION_KINDS.has(kind)) {
    throw new LayoutError("INVALID_TRANSITION", `unknown transition kind "${String(kind)}"`);
  }
  if (!TRANSITION_DIRECTIONS.has(direction)) {
    throw new LayoutError("INVALID_TRANSITION", `unknown transition direction "${String(direction)}"`);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 10_000) {
    throw new LayoutError("INVALID_TRANSITION", "transition durationMs must be a finite value in (0, 10000]");
  }
  return { kind, direction, durationMs } as SceneTransition;
}

/** True when a parsed JSON value is a valid wire-form transition block. */
export function sceneTransitionWireError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    return "scene.transition must be an object";
  }
  const block = value as { kind?: unknown; durationMs?: unknown; direction?: unknown };
  if (block.kind !== "slide" && block.kind !== "fade") {
    return `scene.transition has unknown kind "${String(block.kind)}"`;
  }
  if (block.direction !== "forward" && block.direction !== "backward") {
    return `scene.transition has unknown direction "${String(block.direction)}"`;
  }
  if (typeof block.durationMs !== "number" || !Number.isFinite(block.durationMs) || block.durationMs <= 0) {
    return "scene.transition durationMs must be a positive finite number";
  }
  return null;
}

/**
 * The shared easing curve for host-evaluated transitions — identical on
 * every host so the same progress produces the same picture. Ease-in-out
 * cubic: motion starts and ends at rest.
 */
export function transitionEasing(progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

export interface RenderContext {
  readonly theme: ThemeConfig;
  finish(): DisplayListScene;
}

interface InternalContext extends RenderContext {
  ops: DisplayOp[];
  tapRegions: SerializedTap[];
  tapRuns: Array<() => void>;
  textFields: TextFieldBinding[];
  textFieldIds: Set<string>;
  textInput?: TextInputLayoutDelegate;
  /** Design width is needed when fixed canvas layers leave normal layout. */
  designWidth: number;
  /** Active color roles: theme-derived defaults until a ThemeScope narrows them. */
  palette: SchemeRoles;
  /**
   * Per-render function-component resolutions. measure and place walk the
   * tree separately; without this cache every component would be INVOKED
   * once per walk, so an impure component painted its second result while
   * geometry was measured from its first. One resolution per node per
   * render: the first invocation is authoritative for both passes.
   */
  componentCache: Map<AnyNode, AnyNode>;
}

/**
 * Virtual canvas kind for UI-kit components (Fragment precedent: a virtual
 * symbol kind, never a HostWidgetKind value, so the TN-034 numeric ABI is
 * untouched).
 */
export const Canvas = Symbol.for("tenun.preview.canvas");
export const ScrollViewKind = Symbol.for("tenun.widgets.scroll-view");

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

/**
 * WidgetNode → AnyNode adapter, memoized by tree-object identity: the same
 * WidgetNode must yield the SAME AnyNode across the measure and place walks
 * (the per-render component cache keys on it). WeakMap: entries die with the
 * tree. Nothing in the lowering mutates a node wrapper (verified: reads only).
 */
const asNodeCache = new WeakMap<WidgetNode, AnyNode>();
function asNode(node: WidgetNode): AnyNode {
  let cached = asNodeCache.get(node);
  if (!cached) {
    cached = { kind: node.kind, props: node.props as Record<string, unknown>, children: node.children };
    asNodeCache.set(node, cached);
  }
  return cached;
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
 * Callers go through resolveOnce/resolveNode so each node's component
 * runs at most once per render (see InternalContext.componentCache).
 */
function callComponent(node: AnyNode): AnyNode {
  const fn = node.kind as (props: Record<string, unknown>) => WidgetNode;
  return asNode(fn({ ...node.props, children: node.children }));
}

/** Memoized single invocation of a node's component within one render. */
function resolveOnce(ctx: InternalContext, node: AnyNode): AnyNode {
  let resolved = ctx.componentCache.get(node);
  if (!resolved) {
    resolved = callComponent(node);
    ctx.componentCache.set(node, resolved);
  }
  return resolved;
}

/**
 * Fully resolves function-component wrappers so parent layouts can match
 * the concrete kind (e.g. JSX `<Positioned>` resolving to PositionedKind).
 * Each link of the chain resolves through the per-render cache.
 */
function resolveNode(ctx: InternalContext, kid: AnyNode): AnyNode {
  let current = kid;
  while (typeof current.kind === "function") current = resolveOnce(ctx, current);
  return current;
}

/** ---------- layout ---------- */

interface Frame {
  w: number;
  h: number;
  // Final sizes do not reveal whether the incoming axis was unbounded or
  // tight. Keep that provenance per measurement, never in a node-only cache.
  bounds?: Constraints;
}

interface Constraints {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
}

interface ChildPlacement {
  kid: AnyNode;
  frame: Frame;
  x: number;
  y: number;
}

interface NodeLayout {
  frame: Frame;
  children: ChildPlacement[];
}

function nonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new LayoutError("INVALID_CONSTRAINT", `${name} must be a finite nonnegative number`);
  }
  return value;
}

function dimension(props: Record<string, unknown>, name: string): number | undefined {
  return typeof props[name] === "number" ? nonnegative(props[name], name) : undefined;
}

function offset(props: Record<string, unknown>, name: string): number | undefined {
  const value = props[name];
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) throw new LayoutError("INVALID_CONSTRAINT", `${name} must be finite`);
  return value;
}

function gapOf(props: Record<string, unknown>): number {
  return nonnegative(spacing(props.gap, 0), "gap");
}

function paddingOf(props: Record<string, unknown>, fallback: number): number {
  return nonnegative(spacing(props.padding, fallback), "padding");
}

function loose(maxW: number, maxH = Infinity): Constraints {
  return { minW: 0, maxW, minH: 0, maxH };
}

function tight(frame: Frame): Constraints {
  return { minW: frame.w, maxW: frame.w, minH: frame.h, maxH: frame.h };
}

function constrain(frame: Frame, bounds: Constraints): Frame {
  return {
    w: Math.min(Math.max(nonnegative(frame.w, "measured width"), bounds.minW), bounds.maxW),
    h: Math.min(Math.max(nonnegative(frame.h, "measured height"), bounds.minH), bounds.maxH),
  };
}

function inset(bounds: Constraints, pad: number): Constraints {
  return {
    minW: Math.max(0, bounds.minW - pad * 2),
    maxW: Math.max(0, bounds.maxW - pad * 2),
    minH: Math.max(0, bounds.minH - pad * 2),
    maxH: Math.max(0, bounds.maxH - pad * 2),
  };
}

function withDimensions(bounds: Constraints, props: Record<string, unknown>): Constraints {
  const width = dimension(props, "width");
  const height = dimension(props, "height");
  const w = width === undefined ? undefined : Math.min(Math.max(width, bounds.minW), bounds.maxW);
  const h = height === undefined ? undefined : Math.min(Math.max(height, bounds.minH), bounds.maxH);
  return {
    minW: w ?? bounds.minW, maxW: w ?? bounds.maxW,
    minH: h ?? bounds.minH, maxH: h ?? bounds.maxH,
  };
}

/** A decorating wrapper passes its inner constraints to its single child. */
function decorationLayout(ctx: InternalContext, node: AnyNode, bounds: Constraints, pad = 0, gap = 0): NodeLayout {
  const inner = inset(bounds, pad);
  const kids = childNodes(node);
  const frames = kids.map((kid) => measure(ctx, kid, kids.length === 1 ? inner : loose(inner.maxW)));
  let y = pad;
  const children = kids.map((kid, index) => {
    const frame = frames[index]!;
    const child = { kid, frame, x: pad, y };
    y += frame.h + (index < kids.length - 1 ? gap : 0);
    return child;
  });
  return {
    frame: constrain({ w: pad * 2 + Math.max(...frames.map((frame) => frame.w), 0), h: y + pad }, bounds),
    children,
  };
}

/** Shared flex measurement/placement: both passes use the same assigned boxes. */
function flexLayout(ctx: InternalContext, node: AnyNode, bounds: Constraints, axis: "row" | "column"): NodeLayout {
  const horizontal = axis === "row";
  const pad = paddingOf(node.props, 0);
  const gap = gapOf(node.props);
  const inner = inset(bounds, pad);
  const mainMax = horizontal ? inner.maxW : inner.maxH;
  const crossMax = horizontal ? inner.maxH : inner.maxW;
  const align = crossAlignOf(node.props, horizontal ? "center" : "start");
  const kids = childNodes(node).map((kid) => resolveNode(ctx, kid));
  const flexes = kids.map((kid) => {
    if (kid.kind !== ExpandedKind) return 0;
    const value = kid.props.flex ?? 1;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new LayoutError("INVALID_CONSTRAINT", "Expanded flex must be a positive finite number");
    }
    return value;
  });
  const flexSum = flexes.reduce((sum, value) => sum + value, 0);
  if (flexSum > 0 && !Number.isFinite(mainMax)) {
    throw new LayoutError("UNBOUNDED_FLEX", `Expanded requires a bounded ${axis} main axis`);
  }
  if (!Number.isFinite(flexSum)) {
    throw new LayoutError("INVALID_CONSTRAINT", "Combined flex must be finite");
  }
  const crossTight = align === "stretch" && Number.isFinite(crossMax);
  const childBounds = (share?: number): Constraints => horizontal
    ? { minW: share ?? 0, maxW: share ?? mainMax,
        minH: crossTight ? crossMax : 0, maxH: crossMax }
    : { minW: crossTight ? crossMax : 0, maxW: crossMax,
        minH: share ?? 0, maxH: share ?? Infinity };
  const frames = kids.map((kid, index) => flexes[index]! > 0
    ? { w: 0, h: 0 }
    : measure(ctx, kid, childBounds()));
  const gaps = nonnegative(gap * Math.max(kids.length - 1, 0), "combined gaps");

  // Preserve the prototype's documented wrapping/shrink behavior for a Row
  // without Expanded. Bounded vertical flex never shrinks intrinsic content.
  if (horizontal && flexSum === 0) {
    const available = Math.max(mainMax - gaps, 0);
    const natural = frames.reduce((sum, frame) => sum + frame.w, 0);
    let excess = natural - available;
    if (excess > 0) {
      const shrinkable = kids.map((kid, index) => ({ kid, index }))
        .filter(({ kid }) => kid.kind === "text" || kid.kind === "column" || kid.kind === "row");
      const total = shrinkable.reduce((sum, entry) => sum + frames[entry.index]!.w, 0);
      for (const entry of shrinkable) {
        const previous = frames[entry.index]!;
        const share = total > 0 ? previous.w / total : 1 / shrinkable.length;
        const reduced = Math.max(previous.w - excess * share, Math.min(96, previous.w));
        const taken = previous.w - reduced;
        if (taken > 0) {
          frames[entry.index] = measure(ctx, entry.kid, { ...childBounds(), maxW: reduced });
          excess -= taken;
        }
        if (excess <= 0) break;
      }
    }
  }

  const fixedMain = nonnegative(frames.reduce((sum, frame) => sum + (horizontal ? frame.w : frame.h), 0), "combined child size");
  const free = Number.isFinite(mainMax) ? Math.max(mainMax - gaps - fixedMain, 0) : 0;
  flexes.forEach((flex, index) => {
    if (flex > 0) frames[index] = measure(ctx, kids[index]!, childBounds(free * (flex / flexSum)));
  });
  // An intrinsically sized Row discovers its cross extent first. Stretch
  // then deliberately remeasures children with that height, within layout;
  // paint must not reinterpret every natural Row child as a tight one.
  if (horizontal && align === "stretch" && !Number.isFinite(crossMax)) {
    const height = Math.max(...frames.map((frame) => frame.h), 0);
    frames.forEach((frame, index) => {
      if (!frame.bounds) throw new LayoutError("INVALID_CONSTRAINT", "Missing measured child constraints");
      frames[index] = measure(ctx, kids[index]!, { ...frame.bounds, minH: height, maxH: height });
    });
  }
  const naturalMain = nonnegative(frames.reduce((sum, frame) => sum + (horizontal ? frame.w : frame.h), 0) + gaps, "combined child size");
  const naturalCross = Math.max(...frames.map((frame) => horizontal ? frame.h : frame.w), 0);
  const main = Number.isFinite(mainMax) ? mainMax : naturalMain;
  const frame = constrain(horizontal
    ? { w: main + pad * 2, h: naturalCross + pad * 2 }
    : { w: naturalCross + pad * 2, h: main + pad * 2 }, bounds);
  const availableMain = Math.max((horizontal ? frame.w : frame.h) - pad * 2, 0);
  const availableCross = Math.max((horizontal ? frame.h : frame.w) - pad * 2, 0);
  const slack = Math.max(availableMain - naturalMain, 0);
  const justify = node.props.justify ?? "start";
  const between = justify === "between" && kids.length > 1 ? slack / (kids.length - 1) : 0;
  const around = justify === "around" && kids.length > 0 ? slack / kids.length : 0;
  let cursor = pad + (justify === "end" ? slack : justify === "center" ? slack / 2 : around / 2);
  const children = kids.map((kid, index) => {
    const child = frames[index]!;
    const cross = horizontal ? child.h : child.w;
    const crossOffset = pad + (align === "end" ? availableCross - cross : align === "center" ? (availableCross - cross) / 2 : 0);
    const placement = { kid, frame: child, x: horizontal ? cursor : crossOffset, y: horizontal ? crossOffset : cursor };
    cursor += (horizontal ? child.w : child.h) + gap + between + around;
    return placement;
  });
  return { frame, children };
}

function scrollLayout(ctx: InternalContext, node: AnyNode, bounds: Constraints): NodeLayout {
  // TN-156 frozen scroll semantics: the container's box is the VIEWPORT —
  // bounded by the parent — while content lays out under an UNBOUNDED main
  // axis and keeps its intrinsic size. Overflow is preserved; nothing is
  // clamped, shrunk, or re-measured to fit.
  const pad = paddingOf(node.props, 0);
  const gap = gapOf(node.props);
  const inner = inset(bounds, pad);
  const kids = childNodes(node).map((kid) => resolveNode(ctx, kid));
  for (const kid of kids) {
    if (kid.kind === ScrollViewKind) {
      throw new LayoutError("INVALID_CONSTRAINT", "Nested ScrollView is not part of this scroll contract yet");
    }
  }
  if (!Number.isFinite(bounds.maxH)) {
    // A viewport that does not exist cannot scroll: an unbounded parent
    // allocation is a contract error, not a silent content-height column
    // (Flutter's unbounded-ListView behavior — fail-visible, never an
    // accident of the layout).
    throw new LayoutError("UNBOUNDED_FLEX", "ScrollView requires a bounded main axis (e.g. inside Expanded)");
  }
  const frames = kids.map((kid) => measure(ctx, kid, { minW: 0, maxW: inner.maxW, minH: 0, maxH: Infinity }));
  const gaps = nonnegative(gap * Math.max(kids.length - 1, 0), "combined gaps");
  const naturalMain = nonnegative(frames.reduce((sum, frame) => sum + frame.h, 0) + gaps, "content height");
  const naturalCross = Math.max(...frames.map((frame) => frame.w), 0);
  const viewportW = Number.isFinite(inner.maxW) ? inner.maxW : naturalCross;
  const viewportH = Number.isFinite(inner.maxH) ? inner.maxH : naturalMain;
  const frame = constrain({ w: viewportW + pad * 2, h: viewportH + pad * 2 }, bounds);
  let cursor = pad;
  const children = kids.map((kid, index) => {
    const child = frames[index]!;
    const placement = { kid, frame: child, x: pad, y: cursor };
    cursor += child.h + gap;
    return placement;
  });
  return { frame, children };
}

function stackLayout(ctx: InternalContext, node: AnyNode, bounds: Constraints): NodeLayout {
  const kids = childNodes(node).map((kid) => resolveNode(ctx, kid));
  const baseIndex = kids.findIndex((kid) => kid.kind !== PositionedKind);
  const base = kids[baseIndex];
  const baseFrame = base ? measure(ctx, base, loose(bounds.maxW, bounds.maxH)) : undefined;
  const frame = constrain(baseFrame ?? { w: 0, h: 0 }, bounds);
  const rawAlign = typeof node.props.alignment === "string" ? node.props.alignment : "topLeft";
  const alignment = STACK_ALIGNMENT[rawAlign] ?? STACK_ALIGNMENT.topLeft!;
  const children: ChildPlacement[] = [];
  for (const [index, kid] of kids.entries()) {
    if (kid.kind !== PositionedKind) {
      // The sizing child keeps its original incoming constraints. Measuring
      // it again against the discovered frame would turn natural height into
      // a bounded axis and alter descendants (for example a centered Row).
      const child = index === baseIndex && baseFrame
        ? baseFrame
        : measure(ctx, kid, loose(frame.w, frame.h));
      children.push({ kid, frame: child, x: (frame.w - child.w) * alignment.ax, y: (frame.h - child.h) * alignment.ay });
      continue;
    }
    const left = offset(kid.props, "left");
    const right = offset(kid.props, "right");
    const top = offset(kid.props, "top");
    const bottom = offset(kid.props, "bottom");
    const width = left !== undefined && right !== undefined ? Math.max(frame.w - left - right, 0) : undefined;
    const height = top !== undefined && bottom !== undefined ? Math.max(frame.h - top - bottom, 0) : undefined;
    const childBounds: Constraints = {
      minW: width ?? 0, maxW: width ?? frame.w,
      minH: height ?? 0, maxH: height ?? frame.h,
    };
    for (const nested of childNodes(kid)) {
      const child = measure(ctx, nested, childBounds);
      children.push({
        kid: nested, frame: child,
        x: left ?? (right === undefined ? 0 : frame.w - right - child.w),
        y: top ?? (bottom === undefined ? 0 : frame.h - bottom - child.h),
      });
    }
  }
  return { frame, children };
}

function scaffoldLayout(ctx: InternalContext, node: AnyNode, bounds: Constraints): NodeLayout {
  const kids = widgetChildren(node).map((kid) => resolveNode(ctx, kid));
  const appBar = kids.find((kid) => kid.kind === "app-bar");
  const bodies = kids.filter((kid) => kid !== appBar);
  const barFrame = appBar ? measure(ctx, appBar, { ...loose(bounds.maxW), minW: bounds.maxW }) : { w: 0, h: 0 };
  const available = Number.isFinite(bounds.maxH) ? Math.max(bounds.maxH - barFrame.h, 0) : Infinity;
  const children: ChildPlacement[] = appBar ? [{ kid: appBar, frame: barFrame, x: 0, y: 0 }] : [];
  let y = barFrame.h;
  for (const kid of bodies) {
    const child = measure(ctx, kid, {
      minW: bounds.maxW, maxW: bounds.maxW,
      minH: bodies.length === 1 && Number.isFinite(available) ? available : 0,
      maxH: bodies.length === 1 ? available : Infinity,
    });
    children.push({ kid, frame: child, x: 0, y });
    y += child.h;
  }
  return { frame: constrain({ w: bounds.maxW, h: y }, bounds), children };
}

function measure(ctx: InternalContext, node: AnyNode, boundsOrWidth: Constraints | number): Frame {
  const bounds = typeof boundsOrWidth === "number" ? loose(boundsOrWidth) : boundsOrWidth;
  return { ...measureNode(ctx, node, bounds), bounds };
}

function measureNode(ctx: InternalContext, node: AnyNode, bounds: Constraints): Frame {
  const { kind, props } = node;
  if (typeof kind === "function") return measure(ctx, resolveOnce(ctx, node), bounds);
  if (kind === TextFieldKind) {
    resolveTextFieldProps(props);
    return constrain({ w: Number.isFinite(bounds.maxW) ? bounds.maxW : 240, h: 72 }, bounds);
  }
  if (kind === Canvas) {
    return constrain({ w: dimension(props, "width") ?? bounds.maxW, h: dimension(props, "height") ?? 0 }, bounds);
  }
  if (kind === ThemeScope) return decorationLayout(ctx, node, bounds).frame;
  if (kind === SizedBoxKind) {
    const own = withDimensions(bounds, props);
    const frames = childNodes(node).map((kid) => measure(ctx, kid, own));
    return constrain({ w: Math.max(...frames.map((frame) => frame.w), 0), h: Math.max(...frames.map((frame) => frame.h), 0) }, own);
  }
  if (kind === CenterKind) {
    const frames = childNodes(node).map((kid) => measure(ctx, kid, loose(bounds.maxW, bounds.maxH)));
    return constrain({
      w: Number.isFinite(bounds.maxW) ? bounds.maxW : Math.max(...frames.map((frame) => frame.w), 0),
      h: Number.isFinite(bounds.maxH) ? bounds.maxH : Math.max(...frames.map((frame) => frame.h), 0),
    }, bounds);
  }
  if (kind === StackKind) return stackLayout(ctx, node, bounds).frame;
  if (kind === ScrollViewKind) return scrollLayout(ctx, node, bounds).frame;
  if (kind === WrapKind) {
    const flow = layoutWrapChildren(ctx, node, bounds.maxW);
    return constrain({ w: flow.width, h: flow.height }, bounds);
  }
  if (kind === ContainerKind) {
    const own = withDimensions(bounds, props);
    if (childNodes(node).length === 0) return constrain({ w: own.maxW, h: own.minH }, own);
    return decorationLayout(ctx, node, own, paddingOf(props, 0)).frame;
  }
  if (kind === IconKind) {
    const size = dimension(props, "size") ?? 24;
    return constrain({ w: textWidth(typeof props.glyph === "string" ? props.glyph : "", size), h: Math.round(size * 1.2) }, bounds);
  }
  if (kind === PositionedKind || kind === ExpandedKind || kind === GestureDetectorKind || typeof kind === "symbol") {
    return decorationLayout(ctx, node, bounds).frame;
  }
  switch (kind) {
    case "text": {
      const ty = typography(props.variant);
      const lines = wrapText(textContent(node), ty.size, Math.max(bounds.maxW, 1));
      const widest = Math.max(...lines.map((line) => textWidth(line, ty.size)));
      return constrain({ w: Math.min(widest, bounds.maxW), h: lines.length * ty.lineHeight }, bounds);
    }
    case "button": {
      const label = textContent(node) || "Button";
      return constrain({ w: Math.max(96, textWidth(label, TYPOGRAPHY.body!.size) + 48), h: 64 }, bounds);
    }
    case "card": return decorationLayout(ctx, node, bounds, paddingOf(props, 16), spacing("sm", 8)).frame;
    case "column": return flexLayout(ctx, node, bounds, "column").frame;
    case "row": return flexLayout(ctx, node, bounds, "row").frame;
    case "app-bar": return constrain({ w: bounds.maxW, h: 96 }, bounds);
    case "spacer": return constrain({ w: 0, h: nonnegative(spacing(props.size, 16), "spacer size") }, bounds);
    case "scaffold": return scaffoldLayout(ctx, node, bounds).frame;
    default: return constrain({ w: 0, h: 0 }, bounds);
  }
}

function placeChildren(ctx: InternalContext, layout: NodeLayout, x: number, y: number): void {
  for (const child of layout.children) place(ctx, child.kid, x + child.x, y + child.y, child.frame);
}

/** Approximate single-line paint window; the descriptor always carries full text. */
function fieldTextWindow(text: string, size: number, width: number, offset = 0): { text: string; x: number } {
  let cursor = 0;
  let start = 0;
  let visible = "";
  for (const character of text) {
    const advance = textWidth(character, size);
    if (cursor >= offset && cursor + advance <= offset + width) {
      if (visible.length === 0) start = cursor - offset;
      visible += character;
    }
    cursor += advance;
    if (cursor > offset + width) break;
  }
  return { text: visible, x: start };
}

function placeTextField(ctx: InternalContext, rawProps: unknown, x: number, y: number, w: number, h: number): void {
  const props = resolveTextFieldProps(rawProps);
  if (ctx.textFieldIds.has(props.id)) {
    throw new TextInputError("DUPLICATE_TEXT_FIELD", `TextField id "${props.id}" appears more than once in a screen`);
  }
  ctx.textFieldIds.add(props.id);
  const descriptor = textInputDescriptor(props, { x, y, w, h }, ctx.textInput?.active);
  ctx.textFields.push({ props, descriptor });
  const C = ctx.palette;
  // Legacy roles have dark defaults. This ordinary field follows the active
  // theme's paired surface/text values without changing global role semantics.
  const surface = ctx.theme.colors?.surfaceRaised ?? ctx.theme.colors?.surface ?? C.surfaceContainer;
  const foreground = ctx.theme.colors?.text ?? C.onSurface;
  const inset = Math.min(12, w / 2);
  const innerWidth = Math.max(0, w - inset * 2);
  const verticalInset = Math.min(2, h / 2);
  const clip: TextClip = { x: x + inset, y: y + verticalInset, w: innerWidth, h: Math.max(0, h - verticalInset * 2) };
  const size = Math.min(17, h / 3);
  const baseline = y + Math.min(h, props.label ? h * 0.72 : h / 2 + size * 0.36);
  const textTop = Math.max(y, baseline - size);
  const radius = Math.min(8, w / 2, h / 2);
  ctx.ops.push({ op: "rect", x, y, w, h, r: radius, color: surface });
  ctx.ops.push({ op: "outline", x, y, w, h, r: radius,
    color: descriptor.focused ? C.primary : C.outline, width: descriptor.focused ? 2 : 1 });
  if (props.label && innerWidth > 0 && h > 0) {
    const labelSize = Math.min(12, size);
    ctx.ops.push({ op: "text", x: x + inset, y: y + Math.min(h, 17),
      text: fieldTextWindow(props.label, labelSize, innerWidth).text,
      size: labelSize, weight: 500, color: descriptor.focused ? C.primary : foreground, clip });
  }
  const extentX = textWidth(descriptor.text.slice(0, descriptor.selection.extent), size);
  const offset = descriptor.focused ? Math.max(0, extentX - innerWidth + 1) : 0;
  const position = (index: number): number =>
    x + inset + Math.max(0, Math.min(innerWidth, textWidth(descriptor.text.slice(0, index), size) - offset));
  let selected: TextClip | undefined;
  if (descriptor.focused && descriptor.selection.base !== descriptor.selection.extent) {
    const left = position(Math.min(descriptor.selection.base, descriptor.selection.extent));
    const right = position(Math.max(descriptor.selection.base, descriptor.selection.extent));
    selected = { x: left, y: textTop, w: right - left, h: Math.max(0, Math.min(h, size * 1.2)) };
    ctx.ops.push({ op: "rect", ...selected, r: 0, color: C.primaryContainer });
  }
  const shown = descriptor.text || props.placeholder;
  const window = fieldTextWindow(shown, size, innerWidth, descriptor.text ? offset : 0);
  if (window.text && h > 0) {
    const text: TextOp = { op: "text", x: x + inset + window.x, y: baseline, text: window.text,
      size, weight: 400, color: foreground, clip };
    ctx.ops.push(text);
    // Selection has its own paired foreground, including under a light theme.
    if (selected) ctx.ops.push({ ...text, color: C.onPrimaryContainer, clip: selected });
  }
  if (descriptor.focused && descriptor.composing) {
    ctx.ops.push({ op: "line", x1: position(descriptor.composing.start), x2: position(descriptor.composing.end),
      y1: Math.min(y + h, baseline + 2), y2: Math.min(y + h, baseline + 2), width: 1, color: C.primary });
  }
  if (descriptor.focused && descriptor.selection.base === descriptor.selection.extent) {
    ctx.ops.push({ op: "line", x1: position(descriptor.selection.extent), x2: position(descriptor.selection.extent),
      y1: textTop, y2: Math.min(y + h, baseline + 2), width: 1, color: C.primary });
  }
  ctx.ops.push(descriptor);
  if (!props.readOnly) {
    addTap(ctx, x, y, w, h, () => {
      if (!ctx.textInput) {
        throw new TextInputError("TEXT_INPUT_RUNTIME_REQUIRED", "Editable TextField focus requires ApplicationRuntime");
      }
      ctx.textInput.focus(props.id);
    });
  }
}

/**
 * Paints a measured node using its final size and original incoming bounds.
 * Reusing those bounds preserves natural layout versus tight allocation.
 */
function place(ctx: InternalContext, node: AnyNode, x: number, y: number, frame: Frame): number {
  const { kind, props } = node;
  const { w, h, bounds } = frame;
  if (!bounds) throw new LayoutError("INVALID_CONSTRAINT", "Placement requires the measured constraints");

  if (typeof kind === "function") {
    return place(ctx, resolveOnce(ctx, node), x, y, frame);
  }
  if (kind === TextFieldKind) {
    placeTextField(ctx, props, x, y, w, h);
    return h;
  }
  if (kind === Canvas) {
    const fixedCanvas = props.fixed === true;
    const width = fixedCanvas ? ctx.designWidth : w;
    const height = h;
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
            "tap",
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
    placeChildren(scoped, decorationLayout(scoped, node, bounds), x, y);
    return h;
  }
  if (kind === SizedBoxKind) {
    for (const kid of childNodes(node)) {
      const child = measure(ctx, kid, withDimensions(bounds, props));
      place(ctx, kid, x, y, child);
    }
    return h;
  }
  if (kind === CenterKind) {
    for (const kid of childNodes(node)) {
      const child = measure(ctx, kid, loose(bounds.maxW, bounds.maxH));
      place(ctx, kid, x + (w - child.w) / 2, y + (h - child.h) / 2, child);
    }
    return h;
  }
  if (kind === StackKind) {
    placeChildren(ctx, stackLayout(ctx, node, bounds), x, y);
    return h;
  }
  if (kind === ScrollViewKind) {
    const layout = scrollLayout(ctx, node, bounds);
    const regionId = typeof props.id === "string" && props.id.length > 0
      ? props.id
      : `scroll@${x},${y},${w},${h}`;
    // Children paint into a NESTED ops list at the content origin: their
    // coordinates become content-space by construction, and the taps they
    // register are tagged with the region id so hosts hit-test them with
    // this region's offset. tapRuns stays shared — payload ids are global.
    const outerOps = ctx.ops;
    const outerTaps = ctx.tapRegions;
    ctx.ops = [];
    ctx.tapRegions = [];
    let nestedOps: DisplayOp[] = [];
    let nestedTaps: SerializedTap[] = [];
    try {
      placeChildren(ctx, layout, 0, 0);
      nestedOps = ctx.ops as DisplayOp[];
      nestedTaps = ctx.tapRegions;
    } finally {
      ctx.ops = outerOps;
      ctx.tapRegions = outerTaps;
    }
    const contentHeight = layout.children.length > 0
      ? Math.max(...layout.children.map((child) => child.y + child.frame.h)) + paddingOf(props, 0)
      : 0;
    for (const tap of nestedTaps) outerTaps.push({ ...tap, scroll: regionId });
    outerOps.push({ op: "scroll-region", id: regionId, x, y, w, h, contentHeight, ops: nestedOps });
    return h;
  }
  if (kind === ExpandedKind || kind === PositionedKind) {
    placeChildren(ctx, decorationLayout(ctx, node, bounds), x, y);
    return h;
  }
  if (kind === GestureDetectorKind) {
    placeChildren(ctx, decorationLayout(ctx, node, bounds), x, y);
    // Gesture geometry is the assigned box, including tight flex dimensions.
    if (typeof props.onTap === "function") addTap(ctx, x, y, w, h, props.onTap as () => void);
    if (typeof props.onLongPress === "function") {
      addTap(ctx, x, y, w, h, props.onLongPress as () => void, "long-press");
    }
    return h;
  }
  if (kind === ContainerKind) {
    const pad = paddingOf(props, 0);
    const radius = dimension(props, "radius") ?? 0;
    const fill = roleColor(ctx, props.color);
    if (fill !== undefined) {
      const shadow = typeof props.shadow === "number" ? props.shadow : undefined;
      ctx.ops.push({ op: "rect", x, y, w, h, r: radius, color: fill, ...(shadow ? { shadow } : {}) });
    }
    const stroke = roleColor(ctx, props.borderColor);
    if (stroke !== undefined) {
      const width = dimension(props, "borderWidth") ?? 3;
      ctx.ops.push({ op: "outline", x, y, w, h, r: radius, color: stroke, width });
    }
    placeChildren(ctx, decorationLayout(ctx, node, withDimensions(bounds, props), pad), x, y);
    return h;
  }
  if (kind === IconKind) {
    const size = dimension(props, "size") ?? 24;
    const glyph = typeof props.glyph === "string" ? props.glyph : "";
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
    const flow = layoutWrapChildren(ctx, node, bounds.maxW);
    let cursorY = y;
    for (const line of flow.lines) {
      let cursorX = x;
      for (const entry of line.entries) {
        place(ctx, entry.kid, cursorX, cursorY, entry.frame);
        cursorX += entry.frame.w + flow.spacing;
      }
      cursorY += line.height + flow.runSpacing;
    }
    return h;
  }
  if (typeof kind === "symbol") {
    placeChildren(ctx, decorationLayout(ctx, node, bounds), x, y);
    return h;
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
      return h;
    }
    case "button": {
      const ty = TYPOGRAPHY.body!;
      const label = textContent(node) || "Button";
      const variant = typeof props.variant === "string" ? props.variant : "primary";
      const palette = ctx.theme.colors ?? {};
      const accent = palette.accent ?? "#4C8DFF";
      const danger = palette.danger ?? "#FF5A5F";
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
      const elevated = props.background === "surface" || props.elevation === true;
      ctx.ops.push({
        op: "rect", x, y, w, h,
        r: radius(props.radius, 14),
        color: roleColor(ctx, props.background) ?? ctx.theme.colors?.surfaceRaised ?? "#1C1C24",
        ...(elevated ? { shadow: 12 } : {}),
      });
      placeChildren(ctx, decorationLayout(ctx, node, bounds, pad, spacing("sm", 8)), x, y);
      return h;
    }
    case "column":
    case "row": {
      placeChildren(ctx, flexLayout(ctx, node, bounds, kind), x, y);
      return h;
    }
    case "app-bar": {
      ctx.ops.push({ op: "rect", x, y, w, h, r: 0, color: ctx.theme.colors?.surface ?? "#101014" });
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
      return h;
    }
    case "spacer":
      return h;
    case "scaffold": {
      ctx.ops.push({ op: "rect", x, y, w, h, r: 0, color: ctx.theme.colors?.surface ?? "#101014" });
      placeChildren(ctx, scaffoldLayout(ctx, node, bounds), x, y);
      return h;
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
  if (op.op === "scroll-region") {
    // Only the viewport box translates; nested ops are content-space by
    // construction and must not shift with the region's position.
    return { ...op, x: op.x + dx, y: op.y + dy };
  }
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
    case "text": {
      const clip = op.clip === undefined ? undefined : validateTextClip(op.clip);
      const moved = fixed
        ? { ...op, ...meta, x: op.x, y: op.y }
        : { ...op, x: op.x + dx, y: op.y + dy };
      return clip === undefined ? moved : { ...moved,
        clip: { ...clip, x: clip.x + (fixed ? 0 : dx), y: clip.y + (fixed ? 0 : dy) } };
    }
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

/** ---------- context / entry ---------- */

function addTap(
  ctx: InternalContext,
  x: number,
  y: number,
  w: number,
  h: number,
  run: () => void,
  action: TapRegionAction = "tap",
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
    action,
    payload: { id },
    ...(fixed ? { fixed: true } : {}),
    ...(fixed && anchor ? { anchor } : {}),
    ...(fixed && anchorSize !== undefined ? { anchorSize } : {}),
  });
}

/**
 * Lays out a tree at an unbounded-height design width, or in a finite viewport.
 * Explicitly sized ancestors can bound subtrees in either mode. Returns the
 * host scene and live callbacks (index-aligned with `scene.taps`). The optional
 * input delegate belongs to ApplicationRuntime; discovered field bindings stay
 * in TypeScript and never enter the serialized scene or application snapshot.
 */
export function layoutScreen(
  theme: ThemeConfig,
  tree: WidgetNode,
  viewportOrWidth: number | LayoutViewport = DESIGN_WIDTH,
  textInput?: TextInputLayoutDelegate,
): { scene: DisplayListScene; tapRuns: Array<() => void>; textFields: TextFieldBinding[] } {
  const viewport = typeof viewportOrWidth === "number" ? undefined : validateLayoutViewport(viewportOrWidth);
  const designWidth = typeof viewportOrWidth === "number" ? viewportOrWidth : viewport!.width;
  if (!Number.isFinite(designWidth) || designWidth <= 0) {
    throw new LayoutError("INVALID_VIEWPORT", "Design width must be a positive finite number");
  }
  const ctx: InternalContext = {
    theme,
    designWidth,
    palette: resolveRoles(theme),
    ops: [],
    tapRegions: [],
    tapRuns: [],
    textFields: [],
    textFieldIds: new Set(),
    textInput,
    componentCache: new Map(),
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
  const root = resolveNode(ctx, asNode(tree));
  const explicitRootWidth = root.kind === SizedBoxKind ||
    ((root.kind === ContainerKind || root.kind === Canvas) && typeof root.props.width === "number");
  const bounds: Constraints = viewport
    ? tight({ w: viewport.width, h: viewport.height })
    : { minW: explicitRootWidth ? 0 : designWidth, maxW: designWidth, minH: 0, maxH: Infinity };
  const frame = measure(ctx, root, bounds);
  place(ctx, root, 0, 0, frame);
  const scene = ctx.finish();
  scene.contentHeight = frame.h;
  return { scene, tapRuns: ctx.tapRuns, textFields: ctx.textFields };
}

/**
 * Structural layout widgets — the Flutter migration tier of @tenunjs/widgets.
 *
 * These mirror Flutter's layout vocabulary (SizedBox, Center, Stack,
 * Positioned, Expanded, GestureDetector, Container, Icon, Spacer, Wrap) so a
 * Flutter screen ports over almost name-for-name, while keeping TenunJS
 * improvements: `gap` instead of inter-child spacers, flat Container
 * decoration instead of BoxDecoration nesting, and one Button with variants
 * instead of four button classes.
 *
 * Each widget is a function component emitting a virtual layout symbol —
 * the Fragment precedent: never a HostWidgetKind value, so the TN-034 ABI
 * map stays untouched. The display-list engine lowers these symbols to
 * plain ops + taps; a future native host maps them onto the TN-034 kind
 * registry instead.
 */

import { HostWidgetKind } from "@tenunjs/protocol";
import { jsx, type WidgetChild, type WidgetNode } from "@tenunjs/jsx-runtime";

/**
 * Builds a virtual layout node. Children arrive either through JSX
 * (`children`) or the Flutter-style `child` prop; both normalize onto the
 * node like every other widget.
 */
function virtual<P extends object>(kind: symbol, props: P): WidgetNode {
  return {
    kind,
    key: null,
    props,
    children: childrenOf(props as Record<string, unknown>),
  } as unknown as WidgetNode;
}

function flatten(into: WidgetChild[], child: WidgetChild): void {
  if (child === null || child === undefined || typeof child === "boolean") return;
  if (Array.isArray(child)) {
    for (const item of child) flatten(into, item);
    return;
  }
  into.push(child);
}

function childrenOf(props: Record<string, unknown>): readonly WidgetChild[] {
  const kids: WidgetChild[] = [];
  flatten(kids, props.child as WidgetChild | undefined);
  flatten(kids, props.children as WidgetChild | undefined);
  return Object.freeze(kids);
}

/** ---------- SizedBox ---------- */

export const SizedBoxKind = Symbol.for("tenun.widgets.sized-box");

export interface SizedBoxProps {
  /** Tight width in design units; omit to size to the child. */
  width?: number;
  /** Tight height in design units; omit to size to the child. */
  height?: number;
  child?: WidgetChild;
  children?: WidgetChild;
}

/** Flutter's SizedBox — a fixed-size box wrapping (or standing in for) a child. */
export function SizedBox(props: SizedBoxProps): WidgetNode {
  return virtual(SizedBoxKind, props);
}

/** ---------- Center ---------- */

export const CenterKind = Symbol.for("tenun.widgets.center");

export interface CenterProps {
  child?: WidgetChild;
  children?: WidgetChild;
}

/**
 * Flutter's Center — claims the available width and centers the child
 * horizontally. Inside a Stack, pair with the stack's alignment for both
 * axes.
 */
export function Center(props: CenterProps): WidgetNode {
  return virtual(CenterKind, props);
}

/** ---------- Stack ---------- */

export const StackKind = Symbol.for("tenun.widgets.stack");

export type StackAlignment =
  | "topLeft"
  | "topCenter"
  | "topRight"
  | "centerLeft"
  | "center"
  | "centerRight"
  | "bottomLeft"
  | "bottomCenter"
  | "bottomRight";

export interface StackProps {
  /** Where non-positioned children sit inside the stack frame. */
  alignment?: StackAlignment;
  child?: WidgetChild;
  children?: WidgetChild;
}

/**
 * Flutter's Stack — children paint in declaration order (later children on
 * top, matching the hosts' topmost-region-wins tap resolution). The frame is
 * the largest non-positioned child; `Positioned` children place by offset
 * and do not size the stack. The classic "canvas" pattern: an invisible
 * `SizedBox` as the first child sizes the stack, everything else positions
 * over it.
 */
export function Stack(props: StackProps): WidgetNode {
  return virtual(StackKind, props);
}

/** ---------- Positioned ---------- */

export const PositionedKind = Symbol.for("tenun.widgets.positioned");

export interface PositionedProps {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  child?: WidgetChild;
  children?: WidgetChild;
}

/**
 * Flutter's Positioned — only meaningful as a Stack child. Giving both
 * `left` and `right` (or both `top` and `bottom`) stretches the child across
 * that axis.
 */
export function Positioned(props: PositionedProps): WidgetNode {
  return virtual(PositionedKind, props);
}

/** ---------- Expanded ---------- */

export const ExpandedKind = Symbol.for("tenun.widgets.expanded");

export interface ExpandedProps {
  /** Flex share of the free main-axis space (default 1). */
  flex?: number;
  child?: WidgetChild;
  children?: WidgetChild;
}

/**
 * Flutter's Expanded — the child takes a flex share of the Row's free width.
 * (Columns are content-height in the scrolling scene, so Column flex waits
 * for bounded-height containers.)
 */
export function Expanded(props: ExpandedProps): WidgetNode {
  return virtual(ExpandedKind, props);
}

/** ---------- GestureDetector ---------- */

export const GestureDetectorKind = Symbol.for("tenun.widgets.gesture-detector");

export interface GestureDetectorProps {
  onTap: () => void;
  child?: WidgetChild;
  children?: WidgetChild;
}

/**
 * Flutter's GestureDetector — makes any widget tappable. The tap region
 * covers the wrapped frame and registers after the child's regions, so it
 * wins the hosts' topmost-wins hit test.
 */
export function GestureDetector(props: GestureDetectorProps): WidgetNode {
  return virtual(GestureDetectorKind, props);
}

/** ---------- Container ---------- */

export const ContainerKind = Symbol.for("tenun.widgets.container");

export interface ContainerProps {
  /** Fill color: a `#rrggbb` literal or a palette role name (e.g. "primary"). */
  color?: string;
  /** Corner radius in design units (0 = square, like Flutter's default). */
  radius?: number;
  /** Stroke color; sets an outline. Accepts literals and role names. */
  borderColor?: string;
  borderWidth?: number;
  /** Elevation 0..24: soft drop shadow painted under the fill. */
  shadow?: number;
  padding?: string | number;
  width?: number;
  height?: number;
  child?: WidgetChild;
  children?: WidgetChild;
}

/**
 * Flutter's Container with the decoration flattened into props — no
 * BoxDecoration nesting. Omits both size props to size to the content.
 */
export function Container(props: ContainerProps): WidgetNode {
  return virtual(ContainerKind, props);
}

/** ---------- Icon ---------- */

export const IconKind = Symbol.for("tenun.widgets.icon");

/**
 * The built-in name→glyph registry — Flutter's `Icons.xxx` vocabulary over
 * deterministic unicode glyphs, with no icon-font dependency. Plain symbols
 * (not emoji) so hosts can tint them freely.
 */
export const ICON_GLYPHS = {
  add: "+",
  arrowBack: "‹",
  arrowDown: "↓",
  arrowForward: "›",
  arrowUp: "↑",
  check: "✓",
  close: "✕",
  favorite: "♥",
  home: "⌂",
  menu: "☰",
  remove: "−",
  search: "⌕",
  settings: "⚙",
  star: "★",
} as const;

export type IconName = keyof typeof ICON_GLYPHS;

export interface IconProps {
  /** Glyph character (unicode symbol or emoji) — or use `name`. */
  glyph?: string;
  /** Built-in icon name (see ICON_GLYPHS) — or use `glyph`. */
  name?: IconName;
  /** Glyph size in design units (Flutter defaults to 24). */
  size?: number;
  /** Color literal or palette role name; defaults to onSurface. */
  color?: string;
}

/**
 * Flutter's Icon — glyph-based, resolved from `name` or given directly as
 * `glyph`. Fail-closed: exactly one of the two must be present.
 */
export function Icon(props: IconProps): WidgetNode {
  if (props.glyph !== undefined && props.name !== undefined) {
    throw new Error("[TENUN_ICON_ERROR] Icon accepts glyph or name, not both");
  }
  const glyph =
    props.glyph !== undefined
      ? props.glyph
      : props.name !== undefined
        ? ICON_GLYPHS[props.name]
        : undefined;
  if (typeof glyph !== "string") {
    throw new Error("[TENUN_ICON_ERROR] Icon requires a glyph or a known name");
  }
  return virtual(IconKind, {
    glyph,
    ...(props.size !== undefined ? { size: props.size } : {}),
    ...(props.color !== undefined ? { color: props.color } : {}),
  });
}

/** ---------- Spacer ---------- */

export interface SpacerProps {
  /** Gap token ("xs".."xl") or design units; default "md" (16). */
  size?: string | number;
}

/**
 * Fixed vertical space inside a Column. Rows space their children with
 * `gap` (or `Expanded` for proportional gaps) — the deliberate improvement
 * over Flutter's `SizedBox(height: 8)` filler pattern.
 */
export function Spacer(props: SpacerProps): WidgetNode {
  return jsx(HostWidgetKind.SPACER, { size: props.size });
}

/** ---------- Wrap ---------- */

export const WrapKind = Symbol.for("tenun.widgets.wrap");

export interface WrapProps {
  /** Horizontal gap between children on the same line. */
  spacing?: string | number;
  /** Vertical gap between lines. */
  runSpacing?: string | number;
  child?: WidgetChild;
  children?: WidgetChild;
}

/**
 * Flutter's Wrap — children flow into lines within the available width and
 * wrap instead of overflowing. The natural home for chip rows.
 */
export function Wrap(props: WrapProps): WidgetNode {
  return virtual(WrapKind, props);
}

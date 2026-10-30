/**
 * @tenunjs/widgets
 *
 * Core layout and UI widgets for TenunJS (ADR-0004, TN-068–TN-074), and —
 * per the TN-133 extraction — the public application execution and
 * scene-lowering contract: the display-list scene model, layoutScreen
 * lowering, the ApplicationRuntime execution loop, and the host-handoff
 * commit/dispatch adapter hosts consume.
 */

import { HostWidgetKind } from "@tenunjs/protocol";
import { jsx, type WidgetChild, type WidgetNode } from "@tenunjs/jsx-runtime";
import { ScrollViewKind } from "./display-list";
import type { ColorRef } from "./theme-slots";

export * from "./structural";
export * from "./display-list";
export * from "./app-runtime";
export * from "./host-handoff";
export * from "./theme-slots";
export * from "./text-input";

export interface ThemeColors {
  surface?: string;
  surfaceRaised?: string;
  text?: string;
  accent?: string;
  danger?: string;
  [key: string]: string | undefined;
}

export interface ThemeSpacing {
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
  [key: string]: number | undefined;
}

export interface ThemeTypography {
  size: number;
  lineHeight?: number;
  weight?: number | "normal" | "bold";
}

export interface ThemeConfig {
  colors?: ThemeColors;
  spacing?: ThemeSpacing;
  radius?: Record<string, number>;
  typography?: Record<string, ThemeTypography>;
}

export function defineTheme<T extends ThemeConfig>(theme: T): Readonly<T> {
  return Object.freeze(JSON.parse(JSON.stringify(theme)));
}

export interface ThemeProviderProps {
  theme: ThemeConfig;
  children?: WidgetChild;
}

export function ThemeProvider(props: ThemeProviderProps): WidgetNode {
  return jsx(HostWidgetKind.ROOT, { theme: props.theme, children: props.children });
}

export interface ScaffoldProps {
  appBar?: WidgetNode | null;
  children?: WidgetChild;
}

export function Scaffold(props: ScaffoldProps): WidgetNode {
  const children: WidgetChild[] = [];
  if (props.appBar) children.push(props.appBar);
  if (props.children) children.push(props.children);
  return jsx(HostWidgetKind.SCAFFOLD, { children });
}

export interface AppBarProps {
  title: string;
  /** Leading burger; the M3 modal-drawer affordance. */
  onMenu?: () => void;
}

export function AppBar(props: AppBarProps): WidgetNode {
  const node = jsx(HostWidgetKind.APP_BAR, {
    title: props.title,
    ...(props.onMenu ? { onMenu: props.onMenu } : {}),
  });
  return node;
}

export interface ColumnProps {
  padding?: string | number;
  gap?: string | number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between" | "around";
  children?: WidgetChild;
}

export function Column(props: ColumnProps): WidgetNode {
  return jsx(HostWidgetKind.COLUMN, props);
}

export interface RowProps {
  padding?: string | number;
  gap?: string | number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between" | "around";
  children?: WidgetChild;
}

export function Row(props: RowProps): WidgetNode {
  return jsx(HostWidgetKind.ROW, props);
}

export interface ScrollViewProps {
  /**
   * Stable region identity across re-renders (hosts key scroll offsets by
   * it). Omitting it derives the id from the viewport box: stable while the
   * region keeps its geometry, reset when it moves or resizes.
   */
  id?: string;
  padding?: string | number;
  gap?: string | number;
  children?: WidgetChild;
}

/**
 * TN-161: an independently scrolling vertical viewport. The parent's
 * bounded allocation becomes the viewport; content lays out under an
 * unbounded main axis (TN-156's frozen semantics) and keeps its intrinsic
 * size — scrolling changes the paint offset only, never layout. Scenes
 * using it require a scroll-aware host (older hosts reject them visibly).
 */
export function ScrollView(props: ScrollViewProps): WidgetNode {
  // Symbol-kind widgets construct their node directly (the jsx() gate
  // accepts function components and HostWidgetKind strings only) — the
  // same pattern as TextField.
  const { children, ...rest } = props;
  return {
    kind: ScrollViewKind,
    key: null,
    props: rest,
    // TN-168: TSX composition naturally produces children={[list]} (an
    // array wrapping the real child array); kept verbatim, the inner
    // array reached layout as one non-node element and the region
    // rendered silently empty. Flatten nested arrays; null/undefined
    // entries (conditional children) are dropped.
    children: flattenScrollChildren(children),
  } as unknown as WidgetNode;
}

function flattenScrollChildren(children: ScrollViewProps["children"]): WidgetChild[] {
  if (children === undefined || children === null) return [];
  if (!Array.isArray(children)) return [children];
  const flattened: WidgetChild[] = [];
  const walk = (items: readonly unknown[]): void => {
    for (const item of items) {
      if (item === undefined || item === null) continue;
      if (Array.isArray(item)) walk(item);
      else flattened.push(item as WidgetChild);
    }
  };
  walk(children);
  return flattened;
}

export interface TextProps {
  variant?: "body" | "title" | "display" | string;
  /** Role name, literal, or a colorSlot() ref baked at the commit boundary (TN-173). */
  color?: string | ColorRef;
  children?: WidgetChild;
}

export function Text(props: TextProps): WidgetNode {
  return jsx(HostWidgetKind.TEXT, props);
}

export interface ButtonProps {
  /**
   * M3 families: primary renders filled (elevated), secondary renders
   * outlined, plus tonal, text, and danger.
   */
  variant?: "primary" | "secondary" | "tonal" | "text" | "danger";
  onPress?: () => void;
  children?: WidgetChild;
}

export function Button(props: ButtonProps): WidgetNode {
  return jsx(HostWidgetKind.BUTTON, props);
}

export interface CardProps {
  padding?: string | number;
  radius?: string | number;
  /** Role name, literal, or a colorSlot() ref baked at the commit boundary (TN-173). */
  background?: string | ColorRef;
  /** Elevated cards paint layered elevation under the surface. */
  elevation?: boolean;
  semantics?: Record<string, unknown>;
  children?: WidgetChild;
}

export function Card(props: CardProps): WidgetNode {
  return jsx(HostWidgetKind.CARD, props);
}

/**
 * @tenunjs/widgets
 *
 * Core layout and UI widgets for TenunJS (ADR-0004, TN-068–TN-074).
 */

import { HostWidgetKind } from "@tenunjs/protocol";
import { jsx, type WidgetChild, type WidgetNode } from "@tenunjs/jsx-runtime";

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
  lineHeight: number;
  weight?: number;
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
}

export function AppBar(props: AppBarProps): WidgetNode {
  return jsx(HostWidgetKind.APP_BAR, { title: props.title });
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

export interface TextProps {
  variant?: "body" | "title" | "display" | string;
  children?: WidgetChild;
}

export function Text(props: TextProps): WidgetNode {
  return jsx(HostWidgetKind.TEXT, props);
}

export interface ButtonProps {
  variant?: "primary" | "secondary" | "danger";
  onPress?: () => void;
  children?: WidgetChild;
}

export function Button(props: ButtonProps): WidgetNode {
  return jsx(HostWidgetKind.BUTTON, props);
}

export interface CardProps {
  padding?: string | number;
  radius?: string | number;
  background?: string;
  semantics?: Record<string, unknown>;
  children?: WidgetChild;
}

export function Card(props: CardProps): WidgetNode {
  return jsx(HostWidgetKind.CARD, props);
}

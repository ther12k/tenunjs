/**
 * @tenunjs/jsx-runtime — production automatic-JSX module.
 *
 * This is the module TypeScript's `react-jsx` transform imports through
 * the package's `./jsx-runtime` export (`jsxImportSource` resolution).
 * The development transform imports `./jsx-dev-runtime` instead, where
 * `jsxDEV` preserves source locations. Production nodes carry no source
 * metadata at all.
 */

import { HostWidgetKind, isValidWidgetKind } from "@tenunjs/protocol";
import { validateProps } from "./prop-codecs";

export type Key = string | number;

export interface SourceLocation {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export type FunctionWidget<P = any> = (props: P) => WidgetNode<any> | null;

/**
 * Virtual node marker for JSX fragments. Distinct from every
 * HostWidgetKind: a fragment carries no host semantics of its own and
 * must never consume an ABI widget-kind value (TN-034 owns those).
 */
export const Fragment = Symbol.for("tenun.fragment");

export type WidgetKind = HostWidgetKind | FunctionWidget<any> | typeof Fragment;

export interface WidgetNode<P = any> {
  readonly kind: WidgetKind;
  readonly key: Key | null;
  readonly props: Readonly<P>;
  readonly children: readonly WidgetChild[];
  readonly source?: SourceLocation;
}

export type WidgetChild =
  | WidgetNode<any>
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly WidgetChild[];

export class JsxValidationError extends Error {
  constructor(message: string) {
    super(`[TENUN_JSX_ERROR] ${message}`);
    this.name = "JsxValidationError";
  }
}

export { JsxPropValidationError } from "./prop-codecs";

/**
 * Shared node construction for the production and development
 * transforms. Normalization is identical on every JSX path: children
 * come out of props, key comes out of props or the explicit argument,
 * and — for host kinds — props pass the provisional runtime codec
 * before freezing.
 */
export function buildNode<P extends object = Record<string, unknown>>(
  type: WidgetKind,
  props: P | null | undefined,
  key?: Key
): WidgetNode<P> {
  if (type === Fragment) {
    // Fragments are virtual: no host kind, and children are extracted
    // from props exactly like the host path so normalization is identical.
    const fragmentProps = props ? { ...props } : ({} as P);
    const children = (fragmentProps as { children?: WidgetChild }).children;
    delete (fragmentProps as { children?: WidgetChild }).children;
    return {
      kind: Fragment,
      key: key ?? null,
      props: fragmentProps,
      children: normalizeChildren(children),
    };
  }

  if (typeof type !== "function" && typeof type !== "string") {
    throw new JsxValidationError(
      `Invalid widget kind: expected function component or HostWidgetKind, got ${typeof type}`
    );
  }

  if (typeof type === "string" && !isValidWidgetKind(type)) {
    throw new JsxValidationError(
      `Invalid host widget kind: "${type}" is not a known HostWidgetKind`
    );
  }

  const rawProps = props ? { ...props } : ({} as P);
  const explicitKey = key !== undefined ? key : (rawProps as { key?: Key }).key ?? null;
  delete (rawProps as { key?: Key }).key;

  const childrenProp = (rawProps as { children?: WidgetChild }).children;
  delete (rawProps as { children?: WidgetChild }).children;

  const children = normalizeChildren(childrenProp);

  if (typeof type === "string") {
    // Host kinds only: function components own their props contract.
    validateProps(type, rawProps as Record<string, unknown>);
  }

  return {
    kind: type,
    key: explicitKey,
    props: Object.freeze(rawProps),
    children,
  };
}

/**
 * Creates a TenunJS widget node (production transform entrypoint).
 * React-independent, fail-closed on invalid element kinds and props.
 */
export function jsx<P extends object = Record<string, unknown>>(
  type: WidgetKind,
  props: P | null | undefined,
  key?: Key
): WidgetNode<P> {
  return buildNode(type, props, key);
}

export const jsxs = jsx;

function normalizeChildren(children: WidgetChild | undefined): readonly WidgetChild[] {
  if (children === undefined || children === null || typeof children === "boolean") {
    return [];
  }
  if (Array.isArray(children)) {
    const result: WidgetChild[] = [];
    for (const child of children) {
      if (child !== null && child !== undefined && typeof child !== "boolean") {
        if (Array.isArray(child)) {
          result.push(...normalizeChildren(child));
        } else {
          result.push(child);
        }
      }
    }
    return Object.freeze(result);
  }
  return Object.freeze([children]);
}

/**
 * The JSX type namespace TypeScript resolves from this module when
 * `jsxImportSource` points at `@tenunjs/jsx-runtime`. Intrinsic entries
 * speak symbolic widget identity only — TN-034 owns any numeric mapping.
 */
export namespace JSX {
  export type Element = WidgetNode;

  export interface IntrinsicAttributes {
    key?: Key;
  }

  interface BaseProps {
    children?: WidgetChild;
  }

  export interface TextProps extends BaseProps {
    variant?: string;
  }

  export interface ButtonProps extends BaseProps {
    variant?: string;
    onPress?: () => void;
  }

  export interface ColumnProps extends BaseProps {
    padding?: string | number;
    gap?: string | number;
    align?: "start" | "center" | "end" | "stretch";
    justify?: "start" | "center" | "end" | "between" | "around";
  }

  export interface RowProps extends ColumnProps {}

  export interface CardProps extends BaseProps {
    padding?: string | number;
    radius?: string | number;
    background?: string;
    semantics?: Record<string, unknown>;
  }

  export interface AppBarProps extends BaseProps {
    title: string;
  }

  export interface InputProps extends BaseProps {
    field?: string;
    value?: string;
    placeholder?: string;
  }

  export interface ListItemProps extends BaseProps {
    title?: string;
    details?: string;
  }

  export interface ScrollViewProps extends BaseProps {}
  export interface ScaffoldProps extends BaseProps {}
  export interface SpacerProps {}
  export interface RootProps extends BaseProps {}

  export interface IntrinsicElements {
    // Each entry intersects IntrinsicAttributes so `key` is accepted on
    // elements at the type layer (the transform moves it to the runtime's
    // key argument; it never lands in props).
    "text": IntrinsicAttributes & TextProps;
    "button": IntrinsicAttributes & ButtonProps;
    "column": IntrinsicAttributes & ColumnProps;
    "row": IntrinsicAttributes & RowProps;
    "card": IntrinsicAttributes & CardProps;
    "app-bar": IntrinsicAttributes & AppBarProps;
    "input": IntrinsicAttributes & InputProps;
    "list-item": IntrinsicAttributes & ListItemProps;
    "scroll-view": IntrinsicAttributes & ScrollViewProps;
    "scaffold": IntrinsicAttributes & ScaffoldProps;
    "spacer": IntrinsicAttributes & SpacerProps;
    "root": IntrinsicAttributes & RootProps;
  }
}

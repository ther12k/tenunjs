/**
 * @tenunjs/jsx-runtime
 *
 * Framework-owned jsx/jsxs/Fragment runtime without React (ADR-0003, TN-020).
 */

import { HostWidgetKind, isValidWidgetKind } from "@tenunjs/protocol";

export type Key = string | number;

export interface SourceLocation {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export type FunctionWidget<P = any> = (props: P) => WidgetNode<any> | null;

export interface WidgetNode<P = any> {
  readonly kind: HostWidgetKind | FunctionWidget<any>;
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

export const Fragment = Symbol.for("tenun.fragment");

export class JsxValidationError extends Error {
  constructor(message: string) {
    super(`[TENUN_JSX_ERROR] ${message}`);
    this.name = "JsxValidationError";
  }
}

/**
 * Creates a TenunJS widget node.
 * React-independent, fail-closed on invalid element types.
 */
export function jsx<P extends object = Record<string, unknown>>(
  type: HostWidgetKind | FunctionWidget<P> | typeof Fragment,
  props: P | null | undefined,
  key?: Key
): WidgetNode<P> {
  if (type === Fragment) {
    // Fragments normalize into an array or pass through children
    const fragmentProps = (props || {}) as P;
    const children = (fragmentProps as { children?: WidgetChild }).children;
    const normalizedChildren = normalizeChildren(children);
    return {
      kind: HostWidgetKind.ROOT,
      key: key ?? null,
      props: fragmentProps,
      children: normalizedChildren,
    };
  }

  if (typeof type !== "function" && typeof type !== "number") {
    throw new JsxValidationError(
      `Invalid widget kind: expected function component or HostWidgetKind number, got ${typeof type}`
    );
  }

  if (typeof type === "number" && !isValidWidgetKind(type)) {
    throw new JsxValidationError(
      `Invalid host widget kind: ${type} is outside known HostWidgetKind range`
    );
  }

  const rawProps = props ? { ...props } : ({} as P);
  const explicitKey = key !== undefined ? key : (rawProps as { key?: Key }).key ?? null;
  delete (rawProps as { key?: Key }).key;

  const childrenProp = (rawProps as { children?: WidgetChild }).children;
  delete (rawProps as { children?: WidgetChild }).children;

  const children = normalizeChildren(childrenProp);

  return {
    kind: type,
    key: explicitKey,
    props: Object.freeze(rawProps),
    children,
  };
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

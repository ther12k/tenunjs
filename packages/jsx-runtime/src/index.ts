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

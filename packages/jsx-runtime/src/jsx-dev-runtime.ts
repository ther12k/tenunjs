/**
 * @tenunjs/jsx-runtime — development automatic-JSX module.
 *
 * This is the module TypeScript's `react-jsxdev` transform imports
 * through the package's `./jsx-dev-runtime` export. `jsxDEV` preserves
 * the transform-provided source location (file/line/column) on the
 * virtual node; production `jsx`/`jsxs` carry no source at all. Source
 * metadata is deliberately NON-semantic: it exists for diagnostics and
 * inspection only, and never participates in node identity.
 */

import type { SourceLocation } from "./jsx-runtime";
import { buildNode, Fragment, jsx, jsxs } from "./jsx-runtime";
import type { Key, WidgetKind, WidgetNode } from "./jsx-runtime";

export { Fragment, jsx, jsxs, JsxValidationError, JsxPropValidationError } from "./jsx-runtime";
export type {
  FunctionWidget,
  Key,
  SourceLocation,
  WidgetChild,
  WidgetKind,
  WidgetNode,
} from "./jsx-runtime";

/** The transform-provided development source information. */
export interface DevSourceInfo {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * Development transform entrypoint (`react-jsxdev`).
 *
 * TypeScript emits `jsxDEV(type, props, key, isStaticChildren, source, self)`.
 * `source` is preserved on the node; `isStaticChildren` and `self` are
 * React-specific dev diagnostics (key-warning hints, component identity)
 * that are accepted for positional compatibility and deliberately NOT
 * represented on the node — no stack inspection, no retained `this`.
 */
export function jsxDEV<P extends object = Record<string, unknown>>(
  type: WidgetKind,
  props: P | null | undefined,
  key?: Key,
  isStaticChildren?: boolean,
  source?: DevSourceInfo,
  self?: unknown
): WidgetNode<P> {
  void isStaticChildren;
  void self;
  const node = buildNode(type, props, key);
  if (source && typeof source === "object") {
    const location: SourceLocation = {
      fileName: String(source.fileName),
      lineNumber: Number(source.lineNumber),
      columnNumber: Number(source.columnNumber),
    };
    return { ...node, source: location };
  }
  return node;
}

/**
 * The same JSX type namespace as the production module, re-exported so
 * the development transform resolves element types identically.
 */
export type { JSX } from "./jsx-runtime";

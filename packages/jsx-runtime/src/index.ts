/**
 * @tenunjs/jsx-runtime — public barrel.
 *
 * Re-exports the production JSX runtime primitives. The automatic
 * transform entrypoints live in the package subpaths:
 *   - `@tenunjs/jsx-runtime/jsx-runtime`      (production jsx/jsxs)
 *   - `@tenunjs/jsx-runtime/jsx-dev-runtime`  (development jsxDEV)
 */

export {
  Fragment,
  JsxPropValidationError,
  JsxValidationError,
  buildNode,
  jsx,
  jsxs,
} from "./jsx-runtime";

export { jsxDEV } from "./jsx-dev-runtime";
export type { DevSourceInfo } from "./jsx-dev-runtime";

export type {
  FunctionWidget,
  Key,
  SourceLocation,
  WidgetChild,
  WidgetKind,
  WidgetNode,
} from "./jsx-runtime";

// Pure type namespace — type-only re-export (no runtime binding exists).
export type { JSX } from "./jsx-runtime";

export { PROP_SCHEMAS, validateProps } from "./prop-codecs";
export type { JsValueKind, PropRule, WidgetPropSchema } from "./prop-codecs";

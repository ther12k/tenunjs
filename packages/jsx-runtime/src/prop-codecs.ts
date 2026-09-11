/**
 * Provisional runtime prop codecs for host widget kinds (TN-020).
 *
 * Two guarantees live at different layers and must not be conflated:
 *   - the TSX type namespace (JSX.IntrinsicElements) gives compile-time
 *     prop correctness for authored TSX;
 *   - THESE codecs give runtime correctness for values that cross trust
 *     boundaries (generated UI, dynamic props, a JS runtime boundary):
 *     untrusted/generated values are validated against normalized JS
 *     value kinds, never coerced, and rejected fail-closed.
 *
 * Schemas are deliberately PROVISIONAL scaffolding: they speak only in
 * symbolic widget identity and JS value kinds. The authoritative widget
 * kind map, property schema registry, and any numeric/native binding are
 * owned by TN-034 — nothing here may introduce them.
 */

import { HostWidgetKind } from "@tenunjs/protocol";

export type JsValueKind = "string" | "number" | "boolean" | "function" | "object";

export interface PropRule {
  /** Accepted JS value kind(s); `typeof`-based, no coercion. */
  readonly type: JsValueKind | readonly JsValueKind[];
  /** Absent (`undefined`/`null`) props fail when required. */
  readonly required?: boolean;
}

export type WidgetPropSchema = Readonly<Record<string, PropRule>>;

/**
 * Schemas for kinds whose props are contractually checked today. Kinds
 * without a schema are passthrough pending TN-034's registry (e.g.
 * "root" carries framework-internal props such as theme/navigation).
 */
export const PROP_SCHEMAS: Partial<Record<HostWidgetKind, WidgetPropSchema>> = {
  "text": { variant: { type: "string" } },
  "button": { variant: { type: "string" }, onPress: { type: "function" } },
  "column": {
    padding: { type: ["string", "number"] },
    gap: { type: ["string", "number"] },
    align: { type: "string" },
    justify: { type: "string" },
  },
  "row": {
    padding: { type: ["string", "number"] },
    gap: { type: ["string", "number"] },
    align: { type: "string" },
    justify: { type: "string" },
  },
  "card": {
    padding: { type: ["string", "number"] },
    radius: { type: ["string", "number"] },
    background: { type: "string" },
    semantics: { type: "object" },
  },
  "app-bar": { title: { type: "string", required: true } },
  "input": {
    field: { type: "string" },
    value: { type: "string" },
    placeholder: { type: "string" },
  },
  "list-item": { title: { type: "string" }, details: { type: "string" } },
};

export class JsxPropValidationError extends Error {
  readonly kind: HostWidgetKind;
  readonly prop: string;

  constructor(kind: HostWidgetKind, prop: string, reason: string) {
    super(`[TENUN_PROP_INVALID] ${kind}.${prop}: ${reason}`);
    this.name = "JsxPropValidationError";
    this.kind = kind;
    this.prop = prop;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Validates normalized (children/key already extracted) props against the
 * kind's schema. Unknown props on schematized kinds are rejected — an
 * untrusted value must never silently reach the scene.
 */
export function validateProps(kind: HostWidgetKind, props: Readonly<Record<string, unknown>>): void {
  const schema = PROP_SCHEMAS[kind];
  if (!schema) return;

  for (const [prop, rule] of Object.entries(schema)) {
    const value = props[prop];
    if (value === undefined || value === null) {
      if (rule.required) {
        throw new JsxPropValidationError(kind, prop, "required prop is missing");
      }
      continue;
    }
    const accepted = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!accepted.includes(typeof value as JsValueKind)) {
      throw new JsxPropValidationError(
        kind,
        prop,
        `expected ${accepted.join(" | ")}, got ${describe(value)}`
      );
    }
  }

  for (const prop of Object.keys(props)) {
    if (!(prop in schema)) {
      throw new JsxPropValidationError(kind, prop, "unknown prop for this widget kind");
    }
  }
}

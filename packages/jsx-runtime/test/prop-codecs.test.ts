import { describe, expect, test } from "bun:test";
import { HostWidgetKind } from "@tenunjs/protocol";
import { JsxPropValidationError, PROP_SCHEMAS, validateProps } from "../src/index";

describe("@tenunjs/jsx-runtime — runtime prop codec boundary (TN-020)", () => {
  test("unknown prop on a schematized kind is rejected, naming kind and prop", () => {
    try {
      validateProps(HostWidgetKind.BUTTON, { title: "nope" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(JsxPropValidationError);
      const err = error as JsxPropValidationError;
      expect(err.kind).toBe("button");
      expect(err.prop).toBe("title");
      expect(err.message).toContain("unknown prop");
    }
  });

  test("wrong value kind is rejected without coercion (function expected)", () => {
    try {
      validateProps(HostWidgetKind.BUTTON, { onPress: "not-a-function" });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as JsxPropValidationError).message).toContain(
        "expected function, got string"
      );
    }
  });

  test("wrong value kind is rejected without coercion (string expected)", () => {
    try {
      validateProps(HostWidgetKind.TEXT, { variant: 123 });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as JsxPropValidationError).message).toContain("expected string, got number");
    }
  });

  test("union value kinds accept every listed kind", () => {
    expect(() => validateProps(HostWidgetKind.COLUMN, { gap: "lg" })).not.toThrow();
    expect(() => validateProps(HostWidgetKind.COLUMN, { gap: 16 })).not.toThrow();
  });

  test("required props fail when absent", () => {
    try {
      validateProps(HostWidgetKind.APP_BAR, {});
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as JsxPropValidationError).prop).toBe("title");
      expect((error as JsxPropValidationError).message).toContain("required");
    }
    expect(() => validateProps(HostWidgetKind.APP_BAR, { title: "Counter" })).not.toThrow();
  });

  test("null/undefined count as absent, not as wrong-kind values", () => {
    expect(() => validateProps(HostWidgetKind.TEXT, { variant: null })).not.toThrow();
    expect(() => validateProps(HostWidgetKind.TEXT, { variant: undefined })).not.toThrow();
  });

  test("kinds without a schema are passthrough pending TN-034's registry", () => {
    expect(PROP_SCHEMAS[HostWidgetKind.ROOT]).toBeUndefined();
    expect(() =>
      validateProps(HostWidgetKind.ROOT, { theme: { colors: {} }, navigation: true })
    ).not.toThrow();
  });

  test("schemas speak symbolic identity only: no numeric ABI values anywhere", () => {
    for (const [kind, schema] of Object.entries(PROP_SCHEMAS)) {
      // Symbolic kind identity (a known HostWidgetKind value).
      expect(Object.values(HostWidgetKind) as string[]).toContain(kind);
      for (const [prop, rule] of Object.entries(schema!)) {
        expect(typeof prop).toBe("string");
        const types = Array.isArray(rule.type) ? rule.type : [rule.type];
        for (const t of types) {
          expect(["string", "number", "boolean", "function", "object"]).toContain(t);
        }
      }
    }
  });
});

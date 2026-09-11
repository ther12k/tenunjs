import { describe, expect, test } from "bun:test";
import { HostWidgetKind } from "@tenunjs/protocol";
import { Fragment, buildNode, jsx, jsxDEV } from "../src/index";

describe("@tenunjs/jsx-runtime — development transform (jsxDEV)", () => {
  test("preserves transform-provided source location on the node", () => {
    const node = jsxDEV(HostWidgetKind.TEXT, { variant: "body", children: ["dev"] }, undefined, true, {
      fileName: "screens/counter.screen.tsx",
      lineNumber: 12,
      columnNumber: 5,
    });

    expect(node.source).toEqual({
      fileName: "screens/counter.screen.tsx",
      lineNumber: 12,
      columnNumber: 5,
    });
    // Source is metadata, not a prop.
    expect((node.props as Record<string, unknown>).source).toBeUndefined();
    expect(node.children).toEqual(["dev"]);
  });

  test("produces a source-free node when the transform provides none", () => {
    const node = jsxDEV(HostWidgetKind.BUTTON, { children: ["ok"] });
    expect(node.source).toBeUndefined();
  });

  test("accepts and ignores React-specific dev diagnostics (isStaticChildren, self)", () => {
    const node = jsxDEV(
      HostWidgetKind.SPACER,
      { children: [] },
      undefined,
      false,
      undefined,
      { fakeSelf: true }
    );
    expect(node.kind).toBe(HostWidgetKind.SPACER);
    expect(node.children).toEqual([]);
  });

  test("source metadata is non-semantic: differing source, identical node semantics", () => {
    const a = jsxDEV(HostWidgetKind.TEXT, { variant: "title", children: ["x"] }, undefined, true, {
      fileName: "a.tsx",
      lineNumber: 1,
      columnNumber: 1,
    });
    const b = jsxDEV(HostWidgetKind.TEXT, { variant: "title", children: ["x"] }, undefined, true, {
      fileName: "deeply/different/b.tsx",
      lineNumber: 999,
      columnNumber: 42,
    });

    // Semantic fields must be identical regardless of source.
    expect(a.kind).toBe(b.kind);
    expect(a.props).toEqual(b.props);
    expect(a.children).toEqual(b.children);
    expect(a.key).toBe(b.key);
    // Only the source differs.
    expect(a.source).not.toEqual(b.source);
  });

  test("Fragment through jsxDEV stays virtual and gains source", () => {
    const node = jsxDEV(Fragment, { children: ["one", "two"] }, undefined, true, {
      fileName: "f.tsx",
      lineNumber: 3,
      columnNumber: 3,
    });
    expect(node.kind).toBe(Fragment);
    expect(node.kind).not.toBe(HostWidgetKind.ROOT);
    expect(node.source?.lineNumber).toBe(3);
    expect(node.children).toEqual(["one", "two"]);
  });

  test("key travels through the third argument like the emitted transform", () => {
    const node = jsxDEV(HostWidgetKind.TEXT, { variant: "body" }, "k-9");
    expect(node.key).toBe("k-9");
    expect((node.props as Record<string, unknown>).key).toBeUndefined();
  });

  test("host-kind props still pass the codec on the dev path (shared buildNode)", () => {
    expect(() =>
      jsxDEV(HostWidgetKind.BUTTON, { onPress: "nope" as unknown as () => void })
    ).toThrow(/TENUN_PROP_INVALID/);
  });

  test("buildNode and jsx share normalization exactly", () => {
    const viaJsx = jsx(Fragment, { children: [1, 2] });
    const viaBuild = buildNode(Fragment, { children: [1, 2] });
    expect(viaJsx).toEqual(viaBuild);
  });
});

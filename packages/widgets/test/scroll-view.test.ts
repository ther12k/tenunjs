import { describe, expect, test } from "bun:test";
import {
  Button, Column, Expanded, layoutScreen, ScrollView, Text, type LayoutViewport,
} from "../src/index";

const theme = { colors: { surface: "#101014", text: "#FFFFFF", accent: "#3366FF" } };
const viewport: LayoutViewport = { width: 300, height: 500 };

function scrollScene(childCount = 12) {
  const tree = Column({ align: "stretch", children: [
    Text({ children: "header" }),
    Expanded({ child: ScrollView({ id: "list", gap: 8, children:
      Array.from({ length: childCount }, (_, i) =>
        Button({ children: `task ${i}`, onPress: () => undefined })) }) }),
    Button({ children: "footer", onPress: () => undefined }),
  ] });
  return layoutScreen(theme, tree, viewport).scene;
}

describe("ScrollView lowering (TN-161)", () => {
  test("a bounded allocation becomes the viewport; content keeps intrinsic height (TN-156)", () => {
    const scene = scrollScene();
    const region = scene.ops.find((op) => op.op === "scroll-region");
    expect(region).toBeDefined();
    expect(region!.w).toBe(300);
    // 500 minus header (~24) minus footer (64): the bounded share.
    expect(region!.h).toBe(412);
    // 12 × 64 buttons + 11 × 8 gaps: overflow is preserved, never clamped.
    expect(region!.contentHeight).toBe(12 * 64 + 11 * 8);
    expect(region!.contentHeight).toBeGreaterThan(region!.h);
    expect(region!.ops.length).toBe(24); // two ops per button (rect + text), nested
  });

  test("content ops and taps carry content-space coordinates and the region id", () => {
    const scene = scrollScene(3);
    const region = scene.ops.find((op) => op.op === "scroll-region");
    const tagged = scene.taps.filter((tap) => tap.scroll === "list");
    expect(tagged).toHaveLength(3);
    // First button starts at the content origin; the second sits one
    // button-plus-gap below — content coordinates, not viewport ones.
    expect(tagged[0]!.y).toBe(0);
    expect(tagged[1]!.y).toBe(64 + 8);
    const untagged = scene.taps.filter((tap) => !tap.scroll);
    expect(untagged).toHaveLength(1); // footer only (Text has no tap)
    // Footer stays pinned to the viewport bottom, outside the region.
    expect(untagged[0]!.y + untagged[0]!.h).toBe(500);
  });

  test("a scene without ScrollView is unchanged: no region op, no tagged taps", () => {
    const scene = layoutScreen(theme, Column({ children: [Text({ children: "plain" })] }),
      { width: 100, height: 100 }).scene;
    expect(scene.ops.some((op) => op.op === "scroll-region")).toBe(false);
    expect(scene.taps.every((tap) => tap.scroll === undefined)).toBe(true);
  });

  test("unbounded main axis fails visibly instead of becoming a content-height column", () => {
    expect(() => layoutScreen(theme,
      Column({ children: [ScrollView({ children: [Text({ children: "x" })] })] }),
      { width: 100, height: 100 })).toThrow(/bounded main axis/);
  });

  test("nested ScrollView is rejected as outside this contract", () => {
    expect(() => layoutScreen(theme,
      ScrollView({ children: [ScrollView({ children: [] })] }),
      { width: 100, height: 100 })).toThrow(/Nested ScrollView/);
  });

  test("an omitted id derives from the viewport box — stable across identical re-renders", () => {
    const tree = () => Column({ align: "stretch", children: [
      Expanded({ child: ScrollView({ children: [Button({ children: "only", onPress: () => undefined })] }) }),
    ] });
    const first = layoutScreen(theme, tree(), viewport).scene;
    const second = layoutScreen(theme, tree(), viewport).scene;
    const a = first.ops.find((op) => op.op === "scroll-region")!;
    const b = second.ops.find((op) => op.op === "scroll-region")!;
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^scroll@\d+,\d+,\d+,\d+$/);
  });
});

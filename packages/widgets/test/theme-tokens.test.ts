import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import {
  ApplicationRuntime, Card, Column, defineTheme, installHostHandoff, Text, ThemeScopeBox,
  type DisplayListScene, type ThemeConfig,
} from "../src/index";

const viewport = { width: 300, height: 500 };
const base: ThemeConfig = {};

function layout(theme: ThemeConfig, tree: ReturnType<typeof Column>): { scene: DisplayListScene } {
  // layoutScreen is exercised through the public render below; here we go
  // through ApplicationRuntime for parity with how apps run.
  const app = new ApplicationRuntime({
    screens: { s: defineScreen({ name: "S", initialState: () => ({}), actions: {}, view: () => tree }) },
    initial: "s", theme, viewport,
  });
  return { scene: app.render().scene };
}

function firstRect(scene: DisplayListScene): { r: number; x: number; y: number; w: number; h: number } {
  const rect = scene.ops.find((op) => op.op === "rect") as { r: number; x: number; y: number; w: number; h: number };
  if (!rect) throw new Error("scene has no rect");
  return rect;
}

function textOp(scene: DisplayListScene): { size: number; text: string } {
  const text = scene.ops.find((op) => op.op === "text") as { size: number; text: string };
  if (!text) throw new Error("scene has no text");
  return text;
}

describe("theme-driven spacing, radius, and typography tokens (TN-174)", () => {
  test("theme spacing and radius measurably drive layout", () => {
    const stock = layout(defineTheme(base),
      Column({ padding: "md", children: [Card({ radius: "md", children: [] })] })).scene;
    const custom = layout(defineTheme({ ...base, spacing: { md: 40 }, radius: { md: 3 } }),
      Column({ padding: "md", children: [Card({ radius: "md", children: [] })] })).scene;
    // Column padding "md": stock 16 vs themed 40 shifts the card origin.
    expect(firstRect(custom).x - firstRect(stock).x).toBe(24);
    expect(firstRect(custom).y - firstRect(stock).y).toBe(24);
    // Card radius "md": stock 14 vs themed 3.
    expect(firstRect(stock).r).toBe(14);
    expect(firstRect(custom).r).toBe(3);
  });

  test("theme typography overrides built-ins and declares custom variants", () => {
    const themed = defineTheme({
      ...base,
      typography: {
        title: { size: 26, lineHeight: 34, weight: 600 }, // override a built-in name
        mega: { size: 60, lineHeight: 70, weight: 800 },   // custom variant
      },
    });
    const app = new ApplicationRuntime({
      screens: { s: defineScreen({ name: "S", initialState: () => ({}), actions: {},
        view: () => Column({ children: [
          Text({ variant: "title", children: "T" }),
          Text({ variant: "mega", children: "M" }),
          Text({ children: "B" }),
        ] }) }) },
      initial: "s", theme: themed, viewport,
    });
    const sizes = app.render().scene.ops.filter((op) => op.op === "text")
      .map((op) => (op as { size: number }).size);
    expect(sizes).toContain(26); // overridden title
    expect(sizes).toContain(60); // custom variant
    expect(sizes).toContain(17); // untouched body built-in
  });

  test("malformed token blocks fail visibly at layout time", () => {
    expect(() => layout(defineTheme({ ...base, spacing: { md: -4 } }),
      Column({ padding: "md", children: [] }))).toThrow(/theme\.spacing\.md/);
    expect(() => layout(defineTheme({ ...base, radius: { lg: Number.NaN } }),
      Column({ children: [Card({ radius: "lg", children: [] })] }))).toThrow(/theme\.radius\.lg/);
    expect(() => layout(defineTheme({ ...base, typography: { title: { size: 22, lineHeight: 0 } } }),
      Column({ children: [Text({ variant: "title", children: "x" })] }))).toThrow(/theme\.typography\.title/);
  });

  test("a theme without token blocks is unchanged (built-ins)", () => {
    const scene = layout(defineTheme(base),
      Column({ padding: "sm", children: [Card({ radius: "lg", children: [] })] })).scene;
    expect(firstRect(scene).r).toBe(22); // built-in lg
  });

  test("token scopes narrow descendants only; inner wins; theme fills gaps", () => {
    const themed = defineTheme({ ...base, spacing: { md: 30 }, radius: { md: 9 } });
    const app = new ApplicationRuntime({
      screens: { s: defineScreen({ name: "S", initialState: () => ({}), actions: {},
        view: () => Column({ padding: "md", children: [
          ThemeScopeBox({ scheme: {}, tokens: { spacing: { md: 50 }, radius: { md: 2 } }, children: [
            Column({ padding: "md", children: [
              Card({ radius: "md", children: [] }),                       // scope spacing+radius
              ThemeScopeBox({ scheme: {}, tokens: { radius: { md: 6 } }, children: [
                Card({ radius: "md", children: [] }),                     // inner radius override
              ] }),
            ] }),
          ] }),
          Card({ radius: "md", children: [] }),                           // sibling: theme radius
        ] }) }) },
      initial: "s", theme: themed, viewport,
    });
    const radii = app.render().scene.ops.filter((op) => op.op === "rect")
      .map((op) => (op as { r: number }).r);
    expect(radii).toContain(2);  // scoped card
    expect(radii).toContain(6);  // inner scope overrides outer
    expect(radii).toContain(9);  // sibling outside scopes → theme
  });

  test("setTheme with changed tokens re-renders changed geometry, state preserved", () => {
    const screen = defineScreen({
      name: "S",
      initialState: (): { count: number } => ({ count: 0 }),
      actions: { bump({ state }: { state: { count: number } }) { state.count++; } },
      view: ({ state }) => Column({ padding: "md", children: [
        Card({ radius: "md", children: [] }),
        Text({ variant: "title", children: `c${state.count}` }),
      ] }),
    });
    const app = new ApplicationRuntime({
      screens: { s: screen },
      initial: "s", theme: defineTheme(base), viewport,
    });
    let scene: DisplayListScene | null = null;
    const handoff = installHostHandoff({ app, commit: (json) => { scene = JSON.parse(json); } });
    const before = firstRect(app.render().scene);
    app.push("bump");
    app.setTheme(defineTheme({ ...base, spacing: { md: 60 }, typography: { title: { size: 31, lineHeight: 40 } } }));
    const after = app.render().scene;
    expect(firstRect(after).x - before.x).toBe(44); // 60 - 16
    expect(textOp(after).size).toBe(31);
    expect(textOp(after).text).toBe("c1"); // state survived the token swap
    expect(JSON.stringify(scene)).toContain('"c1"');
    handoff.dispose();
  });
});

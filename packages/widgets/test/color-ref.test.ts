import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import {
  ApplicationRuntime, Card, Column, ScrollView, Text, ThemeScopeBox, colorSlot,
  defineColorPalette, defineTheme, installHostHandoff, layoutScreen,
  type DisplayListScene, type ThemePalette,
} from "../src/index";

const theme = defineTheme({});
const palette: ThemePalette = defineColorPalette({
  background: "#F6F7FC", onBackground: "#1B243B",
  primary: "#4059B8", onPrimary: "#FFFFFF",
  primaryContainer: "#DDE5FF", onPrimaryContainer: "#102050",
  secondaryContainer: "#E0E0E8", onSecondaryContainer: "#202030",
  surface: "#F6F7FC", surfaceContainer: "#FFFFFF", surfaceContainerHigh: "#ECEEF6",
  onSurface: "#1B243B", onSurfaceVariant: "#505566",
  outline: "#80859A", outlineVariant: "#D0D3E0",
  error: "#B3261E", onError: "#FFFFFF",
  success: "#006B40", onSuccess: "#FFFFFF",
  warning: "#805000", onWarning: "#FFFFFF",
  inverseSurface: "#1B243B", onInverseSurface: "#F6F7FC", onPrimaryFixed: "#FFFFFF",
});

const viewport = { width: 300, height: 400 };
const cardColors = (scene: DisplayListScene): string[] =>
  scene.ops.filter((op) => op.op === "rect").map((op) => (op as { color: string }).color);

describe("ColorRef widget adoption (TN-173)", () => {
  test("a ref bakes to exactly the literal scene", () => {
    const viaRef = layoutScreen(theme,
      Card({ background: colorSlot("surfaceContainer"), children: Text({ children: "card" }) }),
      viewport, undefined, { palette }).scene;
    const viaLiteral = layoutScreen(theme,
      Card({ background: "#FFFFFF", children: Text({ children: "card" }) }),
      viewport, undefined, { palette }).scene;
    expect(cardColors(viaRef)).toContain("#FFFFFF");
    expect(JSON.stringify(viaRef)).toBe(JSON.stringify(viaLiteral));
  });

  test("a Text color ref bakes; a scene without refs needs no palette", () => {
    const scene = layoutScreen(theme,
      Text({ color: colorSlot("error"), children: "danger" }),
      viewport, undefined, { palette }).scene;
    const text = scene.ops.find((op) => op.op === "text") as { color: string };
    expect(text.color).toBe("#B3261E");
    const plain = layoutScreen(theme, Text({ children: "plain" }), viewport);
    expect(plain.semanticScene).toBeUndefined();
  });

  test("refs without a palette, and unknown slots, fail visibly", () => {
    expect(() => layoutScreen(theme,
      Card({ background: colorSlot("surfaceContainer"), children: [] }),
      viewport, undefined, {})).toThrow(/palette/);
    const forged = { slot: "app.absent" } as ReturnType<typeof colorSlot>;
    expect(() => layoutScreen(theme,
      Card({ background: forged, children: [] }),
      viewport, undefined, { palette })).toThrow(/app\.absent/);
  });

  test("refs inside scroll regions bake recursively", () => {
    const scene = layoutScreen(theme,
      ScrollView({ id: "list", children: [
        Card({ background: colorSlot("primaryContainer"), children: [] }),
      ] }),
      viewport, undefined, { palette }).scene;
    const region = scene.ops.find((op) => op.op === "scroll-region") as unknown as
      { ops: Array<{ op: string; color?: string }> };
    const nested = region.ops.find((op) => op.op === "rect")!;
    expect(nested.color).toBe("#DDE5FF");
    expect(JSON.stringify(scene)).not.toContain("slot");
  });

  test("the semantic scene retains slot identity with identical geometry", () => {
    const { scene, semanticScene } = layoutScreen(theme,
      Card({ background: colorSlot("surfaceContainer"), children: Text({ children: "x" }) }),
      viewport, undefined, { palette });
    expect(semanticScene).toBeDefined();
    expect(JSON.stringify(semanticScene)).toContain('"slot":"surfaceContainer"');
    const { taps: bakedTaps, ops: bakedOps, ...bakedRest } = scene;
    const { taps: semTaps, ops: _semOps, ...semRest } = semanticScene!;
    expect(bakedRest).toEqual(semRest);
    expect(bakedTaps).toEqual(semTaps);
    expect(bakedOps.length).toBe(_semOps.length);
  });

  test("slot scopes narrow descendants only; inner scopes win; unoverridden inherit", () => {
    const inner = Card({ background: colorSlot("primary"), children: [] });
    const other = Card({ background: colorSlot("surfaceContainer"), children: [] });
    const scene = layoutScreen(theme,
      Column({ children: [
        ThemeScopeBox({ scheme: {}, slots: { primary: "#FF0000", surfaceContainer: "#00FF00" }, children: [
          inner,
          ThemeScopeBox({ scheme: {}, slots: { primary: "#0000FF" }, children: [
            Card({ background: colorSlot("primary"), children: [] }),
          ] }),
        ] }),
        other,
      ] }),
      viewport, undefined, { palette }).scene;
    const colors = cardColors(scene);
    expect(colors).toContain("#FF0000"); // scope narrows the descendant
    expect(colors).toContain("#0000FF"); // inner scope overrides outer
    expect(colors).toContain("#FFFFFF"); // sibling OUTSIDE the scope keeps the palette
    expect(colors).not.toContain("#00FF00"); // no descendant asked for that override
  });

  test("a slot the scope omits falls through to the layout palette", () => {
    const scene = layoutScreen(theme,
      ThemeScopeBox({ scheme: {}, slots: { primary: "#FF0000" }, children: [
        Card({ background: colorSlot("error"), children: [] }),
      ] }),
      viewport, undefined, { palette }).scene;
    expect(cardColors(scene)).toContain("#B3261E"); // error not overridden → palette
  });

  test("the runtime bakes refs, exposes the semantic scene, and swaps palettes live", () => {
    const screen = defineScreen({
      name: "RefScreen",
      initialState: (): { count: number } => ({ count: 0 }),
      actions: { bump({ state }: { state: { count: number } }) { state.count++; } },
      view: ({ state }) => Column({ children: [
        Card({ background: colorSlot("primary"), children: [] }),
        Text({ color: colorSlot("onSurface"), children: `count ${state.count}` }),
      ] }),
    });
    const app = new ApplicationRuntime({
      screens: { ref: screen }, initial: "ref", theme, palette, viewport,
    });
    let committed: DisplayListScene | null = null;
    const handoff = installHostHandoff({ app, commit: (json) => { committed = JSON.parse(json); } });

    const first = app.render();
    expect(cardColors(first.scene)).toContain("#4059B8");
    expect(first.semanticScene).toBeDefined();
    expect(JSON.stringify(first.semanticScene)).toContain('"slot":"primary"');
    // The handoff commits literal scenes only — hosts never see refs.
    expect(JSON.stringify(committed)).not.toContain("slot");

    app.push("bump");
    app.setPalette(defineColorPalette({ ...palette, primary: "#111111" }));
    const swapped = app.render();
    expect(cardColors(swapped.scene)).toContain("#111111");
    expect(JSON.stringify(swapped.scene)).toContain('"text":"count 1"'); // state preserved
    expect(() => app.setPalette(null as never)).toThrow(/palette must be an object/);
    handoff.dispose();
    app.dispose();
    expect(() => app.setPalette(palette)).toThrow(/disposed/i);
  });
});

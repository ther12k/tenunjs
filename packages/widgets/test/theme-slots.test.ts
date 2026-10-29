import { describe, expect, test } from "bun:test";
import {
  SEMANTIC_COLOR_SLOTS, ThemeContractError, bakeThemeScene, colorSlot,
  defineColorPalette, type ColorRef, type ColorSlot, type SemanticDisplayListScene,
  type SemanticDisplayOp,
  type ThemeContractErrorCode, type ThemePalette, type TextInputOp,
} from "../src/index";

// Compile-time checks: secondary paint fields must retain semantic references.
type AssertColorRef<T extends ColorRef> = T;
type GradientEndpointRef = AssertColorRef<Extract<SemanticDisplayOp, { op: "gradient" }>["colorTo"]>;
type RingTrackRef = AssertColorRef<NonNullable<Extract<SemanticDisplayOp, { op: "ring" }>["track"]>>;

function palette(overrides: Partial<ThemePalette> = {}): ThemePalette {
  return defineColorPalette({
    background: "#FFFFFF", onBackground: "#101014",
    primary: "#3366FF", onPrimary: "#FFFFFF",
    primaryContainer: "#DDE5FF", onPrimaryContainer: "#102050",
    secondaryContainer: "#E0E0E8", onSecondaryContainer: "#202030",
    surface: "#FAFAFC", surfaceContainer: "#F0F0F4",
    surfaceContainerHigh: "#E8E8EE", onSurface: "#202024",
    onSurfaceVariant: "#505060", outline: "#808090",
    outlineVariant: "#D0D0D8", error: "#B00020", onError: "#FFFFFF",
    success: "#006B40", onSuccess: "#FFFFFF", warning: "#805000",
    onWarning: "#FFFFFF", inverseSurface: "#202024",
    onInverseSurface: "#FAFAFC", onPrimaryFixed: "#FFFFFF",
    ...overrides,
  });
}

function scene(): SemanticDisplayListScene {
  return {
    tenun: "semantic-display-list", version: 1, designWidth: 360,
    contentHeight: 640, background: colorSlot("background"),
    ops: [
      { op: "rect", x: 4, y: 6, w: 100, h: 50, r: 8, color: colorSlot("surface"), shadow: 4 },
      { op: "outline", x: 4, y: 6, w: 100, h: 50, r: 8, width: 2, color: colorSlot("outline") },
      { op: "text", x: 12, y: 26, text: "Theme 🎨", size: 16, weight: 400, color: colorSlot("onSurface") },
      { op: "circle", cx: 20, cy: 80, r: 10, color: colorSlot("success") },
      { op: "ring", cx: 60, cy: 80, r: 10, width: 3, progress: 0.5,
        color: colorSlot("primary"), track: colorSlot("surfaceContainer") },
      { op: "ring", cx: 90, cy: 80, r: 10, width: 3, progress: 0.75, color: colorSlot("warning") },
      { op: "line", x1: 0, y1: 100, x2: 360, y2: 100, width: 1, color: colorSlot("outlineVariant") },
      { op: "gradient", x: 0, y: 120, w: 360, h: 40, r: 0,
        color: colorSlot("primary"), colorTo: colorSlot("primaryContainer"), fixed: true, anchor: "bottom", anchorSize: 40 },
    ],
    taps: [{ x: 4, y: 6, w: 100, h: 50, action: "tap", payload: { id: 7 } }],
  };
}

function expectCode(run: () => unknown, code: ThemeContractErrorCode): void {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(ThemeContractError);
    if (!(error instanceof ThemeContractError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ThemeContractError ${code}`);
}

describe("TN-143 semantic color vocabulary", () => {
  test("canonical references are frozen and custom names are explicit", () => {
    expect(new Set(SEMANTIC_COLOR_SLOTS).size).toBe(SEMANTIC_COLOR_SLOTS.length);
    expect(Object.isFrozen(SEMANTIC_COLOR_SLOTS)).toBe(true);
    for (const slot of SEMANTIC_COLOR_SLOTS) {
      const ref = colorSlot(slot);
      expect(ref).toEqual({ slot });
      expect(Object.isFrozen(ref)).toBe(true);
    }
    expect(colorSlot("app.voltage")).toEqual({ slot: "app.voltage" });
  });

  test("legacy aliases, unknown roles, literals and malformed extensions fail", () => {
    for (const name of ["accent", "danger", "notASlot", "#FFFFFF", "app.", "app.a.b", "app.1", "app.bad-name"]) {
      // Models an unchecked name entering the runtime contract boundary.
      expectCode(() => colorSlot(name as ColorSlot), "INVALID_SLOT");
    }
    // @ts-expect-error Old permissive theme names are absent from the new API.
    expectCode(() => colorSlot("text"), "INVALID_SLOT");
  });
});

describe("TN-143 palette validation", () => {
  test("palette is a frozen snapshot and supports canonical native color encoding", () => {
    const input = { ...palette(), primary: "#803366FF", "app.voltage": "#ffaa00" };
    const result = defineColorPalette(input);
    input.primary = "#000000";
    expect(result.primary).toBe("#803366FF");
    expect(result["app.voltage"]).toBe("#ffaa00");
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("every built-in slot must be explicitly supplied", () => {
    for (const name of SEMANTIC_COLOR_SLOTS) {
      const incomplete: Record<string, unknown> = { ...palette() };
      delete incomplete[name];
      // Simulates an incomplete persisted/imported palette, bypassing static typing.
      expectCode(() => defineColorPalette(incomplete as ThemePalette), "MISSING_SLOT");
    }
  });

  test("unknown names and invalid colors fail without fallback", () => {
    expectCode(() => defineColorPalette({ ...palette(), accent: "#3366FF" }), "INVALID_SLOT");
    for (const color of ["red", "#fff", "#12345G", "3366FF", "#1234567", "#123456789", "#FFFFFF ", undefined]) {
      expectCode(() => defineColorPalette({ ...palette(), primary: color } as ThemePalette), "INVALID_COLOR");
    }
    for (const value of [null, [], "dark", 42]) {
      expectCode(() => defineColorPalette(value as unknown as ThemePalette), "INVALID_PALETTE");
    }
  });
});

describe("TN-143 commit-time baking", () => {
  test("required text-input descriptors preserve non-color state with independent range copies", () => {
    const input: TextInputOp = { op: "text-input", id: "title", x: 10, y: 20, w: 300, h: 72,
      text: "か😀", selection: { base: 3, extent: 1 }, composing: { start: 0, end: 1 },
      focused: true, sessionId: 4, revision: 2, keyboardType: "text", returnAction: "done",
      readOnly: false, label: "Title" };
    const source = { ...scene(), ops: [...scene().ops, input] };
    const result = bakeThemeScene(source, palette());
    const baked = result.ops.at(-1)!;
    expect(baked).toEqual(input);
    expect(baked).not.toBe(input);
    if (baked.op !== "text-input") throw new Error("Required input descriptor was lost");
    expect(baked.selection).not.toBe(input.selection);
    expect(baked.composing).not.toBe(input.composing);
    expectCode(() => bakeThemeScene({ ...source, ops: [{ ...input, sessionId: 0 }] }, palette()), "INVALID_SCENE");
  });

  test("text clipping is explicitly classified, validated, and copied when baking themes", () => {
    const clip = { x: 12, y: 2, w: 66, h: 68 };
    const source = { ...scene(), ops: [{ op: "text" as const, x: 12, y: 42, text: "WWWWWW",
      size: 17, weight: 400, color: colorSlot("onSurface"), clip }] };
    const result = bakeThemeScene(source, palette());
    const text = result.ops[0]!;
    expect(text).toMatchObject({ color: "#202024", clip });
    if (text.op !== "text") throw new Error("Text operation was lost");
    expect(text.clip).not.toBe(clip);
    text.clip!.w = 2;
    expect(clip.w).toBe(66);
    for (const invalid of [null, { ...clip, x: NaN }, { ...clip, y: Infinity },
      { ...clip, w: -1 }, { ...clip, h: -1 }]) {
      expectCode(() => bakeThemeScene({ ...source, ops: [{ ...source.ops[0], clip: invalid }] } as unknown as SemanticDisplayListScene, palette()), "INVALID_SCENE");
    }
  });

  test("every color field resolves while geometry, fixed anchors, text and taps survive", () => {
    const source = scene();
    const colors = palette();
    const result = bakeThemeScene(source, colors);
    expect(result.tenun).toBe("display-list");
    expect(result.version).toBe(1);
    expect(result.designWidth).toBe(source.designWidth);
    expect(result.contentHeight).toBe(source.contentHeight);
    expect(result.background).toBe(colors.background);
    expect(result.ops).toEqual([
      { op: "rect", x: 4, y: 6, w: 100, h: 50, r: 8, color: colors.surface, shadow: 4 },
      { op: "outline", x: 4, y: 6, w: 100, h: 50, r: 8, width: 2, color: colors.outline },
      { op: "text", x: 12, y: 26, text: "Theme 🎨", size: 16, weight: 400, color: colors.onSurface },
      { op: "circle", cx: 20, cy: 80, r: 10, color: colors.success },
      { op: "ring", cx: 60, cy: 80, r: 10, width: 3, progress: 0.5, color: colors.primary, track: colors.surfaceContainer },
      { op: "ring", cx: 90, cy: 80, r: 10, width: 3, progress: 0.75, color: colors.warning },
      { op: "line", x1: 0, y1: 100, x2: 360, y2: 100, width: 1, color: colors.outlineVariant },
      { op: "gradient", x: 0, y: 120, w: 360, h: 40, r: 0, color: colors.primary,
        colorTo: colors.primaryContainer, fixed: true, anchor: "bottom", anchorSize: 40 },
    ]);
    expect(result.taps).toEqual([...source.taps]);
    expect(Object.prototype.hasOwnProperty.call(result.ops[5], "track")).toBe(false);
  });

  test("light/dark rebakes preserve authoritative references and previous host scenes", () => {
    const source = scene();
    const original = JSON.stringify(source);
    const light = bakeThemeScene(source, palette());
    const lightSnapshot = JSON.stringify(light);
    const dark = bakeThemeScene(source, palette({ background: "#101014", primary: "#99BBFF", onSurface: "#FAFAFC" }));
    expect(dark.background).toBe("#101014");
    expect(dark.ops[4]).toMatchObject({ color: "#99BBFF" });
    expect(dark.ops[2]).toMatchObject({ color: "#FAFAFC" });
    expect(JSON.stringify(source)).toBe(original);
    expect(JSON.stringify(light)).toBe(lightSnapshot);
    expect(dark.ops[0]).not.toBe(source.ops[0]);
    dark.taps[0].payload.id = 99;
    expect(source.taps[0].payload.id).toBe(7);
    expect(light.taps[0].payload.id).toBe(7);
  });

  test("application semantic slots resolve only when the palette defines them", () => {
    const source = { ...scene(), background: colorSlot("app.voltage") };
    expectCode(() => bakeThemeScene(source, palette()), "MISSING_SLOT");
    expect(bakeThemeScene(source, palette({ "app.voltage": "#FFAA00" })).background).toBe("#FFAA00");
  });

  test("equal light colors retain distinct slot identities when rebaked for dark", () => {
    const source = scene();
    const light = bakeThemeScene(source, palette({ primary: "#3366FF", primaryContainer: "#3366FF" }));
    const dark = bakeThemeScene(source, palette({ primary: "#99BBFF", primaryContainer: "#202050" }));
    expect(light.ops[7]).toMatchObject({ color: "#3366FF", colorTo: "#3366FF" });
    expect(dark.ops[7]).toMatchObject({ color: "#99BBFF", colorTo: "#202050" });
    expect(source.ops[7]).toMatchObject({ color: colorSlot("primary"), colorTo: colorSlot("primaryContainer") });
  });

  test("literal, missing, and malformed references are rejected at every color boundary", () => {
    for (const ref of ["#FFFFFF", null, {}, { slot: "primary", extra: true }]) {
      const source = { ...scene(), background: ref } as unknown as SemanticDisplayListScene;
      expectCode(() => bakeThemeScene(source, palette()), "INVALID_COLOR_REF");
    }
    expectCode(() => bakeThemeScene({ ...scene(), background: { slot: "unknown" } } as unknown as SemanticDisplayListScene, palette()), "INVALID_SLOT");
    for (const [index, field] of [[0, "color"], [4, "track"], [7, "colorTo"]] as const) {
      const source = scene();
      const ops = source.ops.map((op, i) => i === index ? { ...op, [field]: "#FFFFFF" } : op);
      expectCode(() => bakeThemeScene({ ...source, ops } as SemanticDisplayListScene, palette()), "INVALID_COLOR_REF");
    }
  });

  test("unrecognized semantic scene versions, markers, and operations fail closed", () => {
    for (const source of [null, { ...scene(), version: 2 }, { ...scene(), tenun: "display-list" },
      { ...scene(), ops: null }, { ...scene(), taps: null },
      { ...scene(), ops: [{ op: "image", color: colorSlot("primary") }] }]) {
      expectCode(() => bakeThemeScene(source as unknown as SemanticDisplayListScene, palette()), "INVALID_SCENE");
    }
  });

  test("sparse operation and tap arrays fail instead of baking JSON null entries", () => {
    const sparseOps = { ...scene(), ops: new Array<SemanticDisplayOp>(1) };
    const sparseTaps = { ...scene(), taps: new Array<SemanticDisplayListScene["taps"][number]>(1) };
    expectCode(() => bakeThemeScene(sparseOps, palette()), "INVALID_SCENE");
    expectCode(() => bakeThemeScene(sparseTaps, palette()), "INVALID_SCENE");
  });

  test("a failed later color leaves source and prior result untouched", () => {
    const source = scene();
    const committed = bakeThemeScene(source, palette());
    const before = JSON.stringify({ source, committed });
    const failed = { ...source, ops: [...source.ops, { op: "circle" as const, cx: 0, cy: 0, r: 1, color: colorSlot("app.missing") }] };
    expectCode(() => bakeThemeScene(failed, palette()), "MISSING_SLOT");
    expect(JSON.stringify({ source, committed })).toBe(before);
    expectCode(() => bakeThemeScene(source, { ...palette(), primary: "bad" }), "INVALID_COLOR");
  });
});

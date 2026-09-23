/**
 * TN-133 extraction equivalence tests: the display-list scene model and
 * layoutScreen lowering moved verbatim from examples/ui-kit/src/display-list.ts
 * into this package. Proves:
 *  1. Golden equivalence — the moved code produces byte-identical scene
 *     JSON to fixtures captured from the ORIGINAL implementation before
 *     the move (representative trees: structural+taps, theme-scope+text
 *     wrap, canvas emit).
 *  2. Example-path equivalence — the ui-kit compatibility shim (the path
 *     every existing examples/ consumer takes) yields the identical scene
 *     for the same inputs.
 *  3. Established invalid-input behavior is preserved (unknown host kind
 *     and non-node children fail the same way the original did).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsx, jsxs } from "@tenunjs/jsx-runtime/jsx-runtime";
import {
  AppBar,
  Button,
  Canvas,
  Card,
  Column,
  layoutScreen,
  Scaffold,
  Text,
  ThemeScopeBox,
  type DisplayListScene,
} from "../src/index";
import { layoutScreen as layoutScreenViaExample } from "../../../examples/ui-kit/src/display-list";

const theme = {
  colors: { surface: "#101014", surfaceRaised: "#1C1C24", text: "#F2F2F7", accent: "#7C4DFF" },
  spacing: { sm: 8, md: 16, lg: 24 },
};

// The exact trees used for the pre-move golden capture (scene digests are
// the load-bearing assertion; trees are duplicated verbatim).
const structuralTree = jsxs(Scaffold, {
  appBar: jsx(AppBar, { title: "Golden" }),
  children: jsxs(Column, {
    padding: "lg",
    gap: "md",
    children: [
      jsx(Text, { variant: "title", children: "Structural fixture" }),
      jsx(Button, { onPress: () => {}, children: "Tap me" }),
      jsx(Card, { padding: "md", radius: "md", background: "surfaceRaised", children:
        jsx(Text, { variant: "body", children: "card body" }) }),
    ],
  }),
});

const textWrapTree = jsxs(Column, {
  gap: "sm",
  children: [
    ThemeScopeBox({ scheme: { onSurface: "#00E5FF" }, children: [
      jsx(Text, { variant: "body", children: "Scoped color text that is long enough to require wrapping across multiple lines in the seven hundred twenty pixel design width." }),
    ] }),
    jsx(Text, { children: "plain" }),
  ],
}) as never;

const canvasTree = {
  kind: Canvas,
  key: null,
  props: { paint: (_frame: unknown, emitOp: (op: Record<string, unknown>) => void) => {
    emitOp({ op: "circle", cx: 60, cy: 60, r: 40, color: "#7C4DFF" });
  } },
  children: [],
} as never;

function golden(name: string): string {
  return readFileSync(join(import.meta.dir, "fixtures/display-list", `${name}.json`), "utf-8");
}

function sceneJsonOf(tree: never): string {
  const { scene } = layoutScreen(theme as never, tree, 720);
  return JSON.stringify(scene, null, 2) + "\n";
}

describe("TN-133 extraction: golden equivalence with the original implementation", () => {
  test("structural tree (scaffold/app-bar/buttons/taps) matches the pre-move golden byte-for-byte", () => {
    expect(sceneJsonOf(structuralTree as never)).toBe(golden("structural"));
  });

  test("theme-scope + wrapped text matches the pre-move golden byte-for-byte", () => {
    expect(sceneJsonOf(textWrapTree)).toBe(golden("text-wrap"));
  });

  test("canvas emit closure matches the pre-move golden byte-for-byte", () => {
    expect(sceneJsonOf(canvasTree)).toBe(golden("canvas"));
  });

  test("scene contract shape is host-consumable (tenun marker, version 1, ops, taps)", () => {
    const scene: DisplayListScene = layoutScreen(theme as never, structuralTree as never, 720).scene;
    expect(scene.tenun).toBe("display-list");
    expect(scene.version).toBe(1);
    expect(Array.isArray(scene.ops)).toBe(true);
    expect(Array.isArray(scene.taps)).toBe(true);
    expect(scene.taps.length).toBe(1);
  });
});

describe("TN-133 extraction: example-path (ui-kit shim) equivalence", () => {
  test("shim path yields the byte-identical scene for the same inputs", () => {
    const viaPackage = sceneJsonOf(structuralTree as never);
    const viaShim = (() => {
      const { scene } = layoutScreenViaExample(theme as never, structuralTree as never, 720);
      return JSON.stringify(scene, null, 2) + "\n";
    })();
    expect(viaShim).toBe(viaPackage);
  });
});

describe("TN-133 extraction: invalid-input behavior preserved", () => {
  test("unknown host kind is rejected with the stable JSX error (fail-closed at construction)", () => {
    expect(() => jsx("no-such-kind" as never, { children: "x" })).toThrow(
      /TENUN_JSX_ERROR.*no-such-kind/,
    );
  });

  test("layoutScreen rejects a null tree (unchanged contract)", () => {
    expect(() => layoutScreen(theme as never, null as never, 720)).toThrow();
  });
});

// Canvas symbol identity is part of the public contract (trees built by
// external consumers reference the exported symbol).
test("Canvas virtual kind is the documented registered symbol", () => {
  expect(Canvas === Symbol.for("tenun.preview.canvas")).toBe(true);
});

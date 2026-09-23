/**
 * TN-133 extraction, example-path equivalence: the ui-kit compatibility
 * shim (every existing examples/ consumer's import path) must yield the
 * byte-identical scene to the public package implementation for the same
 * inputs. Lives here (not in packages/) because importing the example
 * shim from inside a package would violate the boundary the workspace
 * topology test enforces.
 */
import { describe, expect, test } from "bun:test";
import { jsxs, jsx } from "@tenunjs/jsx-runtime";
import { AppBar, Button, Card, Column, layoutScreen, Scaffold, Text } from "@tenunjs/widgets";
import { layoutScreen as layoutScreenViaShim } from "../src/display-list";

const theme = {
  colors: { surface: "#101014", surfaceRaised: "#1C1C24", text: "#F2F2F7", accent: "#7C4DFF" },
  spacing: { sm: 8, md: 16, lg: 24 },
};

const tree = jsxs(Scaffold, {
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

describe("TN-133 extraction: ui-kit shim equivalence", () => {
  test("shim path and package path produce byte-identical scenes", () => {
    const viaPackage = JSON.stringify(
      layoutScreen(theme as never, tree as never, 720).scene, null, 2) + "\n";
    const viaShim = JSON.stringify(
      layoutScreenViaShim(theme as never, tree as never, 720).scene, null, 2) + "\n";
    expect(viaShim).toBe(viaPackage);
  });
});

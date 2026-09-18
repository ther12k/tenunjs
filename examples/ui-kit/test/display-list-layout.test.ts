/**
 * Structural-widget layout semantics of the display-list engine: frames,
 * paint order (z-order), tap registration order, Expanded flex math, Wrap
 * line breaking, and cross-axis alignment. The default (no-align) Column
 * and Row placement is pinned too — that path must keep rendering exactly
 * as it did before the structural tier existed.
 */

import { describe, expect, test } from "bun:test";
import {
  Button,
  Card,
  Container,
  Center,
  Column,
  Expanded,
  GestureDetector,
  Icon,
  Positioned,
  Row,
  SizedBox,
  Spacer,
  Stack,
  Text,
  Wrap,
  defineTheme,
} from "@tenunjs/widgets";
import { layoutScreen, textWidth } from "../src/display-list";
import type { WidgetNode } from "@tenunjs/jsx-runtime";

const theme = defineTheme({ colors: {} });

function render(node: WidgetNode) {
  return layoutScreen(theme, node);
}

function rects(scene: ReturnType<typeof render>["scene"]) {
  return scene.ops.filter((op) => op.op === "rect");
}

function texts(scene: ReturnType<typeof render>["scene"]) {
  return scene.ops.filter((op) => op.op === "text");
}

describe("structural widgets — layout", () => {
  test("SizedBox forces a tight frame", () => {
    const { scene } = render(
      SizedBox({ width: 300, height: 120, children: Text({ children: ["hi"] }) })
    );
    expect(scene.contentHeight).toBe(120);
    expect(texts(scene).length).toBe(1);
  });

  test("Center centers the child in the available width", () => {
    const { scene } = render(Column({ children: [Center({ children: Text({ children: ["hi"] }) })] }));
    const op = texts(scene)[0]!;
    expect(op.x).toBeCloseTo((720 - textWidth("hi", 17)) / 2, 5);
  });

  test("Stack paints children in declaration order (z-order) and registers taps in order", () => {
    let pressed = "";
    const { scene, tapRuns } = render(
      Stack({
        children: [
          Container({ width: 720, height: 50, color: "#111111" }),
          Button({ variant: "secondary", onPress: () => (pressed = "first"), children: ["One"] }),
          Button({ variant: "secondary", onPress: () => (pressed = "second"), children: ["Two"] }),
        ],
      })
    );
    // First stack child paints first, later children land on top.
    const fills = rects(scene);
    expect(fills[0]!.color).toBe("#111111");
    expect(texts(scene).map((op) => op.text)).toEqual(["One", "Two"]);
    // Tap registration follows declaration order.
    expect(scene.taps.map((tap) => tap.payload.id)).toEqual([0, 1]);
    tapRuns[1]!();
    expect(pressed).toBe("second");
  });

  test("Positioned places by offset; left+right stretches the child", () => {
    const long = "wordy words keep wrapping around the corner of the box";
    const { scene } = render(
      SizedBox({
        width: 400,
        height: 200,
        children: Stack({
          children: [
            SizedBox({ width: 400, height: 200 }),
            Positioned({ top: 20, left: 30, children: Text({ children: ["x"] }) }),
            Positioned({ top: 60, left: 0, right: 0, children: Text({ children: [long] }) }),
          ],
        }),
      })
    );
    const ops = texts(scene);
    expect(ops[0]!.x).toBe(30);
    expect(ops[0]!.y).toBeCloseTo(20 + 24 * 0.78, 5);
    // The stretched child wraps at the 400-unit stack width, not 720.
    const stretched = ops.slice(1).map((op) => op.text);
    expect(stretched.length).toBeGreaterThan(1);
    for (const line of stretched) {
      expect(textWidth(line, 17)).toBeLessThanOrEqual(400);
    }
  });

  test("Stack alignment centers a child in both axes", () => {
    const { scene } = render(
      SizedBox({
        width: 400,
        height: 200,
        children: Stack({
          alignment: "center",
          children: [
            SizedBox({ width: 400, height: 200 }),
            Container({ width: 100, height: 50, color: "#FF0000" }),
          ],
        }),
      })
    );
    const fill = rects(scene).find((op) => op.color === "#FF0000")!;
    expect(fill.x).toBe(150);
    expect(fill.y).toBe(75);
  });

  test("Expanded splits the free row width by flex", () => {
    const { scene } = render(
      Row({
        children: [
          Button({ onPress: () => undefined, children: ["Go"] }),
          Expanded({ children: Button({ onPress: () => undefined, children: ["Wide"] }) }),
          Expanded({ flex: 2, children: Button({ onPress: () => undefined, children: ["Side"] }) }),
        ],
      })
    );
    // Fixed "Go" button is 96 wide; 624 free splits 1:2 into 208/416.
    expect(scene.taps.map((tap) => tap.w)).toEqual([96, 208, 416]);
    expect(scene.taps.map((tap) => tap.x)).toEqual([0, 96, 304]);
  });

  test("GestureDetector wraps its child frame with a tap region", () => {
    let taps = 0;
    const { scene, tapRuns } = render(
      GestureDetector({
        onTap: () => (taps += 1),
        children: Container({ height: 80, color: "#111111" }),
      })
    );
    expect(scene.taps.length).toBe(1);
    expect(scene.taps[0]!.w).toBe(720);
    expect(scene.taps[0]!.h).toBe(80);
    tapRuns[0]!();
    expect(taps).toBe(1);
  });

  test("Container paints fill, stroke, and padding offset", () => {
    const { scene } = render(
      Container({
        color: "#123456",
        borderColor: "#ABCDEF",
        radius: 12,
        padding: 24,
        children: Text({ children: ["padded"] }),
      })
    );
    const fill = rects(scene)[0]!;
    expect(fill.color).toBe("#123456");
    expect(fill.r).toBe(12);
    expect(scene.ops.some((op) => op.op === "outline" && op.color === "#ABCDEF")).toBe(true);
    expect(texts(scene)[0]!.x).toBe(24);
  });

  test("Container and Icon resolve palette role names", () => {
    const { scene } = render(
      Column({
        children: [
          Container({ height: 10, color: "primary" }),
          Icon({ glyph: "★", color: "onSurfaceVariant" }),
        ],
      })
    );
    expect(rects(scene)[0]!.color).toBe("#4C8DFF");
    const icon = texts(scene)[0]!;
    expect(icon.color).toBe("#9AA3B2");
    expect(icon.size).toBe(24);
  });

  test("Text color and Card background resolve palette role names and theme tokens", () => {
    const { scene } = render(
      Column({
        children: [
          Text({ variant: "caption", color: "onSurfaceVariant", children: ["muted"] }),
          Card({ background: "secondaryContainer", children: [Text({ children: ["x"] })] }),
          Card({ background: "surfaceRaised", children: [Text({ children: ["y"] })] }),
        ],
      })
    );
    expect(texts(scene)[0]!.color).toBe("#9AA3B2");
    expect(rects(scene).some((op) => op.color === "#30354A")).toBe(true);
    // Theme tokens keep resolving (cards across every screen rely on this).
    expect(rects(scene).some((op) => op.color === "#1C1C24")).toBe(true);
  });

  test("Wrap flows children onto new lines instead of overflowing", () => {
    const { scene } = render(
      Wrap({
        children: Array.from(
          { length: 5 },
          () => Container({ width: 200, height: 40, color: "#FF0000" })
        ),
      })
    );
    const ys = new Set(rects(scene).map((op) => op.y));
    // 5 × 200 + gaps does not fit 720: two lines (3 + 2), 8 apart vertically.
    expect(ys.size).toBe(2);
    expect(scene.contentHeight).toBe(88);
  });

  test("Spacer adds fixed vertical space in a Column", () => {
    const { scene } = render(
      Column({ children: [Text({ children: ["a"] }), Spacer({ size: 40 }), Text({ children: ["b"] })] })
    );
    expect(scene.contentHeight).toBe(24 + 40 + 24);
    expect(texts(scene)[1]!.y).toBeCloseTo(64 + 24 * 0.78, 5);
  });

  test("Column honors align center and end", () => {
    const centered = render(Column({ align: "center", children: [Text({ children: ["hi"] })] }));
    expect(texts(centered.scene)[0]!.x).toBeCloseTo((720 - textWidth("hi", 17)) / 2, 5);
    const end = render(Column({ align: "end", children: [Text({ children: ["hi"] })] }));
    expect(texts(end.scene)[0]!.x).toBeCloseTo(720 - textWidth("hi", 17), 5);
  });

  test("Row align=start pins children to the top instead of centering", () => {
    const { scene } = render(
      Row({
        align: "start",
        children: [
          Button({ children: ["Tall"] }),
          Icon({ glyph: "★", size: 40 }),
        ],
      })
    );
    // Icon frame (48 tall) starts at y=0 next to the 64-tall button.
    const icon = texts(scene).find((op) => op.text === "★")!;
    expect(icon.y).toBeCloseTo(24 + 40 * 0.36, 5);
  });

  test("legacy default placement is unchanged: Column pads left, Row centers", () => {
    const { scene } = render(
      Column({
        padding: "md",
        children: [Text({ children: ["plain"] })],
      })
    );
    expect(texts(scene)[0]!.x).toBe(16);
    const row = render(
      Row({ children: [Button({ children: ["Tall"] }), Icon({ glyph: "★", size: 40 })] })
    );
    // Default cross-axis centering: icon frame top at (64-48)/2 = 8.
    const icon = texts(row.scene).find((op) => op.text === "★")!;
    expect(icon.y).toBeCloseTo(8 + 24 + 40 * 0.36, 5);
  });
});

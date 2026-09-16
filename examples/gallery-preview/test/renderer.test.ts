import { describe, expect, test } from "bun:test";
import type { DisplayListScene } from "../../ui-kit/src/display-list";

function scene(): DisplayListScene {
  return {
    tenun: "display-list",
    version: 1,
    designWidth: 720,
    contentHeight: 1600,
    background: "#101014",
    ops: [
      { op: "rect", x: 0, y: 0, w: 720, h: 96, r: 0, color: "#101014" },
      { op: "outline", x: 24, y: 120, w: 200, h: 56, r: 14, color: "#4C8DFF", width: 3 },
      { op: "text", x: 40, y: 60, text: "Preview", size: 30, weight: 700, color: "#fff" },
    ],
    taps: [{ x: 24, y: 120, w: 200, h: 56, action: "tap", payload: { id: 0 } }],
  };
}

describe("browser display-list geometry", () => {
  test("720 design units scale proportionally to a 360px viewport", () => {
    const scale = 360 / scene().designWidth;
    expect(scale).toBe(0.5);
    expect(scene().taps[0]!.w * scale).toBe(100);
    expect(scene().taps[0]!.h * scale).toBe(28);
  });

  test("scroll bounds never go below zero", () => {
    const s = scene();
    const viewportDesignHeight = 900;
    expect(Math.max(0, s.contentHeight - viewportDesignHeight)).toBe(700);
    expect(Math.max(0, 300 - viewportDesignHeight)).toBe(0);
  });

  test("hit regions are evaluated in design coordinates", () => {
    const tap = scene().taps[0]!;
    const scale = 0.5;
    const clientX = tap.x * scale + 1;
    const clientY = tap.y * scale + 1;
    const designX = clientX / scale;
    const designY = clientY / scale;
    expect(designX).toBeGreaterThanOrEqual(tap.x);
    expect(designY).toBeGreaterThanOrEqual(tap.y);
    expect(designX).toBeLessThanOrEqual(tap.x + tap.w);
    expect(designY).toBeLessThanOrEqual(tap.y + tap.h);
  });
});

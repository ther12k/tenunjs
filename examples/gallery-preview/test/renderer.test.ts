import { describe, expect, test } from "bun:test";
import type { DisplayListScene, DisplayOp, SerializedTap } from "../../ui-kit/src/display-list";
import { anchorOffsetForTest, hitTestTaps, sceneContractError } from "../renderer";

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

  test("fixed anchors resolve against the visible viewport, not scroll", () => {
    expect(anchorOffsetForTest({ fixed: true, anchor: "bottom", anchorSize: 320 }, 900)).toBe(580);
    expect(anchorOffsetForTest({ fixed: true, anchor: "center", anchorSize: 416 }, 900)).toBe(242);
    expect(anchorOffsetForTest({ fixed: true }, 900)).toBe(0);
  });
});

describe("tap resolution order (topmost wins, one rule with the Android host)", () => {
  const tap = (over: Partial<SerializedTap>): SerializedTap => ({
    x: 0, y: 0, w: 720, h: 96, action: "tap", payload: { id: 0 }, ...over,
  });
  // Modal-sheet anatomy: content button, then a full-viewport containment
  // noop, then the scrim dismiss, then bottom-anchored rows.
  const visibleHeight = 553;
  const sheetTaps: SerializedTap[] = [
    tap({ y: 196, payload: { id: 1 } }),                                    // Filters button (content)
    tap({ fixed: true, y: 0, h: 3200, payload: { id: 13 } }),               // sheet containment noop
    tap({ fixed: true, y: 0, h: 2780, payload: { id: 14 } }),               // scrim dismiss
    tap({ fixed: true, y: 240, h: 72, anchor: "bottom", anchorSize: 420, payload: { id: 15 } }), // row 3
    tap({ fixed: true, y: 320, h: 64, anchor: "bottom", anchorSize: 420, payload: { id: 16 } }), // confirm
  ];

  test("a scrim tap over a covered content button dismisses; the button never fires", () => {
    // Design point (360, 60): inside the back-region AND the scrim; the
    // scrim registered later, so it wins.
    const index = hitTestTaps(sheetTaps, 360, 60, visibleHeight, 0);
    expect(sheetTaps[index!]!.payload.id).toBe(14);
  });

  test("a tap inside the sheet hits the anchored row, not the content beneath it", () => {
    // Row 3 lives at viewport y 373..445 (240 + 553 - 420); a content
    // carousel chevron also sits there — the row must win.
    const contentUnderSheet = tap({ y: 373, h: 88, payload: { id: 99 } });
    const all = [contentUnderSheet, ...sheetTaps.slice(1)];
    const index = hitTestTaps(all, 360, 400, visibleHeight, 0);
    expect(all[index!]!.payload.id).toBe(15);
  });

  test("the confirm button wins over everything it overlaps", () => {
    const index = hitTestTaps(sheetTaps, 380, 494, visibleHeight, 0);
    expect(sheetTaps[index!]!.payload.id).toBe(16);
  });

  test("scrollable content translates by scroll; fixed regions do not", () => {
    const scrolled = hitTestTaps(sheetTaps, 360, 60, visibleHeight, 400);
    expect(sheetTaps[scrolled!]!.payload.id).toBe(14); // scrim still at viewport 60
    const plain = [tap({ y: 1200, payload: { id: 7 } })];
    expect(hitTestTaps(plain, 360, 1300, visibleHeight, 0)).toBeNull();
    expect(hitTestTaps(plain, 360, 1300, visibleHeight, 100)).toBe(0);
  });
});

describe("scene contract validation (browser twin of the Android parser)", () => {
  const op = (over: Partial<DisplayOp>): DisplayOp =>
    ({ op: "rect", x: 0, y: 0, w: 10, h: 10, r: 0, color: "#000000", ...over }) as DisplayOp;
  const scene = (over: Partial<DisplayListScene>): DisplayListScene => ({
    tenun: "display-list",
    version: 1,
    designWidth: 720,
    contentHeight: 900,
    background: "#101014",
    ops: [op({})],
    taps: [],
    ...over,
  });

  test("a valid anchored v1 scene passes, including anchored taps", () => {
    const valid = scene({
      ops: [
        op({ op: "gradient", colorTo: "#141A2B" }),
        op({ op: "text", text: "hi", size: 17, weight: 400, color: "#fff", y: 20 }),
      ],
      taps: [{ x: 0, y: 240, w: 720, h: 72, action: "tap", payload: { id: 0 }, fixed: true, anchor: "bottom", anchorSize: 420 }],
    });
    expect(sceneContractError(valid)).toBeNull();
  });

  test("a future scene version is rejected whole", () => {
    const future = scene({ version: 2 });
    expect(sceneContractError(future)).toContain("version 2");
  });

  test("an unknown op kind rejects the scene even when it appears late", () => {
    // The valid ops come first; the contract violation is the LAST entry.
    // Validation must complete before acceptance so no partial candidate
    // ever paints or dispatches.
    const lateInvalid = scene({
      ops: [op({}), op({ op: "text", text: "ok", size: 17, weight: 400, color: "#fff" }), { op: "hologram" } as unknown as DisplayOp],
      taps: [{ x: 0, y: 0, w: 720, h: 96, action: "tap", payload: { id: 9 } }],
    });
    const error = sceneContractError(lateInvalid);
    expect(error).toContain("hologram");
    expect(error).toContain("ops[2]");
  });
});

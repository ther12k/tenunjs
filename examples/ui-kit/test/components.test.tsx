/**
 * UI-kit component tests: each component is laid out through the shared
 * display-list engine (the same path phone and browser take) and asserts
 * the emitted ops and tap regions.
 */

import { describe, expect, test } from "bun:test";
import { Column } from "@tenunjs/widgets";
import { galleryTheme } from "../../gallery/src/theme";
import {
  Avatar,
  Chip,
  Divider,
  HeroCard,
  ProgressBar,
  ProgressRing,
  Switch,
  layoutScreen,
} from "../src";

function layout(tree: Parameters<typeof layoutScreen>[1]) {
  return layoutScreen(galleryTheme, tree);
}

describe("ui-kit canvas components", () => {
  test("ProgressRing emits a track ring and a proportional progress arc", () => {
    const { scene } = layout(
      <Column padding="lg">
        <ProgressRing value={600} goal={800} size={100} caption="steps" />
      </Column>
    );
    const rings = scene.ops.filter((op) => op.op === "ring");
    expect(rings.length).toBe(1);
    const ring = rings[0] as Extract<(typeof scene.ops)[number], { op: "ring" }>;
    expect(ring.progress).toBeCloseTo(0.75);
    expect(ring.track).toBe("#2A2A35");
    const texts = scene.ops.filter((op) => op.op === "text") as Array<
      Extract<(typeof scene.ops)[number], { op: "text" }>
    >;
    expect(texts.map((t) => t.text)).toContain("75%");
    expect(texts.map((t) => t.text)).toContain("steps");
  });

  test("Switch renders knob position by state and registers one tap", () => {
    let toggles = 0;
    const { scene, tapRuns } = layout(
      <Column padding="lg">
        <Switch on={false} onChange={() => toggles++} />
      </Column>
    );
    const circles = scene.ops.filter((op) => op.op === "circle") as Array<
      Extract<(typeof scene.ops)[number], { op: "circle" }>
    >;
    expect(circles.length).toBe(1);
    // Off: knob sits at the left of the 56-wide pill. The knob's cx is
    // scene-absolute: 16 (relative) + 24 (Column padding lg origin).
    expect(circles[0]!.cx).toBe(40);

    expect(scene.taps.length).toBe(1);
    tapRuns[0]!();
    expect(toggles).toBe(1);

    const onScene = layout(
      <Column padding="lg">
        <Switch on={true} />
      </Column>
    );
    const onKnob = onScene.scene.ops.filter(
      (op) => op.op === "circle"
    )[0] as unknown as Extract<(typeof onScene.scene.ops)[number], { op: "circle" }>;
    // On: 56 - 16 (relative) + 24 (origin).
    expect(onKnob.cx).toBe(64);
  });

  test("Chip fills when selected, outlines otherwise, taps dispatch", () => {
    let picks = 0;
    const { scene, tapRuns } = layout(
      <Column padding="lg" gap="sm">
        <Chip label="Tech" selected={true} onSelect={() => picks++} />
        <Chip label="Home" selected={false} />
      </Column>
    );
    expect(scene.ops.some((op) => op.op === "rect" && op.r === 20)).toBe(true);
    expect(scene.ops.some((op) => op.op === "outline" && op.r === 20)).toBe(true);
    expect(scene.taps.length).toBe(1);
    tapRuns[0]!();
    expect(picks).toBe(1);
  });

  test("Avatar, ProgressBar, Divider, and HeroCard emit their shape ops", () => {
    const { scene } = layout(
      <Column padding="lg" gap="sm">
        <Avatar label="R" size={44} color="#123456" textColor="#FFFFFF" />
        <ProgressBar value={250} max={1000} />
        <Divider />
        <HeroCard title="TOTAL" headline="1234.00" caption="3 accounts" />
      </Column>
    );
    expect(scene.ops.some((op) => op.op === "circle")).toBe(true);
    // Track + fill for the 25% bar.
    const rects = scene.ops.filter((op) => op.op === "rect") as Array<
      Extract<(typeof scene.ops)[number], { op: "rect" }>
    >;
    expect(rects.length).toBeGreaterThanOrEqual(2);
    expect(scene.ops.some((op) => op.op === "line")).toBe(true);
    expect(scene.ops.some((op) => op.op === "gradient")).toBe(true);
    const texts = scene.ops.filter((op) => op.op === "text") as Array<
      Extract<(typeof scene.ops)[number], { op: "text" }>
    >;
    expect(texts.map((t) => t.text)).toContain("TOTAL");
    expect(texts.map((t) => t.text)).toContain("1234.00");
  });
});

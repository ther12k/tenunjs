/**
 * UI-kit component tests: each component is laid out through the shared
 * display-list engine (the same path phone and browser take) and asserts
 * the emitted ops and tap regions.
 */

import { describe, expect, test } from "bun:test";
import { Button, Column } from "@tenunjs/widgets";
import { galleryTheme } from "../../gallery/src/theme";
import {
  Avatar,
  Badge,
  Checkbox,
  Chip,
  Divider,
  FAB,
  HeroCard,
  NavigationBar,
  PageIndicator,
  ProgressBar,
  ProgressRing,
  SegmentedButton,
  Slider,
  SnackBar,
  StarRating,
  Switch,
  Tabs,
  TextField,
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
    // Off: small knob at the left of the 64x36 outlined pill (M3 off
    // thumb). The knob's cx is scene-absolute: 18 (relative) + 24 (Column
    // padding lg origin).
    expect(circles[0]!.cx).toBe(42);
    expect(circles[0]!.r).toBe(8);
    expect(scene.ops.some((op) => op.op === "outline")).toBe(true);

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
    // On: 64 - 18 (relative) + 24 (origin); checked thumb with a check.
    expect(onKnob.cx).toBe(70);
    expect(onKnob.r).toBe(14);
    const onTexts = onScene.scene.ops.filter((op) => op.op === "text") as Array<
      Extract<(typeof onScene.scene.ops)[number], { op: "text" }>
    >;
    expect(onTexts.map((t) => t.text)).toContain("✓");
  });

  test("Chip fills when selected, outlines otherwise, taps dispatch", () => {
    let picks = 0;
    const { scene, tapRuns } = layout(
      <Column padding="lg" gap="sm">
        <Chip label="Tech" selected={true} onSelect={() => picks++} />
        <Chip label="Home" selected={false} />
      </Column>
    );
    // M3 chip: full-pill shape (r = h/2 = 22); the selected chip leads
    // with a check glyph.
    expect(scene.ops.some((op) => op.op === "rect" && op.r === 22)).toBe(true);
    expect(scene.ops.some((op) => op.op === "outline" && op.r === 22)).toBe(true);
    const texts = scene.ops.filter((op) => op.op === "text") as Array<
      Extract<(typeof scene.ops)[number], { op: "text" }>
    >;
    expect(texts.map((t) => t.text)).toContain("✓ Tech");
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

  test("M3 widget set: FAB, Checkbox, Slider, Tabs, NavigationBar, Badge, SnackBar, TextField, SegmentedButton", () => {
    let sliderValue = -1;
    let navIndex = -1;
    let tab = -1;
    let segment = -1;
    let toggles = 0;
    let action = 0;
    const { scene, tapRuns } = layout(
      <Column padding="lg" gap="sm">
        <FAB glyph="✦" label="Compose" onPress={() => action++} />
        <Checkbox checked={true} onToggle={() => toggles++} label="News" />
        <Slider value={0.5} onChange={(v) => (sliderValue = v)} />
        <Tabs tabs={["A", "B", "C"]} active={1} onSelect={(i) => (tab = i)} />
        <NavigationBar
          items={[
            { glyph: "⌂", label: "Home" },
            { glyph: "♡", label: "Saved" },
          ]}
          active={0}
          onSelect={(i) => (navIndex = i)}
        />
        <Badge count={7} />
        <SnackBar message="Saved." actionLabel="UNDO" onAction={() => action++} />
        <TextField label="Name" value="Ada" focused={true} />
        <SegmentedButton options={["Day", "Week"]} selected={0} onSelect={(i) => (segment = i)} />
      </Column>
    );

    // FAB: primary-container pill with layered elevation under it.
    expect(scene.ops.some((op) => op.op === "rect" && op.color === "#44000000")).toBe(true);
    const texts = scene.ops.filter((op) => op.op === "text") as Array<
      Extract<(typeof scene.ops)[number], { op: "text" }>
    >;
    const labels = texts.map((t) => t.text);
    expect(labels).toContain("Compose");
    expect(labels).toContain("✓"); // checkbox check glyph
    expect(labels).toContain("News"); // checkbox label
    expect(labels).toContain("Ada"); // text field value
    expect(labels).toContain("Name"); // floating label
    expect(labels).toContain("UNDO");
    expect(labels).toContain("7"); // badge count

    // Interaction surfaces register taps: FAB, checkbox, slider buckets,
    // tabs, nav items, snackbar action, segments. The text field is
    // render-only here (no onFocusChange), so it contributes none.
    expect(scene.taps.length).toBe(1 + 1 + 24 + 3 + 2 + 1 + 2);
    const run = (index: number) => tapRuns[index]!();
    run(0); // FAB
    expect(action).toBe(1);
    run(1); // checkbox
    expect(toggles).toBe(1);
    run(2 + 12); // slider bucket 12 of 24 -> center fraction
    expect(sliderValue).toBeCloseTo(0.5208, 3);
    run(2 + 24 + 2); // third tab
    expect(tab).toBe(2);
    run(2 + 24 + 3 + 1); // second nav item
    expect(navIndex).toBe(1);
    run(2 + 24 + 3 + 2 + 0); // snackbar action
    expect(action).toBe(2);
    run(2 + 24 + 3 + 2 + 2); // second segment
    expect(segment).toBe(1);
  });

  test("M3 buttons: filled elevates, tonal fills the container, outlined strokes, text is bare", () => {
    const { scene } = layout(
      <Column padding="lg" gap="sm">
        <Button variant="primary">Filled</Button>
        <Button variant="tonal">Tonal</Button>
        <Button variant="secondary">Outlined</Button>
        <Button variant="text">Bare</Button>
      </Column>
    );
    const rects = scene.ops.filter((op) => op.op === "rect") as Array<
      Extract<(typeof scene.ops)[number], { op: "rect" }>
    >;
    const outlines = scene.ops.filter((op) => op.op === "outline");
    // Filled button carries elevation; tonal fills its container role.
    const withShadow = rects.filter((r) => r.shadow !== undefined);
    expect(withShadow.length).toBe(1);
    expect(withShadow[0]!.color).toBe("#4C8DFF");
    expect(rects.some((r) => r.color === "#223354")).toBe(true); // container fill
    expect(outlines.length).toBe(1); // outlined button only
    // Full-pill shape on every filled/stroked button.
    for (const op of [...rects, ...outlines]) {
      if ("r" in op && op.h === 64) expect(op.r).toBe(32);
    }
  });
});

describe("M3 indicator components", () => {
  test("PageIndicator elongates the active dot and keeps one tap per page", () => {
    let picked = -1;
    const { scene, tapRuns } = layout(
      <Column padding="lg">
        <PageIndicator count={3} active={1} onSelect={(index) => (picked = index)} />
      </Column>
    );
    const dots = scene.ops.filter((op) => op.op === "rect") as Array<
      Extract<(typeof scene.ops)[number], { op: "rect" }>
    >;
    expect(dots.length).toBe(3);
    const active = dots.find((d) => d.w === 30);
    expect(active).toBeDefined();
    expect(active!.color).toBe("#4C8DFF");
    // Idle dots stay round and neutral; the pill keeps the dot radius.
    expect(dots.filter((d) => d.w === 14).length).toBe(2);
    expect(active!.r).toBe(7);
    expect(scene.taps.length).toBe(3);
    tapRuns[0]!();
    expect(picked).toBe(0);
  });

  test("StarRating fills whole stars from the value and dims the rest", () => {
    const { scene } = layout(
      <Column padding="lg">
        <StarRating value={3.6} />
      </Column>
    );
    const stars = scene.ops.filter((op) => op.op === "text") as Array<
      Extract<(typeof scene.ops)[number], { op: "text" }>
    >;
    expect(stars.length).toBe(5);
    expect(stars.filter((s) => s.color === "#F5A623").length).toBe(4); // round(3.6)
    expect(stars.filter((s) => s.color === "#474B5A").length).toBe(1);
  });
});

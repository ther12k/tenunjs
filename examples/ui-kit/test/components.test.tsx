/**
 * UI-kit component tests: each component is laid out through the shared
 * display-list engine (the same path phone and browser take) and asserts
 * the emitted ops and tap regions.
 */

import { describe, expect, test } from "bun:test";
import { Button, Column } from "@tenunjs/widgets";
import { galleryTheme } from "../../gallery/src/theme";
import {
  AlertDialog,
  Avatar,
  Badge,
  Carousel,
  Checkbox,
  Chip,
  colorSchemeFromSeed,
  Divider,
  FAB,
  HeroCard,
  ModalBottomSheet,
  NavigationBar,
  PageIndicator,
  ProgressBar,
  ProgressRing,
  SearchBar,
  SegmentedButton,
  Slider,
  SnackBar,
  StarRating,
  Switch,
  Tabs,
  TextField,
  ThemeScopeBox,
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

describe("Modern surface components", () => {
  test("SearchBar emits a tonal pill, optional avatar, and one whole-bar tap", () => {
    let searches = 0;
    const { scene, tapRuns } = layout(
      <Column padding="lg">
        <SearchBar hint="Search plants" avatar="RZ" onTap={() => searches++} />
      </Column>
    );
    const pill = scene.ops.find((op) => op.op === "rect" && op.r === 36) as Extract<
      (typeof scene.ops)[number],
      { op: "rect" }
    >;
    expect(pill).toBeDefined();
    expect(pill.w).toBe(672);
    expect(pill.h).toBe(72);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Search plants")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "RZ")).toBe(true);
    expect(scene.taps).toHaveLength(1);
    tapRuns[0]!();
    expect(searches).toBe(1);
  });

  test("ModalBottomSheet paints an open sheet and preserves scrim, option, and confirm ordering", () => {
    let dismissed = 0;
    let toggled = -1;
    let confirmed = 0;
    const { scene, tapRuns } = layout(
      <Column padding="lg">
        <ModalBottomSheet
          open={true}
          title="Filter plants"
          options={[
            { glyph: "🌿", label: "Pet friendly", selected: true },
            { glyph: "☀️", label: "Low light" },
          ]}
          onToggle={(index) => (toggled = index)}
          confirmLabel="Apply filters"
          onConfirm={() => confirmed++}
          onDismiss={() => dismissed++}
        />
      </Column>
    );
    expect(scene.ops.some((op) => op.op === "rect" && op.color === "#8C000000")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Filter plants")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "✓")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Apply filters")).toBe(true);
    // Full-scene containment, scrim dismissal, two option rows, confirm.
    expect(scene.taps).toHaveLength(5);

    // Outside the sheet, resolve the bottom anchor before applying the same
    // last-containing-region rule used by browser and Android hosts.
    const visibleHeight = 900;
    const resolvedY = (tap: (typeof scene.taps)[number]) =>
      tap.fixed && tap.anchor === "bottom" && tap.anchorSize !== undefined
        ? tap.y + visibleHeight - tap.anchorSize
        : tap.y;
    const outside = scene.taps.filter((tap) => {
      const y = resolvedY(tap);
      return 120 >= tap.x && 120 <= tap.x + tap.w && 200 >= y && 200 <= y + tap.h;
    });
    expect(outside.map((tap) => tap.payload.id)).toEqual([0, 1]);
    tapRuns[outside[outside.length - 1]!.payload.id]!();
    expect(dismissed).toBe(1);

    // Option rows and confirm are later regions than the containment anchor.
    tapRuns[2]!();
    expect(toggled).toBe(0);
    tapRuns[3]!();
    expect(toggled).toBe(1);
    tapRuns[4]!();
    expect(confirmed).toBe(1);
  });

  test("closed ModalBottomSheet contributes no scene operations or taps", () => {
    const { scene } = layout(
      <Column padding="lg">
        <ModalBottomSheet open={false} options={[]} />
      </Column>
    );
    expect(scene.ops).toHaveLength(0);
    expect(scene.taps).toHaveLength(0);
  });

  test("AlertDialog contains its card and exposes dismiss and confirm actions", () => {
    let dismissed = 0;
    let confirmed = 0;
    const { scene, tapRuns } = layout(
      <Column padding="lg">
        <AlertDialog
          open={true}
          glyph="!"
          title="Delete plant?"
          body="This removes the plant from your collection."
          dismissLabel="Cancel"
          confirmLabel="Delete"
          onDismiss={() => dismissed++}
          onConfirm={() => confirmed++}
        />
      </Column>
    );
    expect(scene.ops.some((op) => op.op === "rect" && op.color === "#99000000")).toBe(true);
    expect(scene.ops.some((op) => op.op === "circle" && op.r === 48)).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Delete plant?")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Cancel")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Delete")).toBe(true);
    // Scrim, card containment, dismiss, confirm.
    expect(scene.taps).toHaveLength(4);

    const cardTap = scene.taps[1]!;
    expect(cardTap.x).toBe(80);
    expect(cardTap.y).toBe(0);
    expect(cardTap.w).toBe(560);
    expect(cardTap.h).toBe(440);
    expect(cardTap.fixed).toBe(true);
    expect(cardTap.anchor).toBe("center");
    expect(cardTap.anchorSize).toBe(416);
    tapRuns[2]!();
    expect(dismissed).toBe(1);
    tapRuns[3]!();
    expect(confirmed).toBe(1);
  });

  test("closed AlertDialog is inert", () => {
    const { scene } = layout(
      <Column padding="lg">
        <AlertDialog open={false} title="Hidden" />
      </Column>
    );
    expect(scene.ops).toHaveLength(0);
    expect(scene.taps).toHaveLength(0);
  });

  test("Carousel renders one hero plus peeking cards and routes controls", () => {
    let cycle: number = 0;
    let selected = -1;
    const { scene, tapRuns } = layout(
      <Column padding="lg">
        <Carousel
          active={0}
          items={[
            { glyph: "🌿", title: "Monstera", subtitle: "Statement green", tint: "#1E3A2F" },
            { glyph: "🌵", title: "Cactus", subtitle: "Sun loving", tint: "#3A2F1E" },
            { glyph: "🌸", title: "Peace lily", subtitle: "Soft blooms", tint: "#3A2430" },
          ]}
          onCycle={(direction) => (cycle = direction)}
          onSelect={(index) => (selected = index)}
        />
      </Column>
    );
    const cards = scene.ops.filter((op) => op.op === "rect" && op.r === 24) as Array<
      Extract<(typeof scene.ops)[number], { op: "rect" }>
    >;
    expect(cards.length).toBe(2);
    expect(cards.some((card) => card.w === 372 && card.h === 420 && card.shadow === 8)).toBe(true);
    expect(cards.some((card) => card.w >= 184 && card.h === 356)).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Monstera")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Cactus")).toBe(true);
    // Previous, next, then first peeking card.
    expect(scene.taps).toHaveLength(3);
    tapRuns[0]!();
    expect(cycle).toBe(-1);
    tapRuns[1]!();
    expect(cycle).toBe(1);
    tapRuns[2]!();
    expect(selected).toBe(1);
  });
});

describe("ThemeScope", () => {
  test("kit components resolve colors from the scoped scheme", () => {
    const { scene } = layout(
      <Column padding="lg" gap="sm">
        <ThemeScopeBox scheme={colorSchemeFromSeed("#3DD68C", false)}>
          <FAB glyph="✨" size={72} />
        </ThemeScopeBox>
        <FAB glyph="✨" size={72} />
      </Column>
    );
    const rects = scene.ops.filter((op) => op.op === "rect") as Array<
      Extract<(typeof scene.ops)[number], { op: "rect" }>
    >;
    // Scoped FAB carries the leaf-seed container tone; the ambient one keeps
    // the default palette.
    const fills = rects.map((r) => r.color);
    expect(fills).toContain(colorSchemeFromSeed("#3DD68C", false).primaryContainer);
    expect(fills).toContain("#223354");
  });

  test("engine widgets follow the scope through the mapped theme tokens", () => {
    const { scene } = layout(
      <ThemeScopeBox scheme={colorSchemeFromSeed("#3DD68C", false)}>
        <Button variant="primary">Go</Button>
      </ThemeScopeBox>
    );
    const fill = scene.ops.find(
      (op) => op.op === "rect" && (op as any).h === 64
    ) as unknown as Extract<(typeof scene.ops)[number], { op: "rect" }>;
    expect(fill!.color).toBe(colorSchemeFromSeed("#3DD68C", false).primary);
  });

  test("nested scopes: the inner scope wins", () => {
    const leaf = colorSchemeFromSeed("#3DD68C", false);
    const amber = colorSchemeFromSeed("#F5A623", false);
    const { scene } = layout(
      <ThemeScopeBox scheme={leaf}>
        <ThemeScopeBox scheme={amber}>
          <FAB glyph="✨" size={72} />
        </ThemeScopeBox>
      </ThemeScopeBox>
    );
    const rects = scene.ops.filter((op) => op.op === "rect") as Array<
      Extract<(typeof scene.ops)[number], { op: "rect" }>
    >;
    expect(rects.some((r) => r.color === amber.primaryContainer)).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { Column, Text, layoutScreen, layoutTextLines, textWidth, wrapText } from "../src/index";

/**
 * A1 fixtures: the text measurement/wrap contract the display-list lowering
 * and the Android paint must agree on. Metrics stay APPROXIMATE by design
 * (per-character estimate; exact shaping is TN-075) — these fixtures pin the
 * contract the approximation must satisfy: one op per painted line, height =
 * lines × lineHeight, ellipsis/maxLines bounds, unbreakable-word (CJK)
 * breaking, and text-scale remeasurement.
 */

const theme = { colors: { surface: "#101014", text: "#F2F2F7", accent: "#4C8DFF" } };

type TextOp = Extract<ReturnType<typeof layoutScreen>["scene"]["ops"][number], { op: "text" }>;

function textOps(scene: ReturnType<typeof layoutScreen>["scene"]): TextOp[] {
  return scene.ops.filter((op): op is TextOp => op.op === "text");
}

describe("A1 wrapText contract", () => {
  test("greedy word wrap fills lines and never emits an empty line", () => {
    const lines = wrapText("Complete your set then rest", 17, 100);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      expect(textWidth(line, 17)).toBeLessThanOrEqual(100 + textWidth(" ", 17));
    }
    expect(lines.join(" ").split(/\s+/)).toEqual("Complete your set then rest".split(/\s+/));
  });

  test("an unbreakable word wider than the line hard-breaks on code points", () => {
    // CJK runs carry no break spaces; without the hard break they overflow.
    const lines = wrapText("日本語のテキストは空白を含みませんが折り返されます", 17, 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      expect(textWidth(line, 17)).toBeLessThanOrEqual(100);
    }
    expect(lines.join("")).toBe("日本語のテキストは空白を含みませんが折り返されます");
    // A long ASCII "word" (URL) behaves the same.
    const url = wrapText("https://example.invalid/very/long/path/segment", 17, 96);
    expect(url.length).toBeGreaterThan(1);
    expect(url.join("")).toBe("https://example.invalid/very/long/path/segment");
  });

  test("empty content still paints one empty line (no NaN geometry)", () => {
    expect(wrapText("", 17, 100)).toEqual([""]);
    expect(wrapText("   ", 17, 100)).toEqual([""]);
  });
});

describe("A1 lowering fixtures (measure/place single source)", () => {
  test("a long exercise name wraps: op count matches lines, height matches, bounds align", () => {
    const longName = "Barbell bench press (medium grip, flat bench) with incline spotters";
    const { scene } = layoutScreen(theme, Column({ children: [Text({ children: longName })] }), { width: 320, height: 480 });
    const bodySize = 17;
    const lineHeight = 24;
    // Every wrapped line is a substring of the full label (word wrap keeps
    // word boundaries), and the block needs more than one line.
    const ops = textOps(scene).filter((op) => op.text.length > 0 && longName.includes(op.text));
    expect(ops.length).toBeGreaterThanOrEqual(2);
    const expected = wrapText(longName, bodySize, Math.max(...ops.map((op) => op.x + textWidth(op.text, bodySize))));
    // Baselines are lineHeight apart starting at baseline offset 0.78.
    ops.forEach((op, index) => {
      expect(op.y).toBeCloseTo(ops[0]!.y + index * lineHeight, 5);
    });
    // Height = lines × lineHeight: the sum in scene content matches the wrap.
    expect(textWidth(ops[0]!.text, bodySize)).toBeLessThanOrEqual(320);
    // Semantics carries the FULL label once (announces the whole string).
    const labels = scene.semantics?.nodes.filter((node) => node.label === longName) ?? [];
    expect(labels.length).toBe(1);
    const bounds = labels[0]!.bounds;
    expect(bounds.h).toBeCloseTo(expected.length * lineHeight, 5);
  });

  test("maxLines caps the painted lines and measured height; ellipsis marks the cut", () => {
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen";
    const tree = Column({ children: [Text({ children: long, maxLines: 2, ellipsis: true })] });
    const { scene } = layoutScreen(theme, tree, { width: 200, height: 480 });
    const ops = textOps(scene).filter((op) => op.text.startsWith("one ") || op.text.startsWith("two") || op.text.includes("…"));
    expect(ops.length).toBe(2);
    expect(ops[1]!.text.endsWith("…")).toBe(true);
    // Semantics still announces the FULL string, never the truncation.
    const label = scene.semantics?.nodes.find((node) => node.label === long);
    expect(label).toBeDefined();
    expect(label!.bounds.h).toBeCloseTo(2 * 24, 5);
    // Without ellipsis the cap is silent truncation (bounded ops, no marker).
    const silent = layoutScreen(theme, Column({ children: [Text({ children: long, maxLines: 2 })] }), { width: 200, height: 480 });
    const silentOps = textOps(silent.scene).filter((op) => op.text.includes("one") || op.text.includes("…"));
    expect(silentOps.some((op) => op.text.endsWith("…"))).toBe(false);
  });

  test("invalid maxLines/ellipsis props fail closed with INVALID_CONSTRAINT", () => {
    const ty = { size: 17, lineHeight: 24 };
    for (const bad of [0, -1, 1.5, Number.NaN, "3"]) {
      expect(() => layoutTextLines({ maxLines: bad }, "text", ty, 100)).toThrow("maxLines must be a positive integer");
    }
    expect(() => layoutTextLines({ ellipsis: "yes" }, "text", ty, 100)).toThrow("ellipsis must be a boolean");
    // A cap below the natural line count truncates; a cap above it does not.
    const wrapped = layoutTextLines({ maxLines: 1 }, "a b c d e f", ty, 100);
    expect(wrapped.lines).toHaveLength(1);
    expect(wrapped.truncated).toBe(true);
    expect(layoutTextLines({ maxLines: 5 }, "a b c d e f", ty, 100).truncated).toBe(false);
  });

  test("layoutTextLines is the shared source: measure and place agree on truncated boxes", () => {
    const long = "wrap me please into many many lines for the fixture";
    const ty = { size: 17, lineHeight: 24 };
    const maxWidth = 150;
    const { lines, truncated } = layoutTextLines({ maxLines: 3, ellipsis: true }, long, ty, maxWidth);
    expect(truncated).toBe(true);
    const full = wrapText(long, ty.size, maxWidth);
    expect(lines.length).toBe(3);
    expect(lines.length).toBeLessThan(full.length);
    expect(lines[2]!.endsWith("…")).toBe(true);
  });

  test("2x text scale remeasures: more lines, taller box, scaled baselines", () => {
    const text = "Complete your working set with good form";
    const plain = layoutScreen(theme, Column({ children: [Text({ children: text })] }), { width: 320, height: 480 });
    const scaled = layoutScreen(theme, Column({ children: [Text({ children: text })] }), { width: 320, height: 480 }, undefined, { textScale: 2 });
    const plainOps = textOps(plain.scene).filter((op) => op.text.includes("Complete") || op.text.includes("your") ||
      op.text.includes("working") || op.text.includes("set ") || op.text.includes("form"));
    const scaledOps = textOps(scaled.scene).filter((op) => op.text.includes("Complete") || op.text.includes("your") ||
      op.text.includes("working") || op.text.includes("set ") || op.text.includes("form"));
    expect(scaledOps.length).toBeGreaterThan(plainOps.length);
    // Baseline step is the scaled line height (24 × 2 = 48).
    if (scaledOps.length > 1) {
      expect(scaledOps[1]!.y - scaledOps[0]!.y).toBeCloseTo(48, 0);
    }
  });
});

describe("A1 documented metric approximation", () => {
  test("textWidth is the documented per-character estimate, pinned as a formula", () => {
    // The estimate is count × 0.56 × size — deliberately approximate.
    // This fixture pins ONLY the formula so a factor change is a conscious
    // contract change; it is NOT renderer evidence. Agreement with the real
    // painted advance (Roboto via Paint.measureText / canvas fonts) is
    // TN-075's contract and requires recorded renderer measurements on the
    // declared Android target — no fabricated tolerance band here.
    const sample = "Complete your set";
    const size = 17;
    expect(textWidth(sample, size)).toBe(sample.length * size * 0.56);
    expect(textWidth("", size)).toBe(0);
    expect(textWidth("😀", 17)).toBe(2 * 17 * 0.56); // UTF-16 code units, like the host offsets
  });
});

describe("review fixes — wrap/ellipsis hardening", () => {
  test("the ellipsis marker always fits the line budget and never introduces malformed surrogates", () => {
    const { lines } = layoutTextLines({ maxLines: 1, ellipsis: true }, "M".repeat(20), { size: 17, lineHeight: 24 }, 100);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("…")).toBe(true);
    expect(textWidth(lines[0]!, 17)).toBeLessThanOrEqual(100);

    // Multi-byte emoji trimming never leaves an unpaired high surrogate.
    const emojiTrim = layoutTextLines({ maxLines: 1, ellipsis: true }, "😀😀😀", { size: 17, lineHeight: 24 }, 40);
    expect(emojiTrim.lines).toHaveLength(1);
    expect(emojiTrim.lines[0]!.endsWith("…")).toBe(true);
    // Unpaired surrogates fail isWellFormed check.
    if (typeof (emojiTrim.lines[0] as unknown as { isWellFormed?: () => boolean }).isWellFormed === "function") {
      expect((emojiTrim.lines[0] as unknown as { isWellFormed: () => boolean }).isWellFormed()).toBe(true);
    }
    // Sub-marker width: if the marker itself exceeds the budget, it is suppressed to prevent overflow.
    const subMarker = layoutTextLines({ maxLines: 1, ellipsis: true }, "abc", { size: 17, lineHeight: 24 }, 1);
    expect(subMarker.lines).toHaveLength(1);
    expect(textWidth(subMarker.lines[0]!, 17)).toBeLessThanOrEqual(1);
  });

  test("hard breaks never split graphemes: accents, ZWJ emoji, and flags stay whole", () => {
    // Combining accent: every wrapped line rejoins to the original text, and
    // no line STARTS with a bare combining mark.
    const accented = "Cafe\u0301";
    const lines = wrapText(accented, 17, 40);
    expect(lines.join("")).toBe(accented);
    for (const line of lines) {
      // No line STARTS with a bare combining mark (separated from its base);
      // a cluster like "e\u0301" may legitimately END with one.
      expect(/^[\u0300-\u036f]/.test(line)).toBe(false);
    }
    // Arabic vowel mark and combining diacritical marks supplement stay with base.
    expect(wrapText("a\u1dc0b", 17, 10)).toEqual(["a\u1dc0", "b"]);
    expect(wrapText("ب\u064eب", 17, 10)).toEqual(["ب\u064e", "ب"]);

    // ZWJ family emoji: one cluster, never split across lines.
    const family = "👨\u200d👩\u200d👧\u200d👦";
    const familyLines = wrapText(`${family} ${family}`, 17, Math.ceil(textWidth(family, 17)));
    for (const line of familyLines) {
      expect(line.includes(family) || line.trim().length === 0 || !line.includes("\u200d")).toBe(true);
    }
    expect(wrapText(`${family} ${family}`, 17, Math.ceil(textWidth(family, 17))).join(" ").split(/\s+/).filter(Boolean).join(" "))
      .toBe(`${family} ${family}`);

    // Flags: regional indicator pair parity (each flag is a pair of 2).
    const flags = "🇮🇩🇯🇵🇩🇪";
    const flagLines = wrapText(flags, 17, 39);
    expect(flagLines).toEqual(["🇮🇩", "🇯🇵", "🇩🇪"]);
  });

  test("an oversized word hard-breaks even after earlier words fill a line", () => {
    const lines = wrapText(`ok ${"x".repeat(25)} tail`, 17, 100);
    for (const line of lines.slice(0, lines.length - 1)) {
      // Every FULL line (except possibly the last, which may hold "tail") fits the budget.
      expect(textWidth(line, 17)).toBeLessThanOrEqual(100);
    }
    // Hard breaks insert no space, so compare non-space characters in order.
    expect(lines.join("").split(/\s+/).filter(Boolean).join(""))
      .toBe(`ok${"x".repeat(25)}tail`);
    // maxLines + ellipsis now actually truncates this case (was: truncated false).
    const capped = layoutTextLines({ maxLines: 2, ellipsis: true }, `ok ${"x".repeat(25)} tail`, { size: 17, lineHeight: 24 }, 100);
    expect(capped.truncated).toBe(true);
    expect(capped.lines[1]!.endsWith("…")).toBe(true);
    expect(textWidth(capped.lines[1]!, 17)).toBeLessThanOrEqual(100);
  });

  test("an explicit null maxLines/ellipsis is absent, matching the runtime prop codec", () => {
    const ty = { size: 17, lineHeight: 24 };
    expect(() => layoutTextLines({ maxLines: null, ellipsis: null }, "some text", ty, 100)).not.toThrow();
    expect(layoutTextLines({ maxLines: null, ellipsis: null }, "some text", ty, 100).lines).toEqual(wrapText("some text", 17, 100));
  });
});

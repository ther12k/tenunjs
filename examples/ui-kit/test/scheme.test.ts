/**
 * Scheme generator tests: the palettes are checked against perceptual
 * invariants (tone ordering, WCAG contrast, gamut safety, determinism)
 * rather than snapshot constants — the properties Flutter guarantees about
 * ColorScheme.fromSeed, asserted directly.
 */

import { describe, expect, test } from "bun:test";
import {
  colorSchemeFromSeed,
  oklchToLinearSrgb,
  linearSrgbToOklch,
  seedToHueChroma,
  tonalPalette,
  wcagContrast,
} from "../src/scheme";

function isHexColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/.test(value);
}

describe("OKLCH core", () => {
  test("round-trips through linear sRGB inside the gamut", () => {
    const lin = (v: number): number => Math.pow((v + 0.055) / 1.055, 2.4);
    for (const hex of ["#4C8DFF", "#3DD68C", "#F5A623", "#101014", "#FFFFFF"]) {
      const rgb: [number, number, number] = [
        lin(parseInt(hex.slice(1, 3), 16) / 255),
        lin(parseInt(hex.slice(3, 5), 16) / 255),
        lin(parseInt(hex.slice(5, 7), 16) / 255),
      ];
      const oklch = linearSrgbToOklch(rgb);
      const back = oklchToLinearSrgb(oklch);
      for (let i = 0; i < 3; i++) {
        expect(back[i]).toBeCloseTo(rgb[i]!, 3);
      }
    }
  });

  test("hue extraction separates seeds by family", () => {
    const blue = seedToHueChroma("#4C8DFF");
    const green = seedToHueChroma("#3DD68C");
    const amber = seedToHueChroma("#F5A623");
    expect(blue.hue).toBeGreaterThan(200);
    expect(blue.hue).toBeLessThan(280);
    expect(green.hue).toBeGreaterThan(120);
    expect(green.hue).toBeLessThan(180);
    expect(amber.hue).toBeGreaterThan(50);
    expect(amber.hue).toBeLessThan(110);
  });
});

describe("tonal palette", () => {
  test("tone orders lightness monotonically", () => {
    const palette = tonalPalette(255, 48);
    const low = palette.tone(20);
    const mid = palette.tone(50);
    const high = palette.tone(80);
    for (const hex of [low, mid, high]) expect(isHexColor(hex)).toBe(true);
    // Relative luminance must rise with tone.
    const y = (hex: string): number => {
      const ch = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(1)) + 0.0722 * lin(ch(2));
    };
    expect(y(low)).toBeLessThan(y(mid));
    expect(y(mid)).toBeLessThan(y(high));
  });

  test("clamps to the sRGB gamut instead of producing invalid colors", () => {
    // Chroma 200 is far out of gamut; every tone must still yield a valid hex.
    for (const tone of [5, 20, 40, 50, 70, 90, 98]) {
      expect(isHexColor(tonalPalette(30, 200).tone(tone))).toBe(true);
    }
  });
});

describe("colorSchemeFromSeed", () => {
  test("fills every role with a valid hex, deterministically", () => {
    const a = colorSchemeFromSeed("#4C8DFF", true);
    const b = colorSchemeFromSeed("#4C8DFF", true);
    expect(a).toEqual(b);
    for (const value of Object.values(a)) {
      expect(isHexColor(value)).toBe(true);
    }
  });

  test("onPrimary contrasts with primary in both modes (WCAG >= 4)", () => {
    for (const seed of ["#4C8DFF", "#3DD68C", "#F5A623", "#A78BFA", "#FF5A5F"]) {
      const light = colorSchemeFromSeed(seed, false);
      const dark = colorSchemeFromSeed(seed, true);
      expect(wcagContrast(light.primary, light.onPrimary)).toBeGreaterThanOrEqual(4);
      expect(wcagContrast(dark.primary, dark.onPrimary)).toBeGreaterThanOrEqual(4);
      // Body text on surface: the M3 tone pairing lands near-perfect.
      expect(wcagContrast(light.surface, light.onSurface)).toBeGreaterThanOrEqual(12);
      expect(wcagContrast(dark.surface, dark.onSurface)).toBeGreaterThanOrEqual(10);
    }
  });

  test("light and dark schemes invert their surface roles", () => {
    const light = colorSchemeFromSeed("#4C8DFF", false);
    const dark = colorSchemeFromSeed("#4C8DFF", true);
    const y = (hex: string): number => {
      const ch = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(1)) + 0.0722 * lin(ch(2));
    };
    expect(y(light.surface)).toBeGreaterThan(0.8);
    expect(y(dark.surface)).toBeLessThan(0.05);
    // Dark primary is lighter than light primary (tone 80 vs 40).
    expect(y(dark.primary)).toBeGreaterThan(y(light.primary));
  });

  test("degenerate seeds stay safe", () => {
    for (const seed of ["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#123456"]) {
      const scheme = colorSchemeFromSeed(seed, false);
      expect(isHexColor(scheme.primary)).toBe(true);
      expect(wcagContrast(scheme.primary, scheme.onPrimary)).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("wcagContrast", () => {
  test("matches the canonical reference ratios", () => {
    expect(wcagContrast("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(wcagContrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // Black on white vs white on black are symmetric.
    expect(wcagContrast("#000000", "#FFFFFF")).toBeCloseTo(wcagContrast("#FFFFFF", "#000000"), 9);
  });
});

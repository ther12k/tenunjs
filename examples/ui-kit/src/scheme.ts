/**
 * Seed-driven Material-3-style color schemes — TenunJS's own version of
 * Flutter's ColorScheme.fromSeed.
 *
 * Instead of porting material_color_utilities' CAM16/HCT machinery, the
 * tonal palettes are built in OKLCH (Björn Ottosson's published matrices,
 * reproduced exactly): hue and chroma come from the seed, and each M3 role
 * takes its tone (perceptual lightness, CIE L* semantics) from the same
 * mapping the M3 spec defines for light and dark schemes. The result is
 * deterministic, dependency-free, and testable against tone invariants
 * (ordering, contrast, gamut clamping) rather than against snapshot
 * constants.
 *
 * NOTE: never place "#" inside a template literal in this repo — the
 * static graph scanner hangs on that construct (issue #200). Hex strings
 * are built by concatenation only.
 */

/** Every color role the kit and the engine consume. */
export interface SchemeRoles {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  surface: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  error: string;
  success: string;
  warning: string;
  inverseSurface: string;
  onInverseSurface: string;
  onPrimaryFixed: string;
}

/** ---------- OKLCH core (Ottosson's matrices) ---------- */

const SRGB_TO_LMS: ReadonlyArray<readonly [number, number, number]> = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

const LMS_PRIME_TO_OKLAB: ReadonlyArray<readonly [number, number, number]> = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

const OKLAB_TO_LMS_PRIME: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.0894841775, -1.291485548],
];

const LMS_TO_SRGB: ReadonlyArray<readonly [number, number, number]> = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

function multiply(matrix: ReadonlyArray<readonly [number, number, number]>, v: [number, number, number]): [number, number, number] {
  return [
    matrix[0]![0]! * v[0] + matrix[0]![1]! * v[1] + matrix[0]![2]! * v[2],
    matrix[1]![0]! * v[0] + matrix[1]![1]! * v[1] + matrix[1]![2]! * v[2],
    matrix[2]![0]! * v[0] + matrix[2]![1]! * v[1] + matrix[2]![2]! * v[2],
  ];
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

function cbrt(value: number): number {
  return value < 0 ? -Math.pow(-value, 1 / 3) : Math.pow(value, 1 / 3);
}

export interface Oklch {
  /** Perceptual lightness 0..1. */
  l: number;
  /** Chroma, unbounded but feasible sRGB values are ~0..0.37. */
  c: number;
  /** Hue in degrees 0..360. */
  h: number;
}

export function oklchToLinearSrgb(color: Oklch): [number, number, number] {
  const hRad = (color.h * Math.PI) / 180;
  const a = Math.cos(hRad) * color.c;
  const b = Math.sin(hRad) * color.c;
  const lmsPrime = multiply(OKLAB_TO_LMS_PRIME, [color.l, a, b]);
  const lms = lmsPrime.map((v) => v * v * v) as [number, number, number];
  return multiply(LMS_TO_SRGB, lms);
}

export function linearSrgbToOklch(rgb: [number, number, number]): Oklch {
  const lms = multiply(SRGB_TO_LMS, rgb);
  const lmsPrime = lms.map(cbrt) as [number, number, number];
  const [l, a, b] = multiply(LMS_PRIME_TO_OKLAB, lmsPrime);
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l, c, h };
}

function inGamut(rgb: [number, number, number]): boolean {
  const eps = 1e-4;
  return rgb.every((channel) => channel >= -eps && channel <= 1 + eps);
}

/** Relative luminance (WCAG) of a linear-light triple. */
function luminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** CIE L* (the M3 "tone") to relative luminance Y in [0, 1]. */
function toneToY(tone: number): number {
  const kappa = 24389 / 27;
  if (tone > 8) {
    const base = (tone + 16) / 116;
    return base * base * base;
  }
  return tone / kappa;
}

/**
 * Largest chroma at (l, h) that stays inside sRGB. The gamut headroom
 * shrinks toward white and black, so the clamp is per-lightness.
 */
function feasibleChroma(l: number, hue: number, cap: number): number {
  let lo = 0;
  let hi = cap;
  if (inGamut(oklchToLinearSrgb({ l, c: hi, h: hue }))) return hi;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinearSrgb({ l, c: mid, h: hue }))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Resolves the in-gamut OKLCH color for a palette (hue, chroma) at a tone. */
function solveTone(paletteHue: number, chroma: number, tone: number): Oklch {
  const targetY = toneToY(tone);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const c = feasibleChroma(mid, paletteHue, chroma);
    const y = luminance(oklchToLinearSrgb({ l: mid, c, h: paletteHue }));
    if (y < targetY) lo = mid;
    else hi = mid;
  }
  const l = (lo + hi) / 2;
  return { l, c: feasibleChroma(l, paletteHue, chroma), h: paletteHue };
}

/** One hue/chroma pair; tones are Material's perceptual lightness 0..100. */
export interface TonalPalette {
  tone(tone: number): string;
}

export function tonalPalette(hue: number, chroma: number): TonalPalette {
  return {
    tone(tone: number): string {
      const color = solveTone(hue, chroma, Math.max(0, Math.min(100, tone)));
      const rgb = oklchToLinearSrgb(color);
      const hex = rgb
        .map((channel) =>
          Math.max(0, Math.min(255, Math.round(linearToSrgb(channel) * 255)))
            .toString(16)
            .padStart(2, "0")
        )
        .join("");
      return ("#" + hex).toUpperCase();
    },
  };
}

/** Extracts the seed's OKLCH hue (0..360) and chroma. */
export function seedToHueChroma(seedHex: string): { hue: number; chroma: number } {
  const r = srgbToLinear(parseInt(seedHex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(seedHex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(seedHex.slice(5, 7), 16) / 255);
  const { h, c } = linearSrgbToOklch([r, g, b]);
  return { hue: h, chroma: c };
}

function clampHex(value: string): string {
  const hex = value.replace("#", "").trim();
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : hex;
  return "#" + full.slice(0, 6).padEnd(6, "0");
}

/**
 * The full M3 role set generated from one seed color — the same tone
 * mapping the Material 3 spec defines for light and dark schemes:
 * primary takes the seed hue at chroma >= 48; secondary sits at chroma 16;
 * tertiary shifts the hue by 60 at chroma 48; neutrals live at chroma 4
 * (8 for the variant roles); error stays at hue 25, chroma 84. Success and
 * warning are kit extensions: fixed pleasant seeds, theme-following tones.
 */
export function colorSchemeFromSeed(seedHex: string, dark: boolean): SchemeRoles {
  const { hue } = seedToHueChroma(clampHex(seedHex));
  const primaryP = tonalPalette(hue, 48);
  const secondaryP = tonalPalette(hue, 16);
  const tertiaryP = tonalPalette((hue + 60) % 360, 48);
  const neutralP = tonalPalette(hue, 4);
  const variantP = tonalPalette(hue, 8);
  const errorP = tonalPalette(25, 84);
  const successP = tonalPalette(150, 30);
  const warningP = tonalPalette(75, 40);

  if (dark) {
    return {
      primary: primaryP.tone(80),
      onPrimary: primaryP.tone(20),
      primaryContainer: primaryP.tone(30),
      onPrimaryContainer: primaryP.tone(90),
      secondaryContainer: secondaryP.tone(30),
      onSecondaryContainer: secondaryP.tone(90),
      surface: neutralP.tone(6),
      surfaceContainer: neutralP.tone(12),
      surfaceContainerHigh: neutralP.tone(17),
      onSurface: neutralP.tone(90),
      onSurfaceVariant: variantP.tone(80),
      outline: variantP.tone(60),
      outlineVariant: variantP.tone(30),
      error: errorP.tone(80),
      success: successP.tone(80),
      warning: warningP.tone(80),
      inverseSurface: neutralP.tone(90),
      onInverseSurface: neutralP.tone(20),
      onPrimaryFixed: primaryP.tone(100),
    };
  }
  return {
    primary: primaryP.tone(40),
    onPrimary: primaryP.tone(100),
    primaryContainer: primaryP.tone(90),
    onPrimaryContainer: primaryP.tone(10),
    secondaryContainer: secondaryP.tone(90),
    onSecondaryContainer: secondaryP.tone(10),
    surface: neutralP.tone(98),
    surfaceContainer: neutralP.tone(94),
    surfaceContainerHigh: neutralP.tone(92),
    onSurface: neutralP.tone(10),
    onSurfaceVariant: variantP.tone(30),
    outline: variantP.tone(50),
    outlineVariant: variantP.tone(80),
    error: errorP.tone(40),
    success: successP.tone(40),
    warning: warningP.tone(40),
    inverseSurface: neutralP.tone(20),
    onInverseSurface: neutralP.tone(100),
    onPrimaryFixed: primaryP.tone(10),
  };
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function wcagContrast(aHex: string, bHex: string): number {
  const y = (hex: string): number => {
    const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
    const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
    const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ya = y(aHex);
  const yb = y(bHex);
  const lighter = Math.max(ya, yb);
  const darker = Math.min(ya, yb);
  return (lighter + 0.05) / (darker + 0.05);
}

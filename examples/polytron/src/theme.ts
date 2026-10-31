import { defineTheme } from "@tenunjs/widgets";

/**
 * Polytron Wash theme — the official asset-kit tokens
 * (design/asset-kit polytron-wash-assets/tokens.json, 2026-10-31):
 * deep navy primary, bright teal accent (tealInk for text on light),
 * sky accents, soft blue-gray canvas, big radii, 48px touch targets.
 */
export const washerTheme = defineTheme({
  colors: {
    background: "#F6F8FB",
    surface: "#FFFFFF",
    surfaceRaised: "#FFFFFF",
    accent: "#00C2B8", // teal — decorative fills, active states
    primaryContainer: "#0B2D5B", // navy hero card (gradient end #005D79)
    onPrimaryContainer: "#F6FAFF",
    secondaryContainer: "#E6F5FC", // pale — selected chips
    onSecondaryContainer: "#007F79",
    outline: "#E2EAF2",
    outlineVariant: "#EDF2F8",
    text: "#0F172A",
    textDim: "#64748B",
    danger: "#D92438",
    success: "#087F5B",
    warning: "#C77700",
  },
  spacing: { sm: 8, md: 12, lg: 16, xl: 24 },
  typography: {
    display: { size: 44, lineHeight: 52, weight: 700 },
    headline: { size: 30, lineHeight: 38, weight: 700 },
    title: { size: 24, lineHeight: 32, weight: 700 },
    body: { size: 14, lineHeight: 20, weight: 400 },
    label: { size: 16, lineHeight: 22, weight: 600 },
    caption: { size: 12, lineHeight: 16, weight: 400 },
  },
});

/** Kit palette extras the theme roles don't carry. */
export const KIT = {
  navy: "#0B2D5B",
  navyGrad: "#005D79", // primary gradient end
  teal: "#00C2B8",
  tealInk: "#007F79",
  tealGrad: "#003353", // brand gradient end
  sky: "#3DA9FF",
  skyInk: "#0079B8",
  success: "#087F5B",
  successBg: "#E2FAF0",
  danger: "#D92438",
  dangerDark: "#B91C2D",
  dangerBg: "#FFF0F2",
  pale: "#E6F5FC",
  track: "#DFF1F7",
  muted: "#64748B",
  border: "#E2EAF2",
  text: "#0F172A",
  bg: "#F6F8FB",
  water: "#3DA9FF",
  waterTrack: "#DFF1F7",
  white: "#FFFFFF",
} as const;

/** Cycle-mode accents — hues from the kit's stage icons, readable on white. */
export const MODE_COLORS: Record<string, string> = {
  WASH: "#007F79", // teal ink
  DRAIN: "#0079B8", // sky ink
  FILL: "#087F5B", // success
  SPIN: "#0B2D5B", // navy
  WAIT: "#C77700",
  STOP: "#D92438",
  IDLE: "#64748B",
};

export function modeColor(mode: string): string {
  return MODE_COLORS[mode] ?? "#64748B";
}

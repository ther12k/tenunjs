import { defineTheme } from "@tenunjs/widgets";

/**
 * Polytron Wash theme — the calm light design language (2026-10-30
 * redesign, "Calm control. Clear status."): near-white blue-gray canvas,
 * white cards, teal accent, navy program hero, red stop. One quiet system
 * instead of the old dark LCD palette.
 */
export const washerTheme = defineTheme({
  colors: {
    background: "#EFF3F6",
    surface: "#FFFFFF",
    surfaceRaised: "#FFFFFF",
    accent: "#0E9F8C", // teal — links, active states, progress
    primaryContainer: "#143A56", // navy program hero card
    onPrimaryContainer: "#F2F8FB",
    secondaryContainer: "#DFF3EE", // teal tint (selected chips)
    onSecondaryContainer: "#0B6B5D",
    outline: "#D9E4EB",
    outlineVariant: "#E7EEF3",
    text: "#182E38",
    textDim: "#5F7A8C",
    danger: "#E5484D",
    success: "#17A673",
    warning: "#F5A524",
  },
  spacing: { sm: 8, md: 14, lg: 20 },
  typography: {
    display: { size: 44, lineHeight: 52, weight: 700 },
    headline: { size: 30, lineHeight: 38, weight: 700 },
    title: { size: 17, lineHeight: 24, weight: 700 },
    body: { size: 14, lineHeight: 20, weight: 400 },
    label: { size: 11.5, lineHeight: 16, weight: 600 },
    caption: { size: 11, lineHeight: 15, weight: 400 },
  },
});

/** Cycle-mode accent colors — one per mode token, tuned for the light
 *  canvas (dark enough for 3:1+ on white, still distinct from each other). */
export const MODE_COLORS: Record<string, string> = {
  WASH: "#0E9F8C", // teal — the wash waves
  DRAIN: "#2E90FA", // blue — outflow
  FILL: "#17A673", // green — inflow
  SPIN: "#7C5CE0", // purple — spin
  WAIT: "#F5A524", // amber — settle wait
  STOP: "#E5484D",
  IDLE: "#8AA3B2",
};

export function modeColor(mode: string): string {
  return MODE_COLORS[mode] ?? "#5F7A8C";
}

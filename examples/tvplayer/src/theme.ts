import { defineTheme } from "@tenunjs/widgets";

/**
 * Tenun TV theme — a 10-foot dark palette (TN-196). Design width 960:
 * at 1920x1080 the host scales 2x, so typography runs large by phone
 * standards; readable across a room is the whole point of a TV.
 */
export const tvTheme = defineTheme({
  colors: {
    background: "#101014",
    surface: "#16161D",
    surfaceRaised: "#1C1C26",
    accent: "#00ADB5",
    primaryContainer: "#00ADB5",
    onPrimaryContainer: "#101014",
    secondaryContainer: "#1F2A2C",
    onSecondaryContainer: "#7FD9DD",
    outline: "#2A2A35",
    outlineVariant: "#202028",
    text: "#F2F2F7",
    textDim: "#8E8E99",
    danger: "#E5484D",
    success: "#46A758",
    warning: "#CCA700",
  },
  spacing: { sm: 8, md: 16, lg: 24, xl: 40 },
  typography: {
    display: { size: 64, lineHeight: 72, weight: 700 },
    headline: { size: 40, lineHeight: 48, weight: 700 },
    title: { size: 30, lineHeight: 38, weight: 700 },
    body: { size: 22, lineHeight: 30, weight: 400 },
    label: { size: 24, lineHeight: 32, weight: 600 },
    caption: { size: 18, lineHeight: 24, weight: 400 },
  },
});

/**
 * Group identity colors — the number-tile accent per channel group
 * (the scene contract has no image op in v1, so logos become colored
 * tiles; the group's hue is the identity).
 */
export const GROUP_COLORS: Readonly<Record<string, string>> = {
  TVRI: "#00ADB5",
  Test: "#CCA700",
};

const GROUP_FALLBACK = "#4E5A6C";

export function groupColor(group: string): string {
  return GROUP_COLORS[group] ?? GROUP_FALLBACK;
}

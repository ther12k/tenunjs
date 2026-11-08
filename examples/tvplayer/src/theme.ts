import { defineTheme } from "@tenunjs/widgets";

/**
 * NusaTV theme — a 10-foot dark palette (TN-196). Design width 960:
 * at 1920x1080 the host scales 2x, so typography runs large by phone
 * standards; readable across a room is the whole point of a TV.
 */
export const tvTheme = defineTheme({
  colors: {
    // The IPTV reference palette: near-black canvas, one vivid blue
    // accent, white text on focused (blue) surfaces.
    background: "#0B0B0F",
    surface: "#111116",
    surfaceRaised: "#16161D",
    accent: "#1E6FEB",
    primaryContainer: "#1E6FEB",
    onPrimaryContainer: "#FFFFFF",
    secondaryContainer: "#1A2333",
    onSecondaryContainer: "#8FB8F5",
    outline: "#232330",
    outlineVariant: "#1B1B24",
    text: "#F4F5F7",
    textDim: "#8A8D98",
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
  TVRI: "#1E6FEB",
  Internasional: "#E4572E",
  Sains: "#4D96FF",
  Olahraga: "#6BCB77",
  Test: "#CCA700",
};

const GROUP_FALLBACK = "#4E5A6C";

export function groupColor(group: string): string {
  return GROUP_COLORS[group] ?? GROUP_FALLBACK;
}

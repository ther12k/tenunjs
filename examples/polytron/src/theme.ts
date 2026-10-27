import { defineTheme } from "@tenunjs/widgets";

/**
 * Polytron Wash theme — the v4 LCD designer palette (design/tft-ui-mockup
 * board in the polytronwash repo) with a phone-brighter text ramp:
 * near-black teal background, deep-blue program cards, cyan accent,
 * purple spin, green ok.
 */
export const washerTheme = defineTheme({
  colors: {
    background: "#081110",
    surface: "#0C1720",
    surfaceRaised: "#101C26",
    accent: "#00B7FD", // cAcc — buttons, progress, WASH
    primaryContainer: "#0B2C4A", // deep-blue program cards
    onPrimaryContainer: "#EAF3FC",
    secondaryContainer: "#2A2140", // purple-tinted selected state
    onSecondaryContainer: "#E4D9FF",
    outline: "#33475A", // cBrd
    outlineVariant: "#24333F",
    text: "#EAF3FC",
    textDim: "#9DB2C7",
    danger: "#E8354A",
    success: "#00FF80", // cGood — FILL / ok
    warning: "#FCB518", // cWarn — WAIT
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

/** Cycle-mode accent colors — the LCD's mode language, one per mode token. */
export const MODE_COLORS: Record<string, string> = {
  WASH: "#00B7FD",
  DRAIN: "#00FFC8",
  FILL: "#00FF80",
  SPIN: "#BB86FC",
  WAIT: "#FCB518",
  STOP: "#FF3838",
  IDLE: "#9DB2C7",
};

export function modeColor(mode: string): string {
  return MODE_COLORS[mode] ?? "#EAF3FC";
}

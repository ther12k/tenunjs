import { defineTheme } from "@tenunjs/widgets";

/**
 * TV Remote theme — modern dark cinema aesthetic:
 * Deep obsidian background (#0A0E17), card surfaces (#151D2C),
 * vibrant blue accent (#3B82F6), crisp white text (#F8FAFC),
 * muted slate hints (#64748B), rounded ergonomics.
 */
export const tvRemoteTheme = defineTheme({
  colors: {
    background: "#0A0E17",
    surface: "#151D2C",
    surfaceRaised: "#1F2B3E",
    accent: "#3B82F6",
    primaryContainer: "#1E3A8A",
    onPrimaryContainer: "#EFF6FF",
    secondaryContainer: "#1E293B",
    onSecondaryContainer: "#93C5FD",
    outline: "#334155",
    outlineVariant: "#1E293B",
    text: "#F8FAFC",
    textDim: "#94A3B8",
    danger: "#EF4444",
    success: "#10B981",
    warning: "#F59E0B",
  },
  spacing: { sm: 8, md: 12, lg: 16, xl: 24 },
  typography: {
    display: { size: 36, lineHeight: 44, weight: 700 },
    headline: { size: 28, lineHeight: 36, weight: 700 },
    title: { size: 20, lineHeight: 28, weight: 600 },
    body: { size: 14, lineHeight: 20, weight: 400 },
    label: { size: 15, lineHeight: 20, weight: 600 },
    caption: { size: 12, lineHeight: 16, weight: 400 },
  },
});

export const TV_PALETTE = {
  bg: "#0A0E17",
  card: "#151D2C",
  cardHighlight: "#1F2B3E",
  border: "#334155",
  blue: "#3B82F6",
  blueGlow: "#2563EB",
  emerald: "#10B981",
  red: "#EF4444",
  amber: "#F59E0B",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  dpadBg: "#111827",
  dpadBtn: "#1F2937",
  dpadBtnActive: "#374151",
} as const;

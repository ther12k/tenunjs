import { defineTheme } from "@tenunjs/widgets";

/**
 * Mecha-cockpit dark theme — a launcher is an always-visible surface,
 * so the default is dark with a high-contrast teal accent.
 */
export const appTheme = defineTheme({
  colors: {
    surface: "#0C0E12",
    surfaceRaised: "#161A22",
    text: "#E8EAF0",
    accent: "#39D2C0",
    danger: "#FF5C5C",
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },

  radius: {
    sm: 6,
    md: 10,
    lg: 16,
  },

  typography: {
    body: {
      size: 16,
      lineHeight: 22,
    },
    title: {
      size: 20,
      lineHeight: 26,
      weight: 600,
    },
    display: {
      size: 48,
      lineHeight: 56,
      weight: 700,
    },
  },
});

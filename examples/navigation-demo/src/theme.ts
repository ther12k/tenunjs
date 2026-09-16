import { defineTheme } from "@tenunjs/widgets";

export const appTheme = defineTheme({
  colors: {
    surface: "#FDFBF7",
    surfaceRaised: "#F1EADC",
    text: "#1C1917",
    accent: "#0F766E",
    danger: "#B42318",
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
    md: 12,
    lg: 20,
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
      size: 36,
      lineHeight: 44,
      weight: 700,
    },
  },
});

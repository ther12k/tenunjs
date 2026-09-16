import { defineTheme } from "@tenunjs/widgets";

export const appTheme = defineTheme({
  colors: {
    surface: "#FFFFFF",
    surfaceRaised: "#F5F6F8",
    text: "#16181D",
    accent: "#356AE6",
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

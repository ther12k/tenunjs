import { defineTheme } from "@tenunjs/widgets";

export const appTheme = defineTheme({
  colors: {
    surface: "#FFFFFF",
    surfaceRaised: "#F4F6F5",
    text: "#1A1F1D",
    accent: "#12805C",
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
    lg: 18,
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
      size: 32,
      lineHeight: 40,
      weight: 700,
    },
  },
});

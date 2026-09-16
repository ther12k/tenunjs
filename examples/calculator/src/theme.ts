import { defineTheme } from "@tenunjs/widgets";

export const appTheme = defineTheme({
  colors: {
    surface: "#101418",
    surfaceRaised: "#1B2129",
    text: "#F2F5F7",
    accent: "#4C8DFF",
    danger: "#E5484D",
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },

  radius: {
    sm: 8,
    md: 14,
    lg: 22,
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
      size: 44,
      lineHeight: 52,
      weight: 700,
    },
  },
});

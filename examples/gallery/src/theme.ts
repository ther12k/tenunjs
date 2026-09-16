import { defineTheme } from "@tenunjs/widgets";

// Gallery theme: a dark, high-contrast financial style inspired by the
// Rally reference (M3 design language), tuned to stay legible with the
// current widget surface (text/variant + background tokens only).
export const galleryTheme = defineTheme({
  colors: {
    surface: "#101014",
    surfaceRaised: "#1C1C24",
    text: "#F2F2F7",
    accent: "#4C8DFF",
    danger: "#FF5A5F",
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
      size: 40,
      lineHeight: 48,
      weight: 700,
    },
  },
});

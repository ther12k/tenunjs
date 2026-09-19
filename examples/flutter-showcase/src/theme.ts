import { defineTheme } from "@tenunjs/widgets";

/** Warm, editorial palette for the curated Flutter-inspired showcase. */
export const showcaseTheme = defineTheme({
  colors: {
    surface: "#0E1118",
    surfaceRaised: "#171C27",
    text: "#F5F7FB",
    accent: "#F5A56B",
    danger: "#FF6B7A",
    primaryContainer: "#4B2E28",
    onPrimaryContainer: "#FFDCCB",
    secondaryContainer: "#27394B",
    onSecondaryContainer: "#D8ECFF",
    outline: "#485365",
    outlineVariant: "#29303C",
    success: "#70D6A2",
    warning: "#F5C26B",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 10, md: 16, lg: 24 },
  typography: {
    body: { size: 17, lineHeight: 24 },
    title: { size: 22, lineHeight: 30, weight: 600 },
    display: { size: 44, lineHeight: 52, weight: 700 },
  },
});

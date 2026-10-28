import { defineTheme } from "@tenunjs/widgets";

// Current prototype theme API. TN-068 owns ColorRef widget adoption,
// inherited scopes and runtime theme invalidation; this app does not bypass it.
export const dayPlanTheme = defineTheme({
  colors: {
    surface: "#F6F7FC",
    surfaceRaised: "#FFFFFF",
    text: "#1B243B",
    accent: "#4059B8",
    danger: "#B3261E",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  radius: { sm: 8, md: 12, lg: 20 },
  typography: {
    caption: { size: 12, lineHeight: 18, weight: 500 },
    body: { size: 16, lineHeight: 22 },
    title: { size: 22, lineHeight: 28, weight: 600 },
    display: { size: 36, lineHeight: 44, weight: 700 },
  },
});

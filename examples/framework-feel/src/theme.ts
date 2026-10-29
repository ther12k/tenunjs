import { defineTheme, paletteTheme, type ThemePalette } from "@tenunjs/widgets";

// TN-170: the semantic slot vocabulary owns the literals; paletteTheme
// derives the ordinary-widget role config. The runtime swaps between
// light and dark at runtime (Today's "Toggle theme"); TN-068 retains the
// deeper token work (ColorRef widget adoption, spacing/typography context).

export const dayPlanLight: ThemePalette = {
  background: "#F6F7FC",
  onBackground: "#1B243B",
  primary: "#4059B8",
  onPrimary: "#FFFFFF",
  primaryContainer: "#DDE5FF",
  onPrimaryContainer: "#102050",
  secondaryContainer: "#E0E0E8",
  onSecondaryContainer: "#202030",
  surface: "#F6F7FC",
  surfaceContainer: "#FFFFFF",
  surfaceContainerHigh: "#ECEEF6",
  onSurface: "#1B243B",
  onSurfaceVariant: "#505566",
  outline: "#80859A",
  outlineVariant: "#D0D3E0",
  error: "#B3261E",
  onError: "#FFFFFF",
  success: "#006B40",
  onSuccess: "#FFFFFF",
  warning: "#805000",
  onWarning: "#FFFFFF",
  inverseSurface: "#1B243B",
  onInverseSurface: "#F6F7FC",
  onPrimaryFixed: "#FFFFFF",
};

export const dayPlanDark: ThemePalette = {
  background: "#101014",
  onBackground: "#F2F2F7",
  primary: "#8FB0FF",
  onPrimary: "#102050",
  primaryContainer: "#223354",
  onPrimaryContainer: "#D6E4FF",
  secondaryContainer: "#30354A",
  onSecondaryContainer: "#DCE4FF",
  surface: "#101014",
  surfaceContainer: "#16161D",
  surfaceContainerHigh: "#232330",
  onSurface: "#F2F2F7",
  onSurfaceVariant: "#9AA3B2",
  outline: "#474B5A",
  outlineVariant: "#26262F",
  error: "#FF5A5F",
  onError: "#101014",
  success: "#3DD68C",
  onSuccess: "#101014",
  warning: "#F5A623",
  onWarning: "#101014",
  inverseSurface: "#F2F2F7",
  onInverseSurface: "#101014",
  onPrimaryFixed: "#FFFFFF",
};

export const dayPlanTheme = defineTheme(paletteTheme(dayPlanLight));
export const dayPlanDarkTheme = defineTheme(paletteTheme(dayPlanDark));

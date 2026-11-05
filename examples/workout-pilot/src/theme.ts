import { defineTheme, paletteTheme, type ThemePalette } from "@tenunjs/widgets";

// The pilot follows the TN-170 runtime-owned theme swap: semantic slot
// literals live here; paletteTheme derives ordinary-widget role config.

export const workoutLight: ThemePalette = {
  background: "#F7F8FB",
  onBackground: "#1A2036",
  primary: "#2E62D9",
  onPrimary: "#FFFFFF",
  primaryContainer: "#DCE6FF",
  onPrimaryContainer: "#0C2050",
  secondaryContainer: "#E1E3EC",
  onSecondaryContainer: "#1E2030",
  surface: "#F7F8FB",
  surfaceContainer: "#FFFFFF",
  surfaceContainerHigh: "#EAEDF5",
  onSurface: "#1A2036",
  onSurfaceVariant: "#4E5468",
  outline: "#7E8498",
  outlineVariant: "#CFD3E0",
  error: "#B3261E",
  onError: "#FFFFFF",
  success: "#006B40",
  onSuccess: "#FFFFFF",
  warning: "#805000",
  onWarning: "#FFFFFF",
  inverseSurface: "#1A2036",
  onInverseSurface: "#F7F8FB",
  onPrimaryFixed: "#FFFFFF",
};

export const workoutDark: ThemePalette = {
  background: "#0F1014",
  onBackground: "#F1F2F7",
  primary: "#94B4FF",
  onPrimary: "#0C2050",
  primaryContainer: "#213458",
  onPrimaryContainer: "#D8E4FF",
  secondaryContainer: "#2E3248",
  onSecondaryContainer: "#DCE2FF",
  surface: "#0F1014",
  surfaceContainer: "#15161D",
  surfaceContainerHigh: "#222430",
  onSurface: "#F1F2F7",
  onSurfaceVariant: "#99A1B4",
  outline: "#464B5C",
  outlineVariant: "#26272F",
  error: "#FF5A5F",
  onError: "#0F1014",
  success: "#3DD68C",
  onSuccess: "#0F1014",
  warning: "#F5A623",
  onWarning: "#0F1014",
  inverseSurface: "#F1F2F7",
  onInverseSurface: "#0F1014",
  onPrimaryFixed: "#FFFFFF",
};

export const workoutTheme = defineTheme(paletteTheme(workoutLight));
export const workoutDarkTheme = defineTheme(paletteTheme(workoutDark));

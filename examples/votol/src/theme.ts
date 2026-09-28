import { defineTheme } from "@tenunjs/widgets";

/**
 * VOTOL app theme — mirrors the esp-votol web dashboard's dark palette:
 * amber voltage, blue current, purple RPM, green ok, red fault/siren.
 */
export const votolTheme = defineTheme({
  colors: {
    background: "#0B0E14",
    surface: "#11151F",
    surfaceRaised: "#161B27",
    primary: "#F59E0B",
    onPrimary: "#0B0E14",
    secondary: "#3B82F6",
    danger: "#EF4444",
    outline: "#2A3242",
    text: "#F5F7FB",
    textDim: "#9AA3B2",
    ok: "#10B981",
  },
  spacing: { sm: 8, md: 14, lg: 22 },
  typography: {
    display: { size: 44, weight: "bold", color: "#F5F7FB" },
    headline: { size: 30, weight: "bold", color: "#F5F7FB" },
    title: { size: 20, weight: "bold", color: "#F5F7FB" },
    body: { size: 15, weight: "normal", color: "#D6DCE7" },
    label: { size: 12, weight: "bold", color: "#9AA3B2" },
    caption: { size: 11, weight: "normal", color: "#7A8496" },
  },
});

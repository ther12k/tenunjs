/**
 * TN-143 executable contract reference. This example owns preference policy;
 * the framework owns semantic slot validation and scene baking. No host API
 * or storage implementation is constructed at bundle-evaluation time.
 */
import type { CapabilityFailure, StorageCapability } from "@tenunjs/platform";
import {
  bakeThemeScene,
  colorSlot,
  defineColorPalette,
  type DisplayListScene,
  type SemanticDisplayListScene,
  type ThemePalette,
} from "@tenunjs/widgets";

export type ThemeMode = "light" | "dark";
export type ThemePreferenceStorage = Pick<StorageCapability, "get" | "set">;
export const THEME_PREFERENCE_KEY = "tenun.theme-contract.mode.v1";

export const LIGHT_PALETTE = defineColorPalette({
  background: "#F7F8FC",
  onBackground: "#171B2B",
  primary: "#4059B8",
  onPrimary: "#FFFFFF",
  primaryContainer: "#DDE3FF",
  onPrimaryContainer: "#14245F",
  secondaryContainer: "#E4E5F0",
  onSecondaryContainer: "#292C43",
  surface: "#FFFFFF",
  surfaceContainer: "#ECEEF6",
  surfaceContainerHigh: "#E3E6F1",
  onSurface: "#1B1E2C",
  onSurfaceVariant: "#51566A",
  outline: "#747A91",
  outlineVariant: "#C5CADB",
  error: "#B3261E",
  onError: "#FFFFFF",
  success: "#236B3E",
  onSuccess: "#FFFFFF",
  warning: "#805600",
  onWarning: "#FFFFFF",
  inverseSurface: "#2D3040",
  onInverseSurface: "#F0F1FB",
  onPrimaryFixed: "#15234F",
  "app.brand": "#305D7B",
});

export const DARK_PALETTE = defineColorPalette({
  background: "#10131D",
  onBackground: "#E4E7F5",
  primary: "#BAC7FF",
  onPrimary: "#1E2F70",
  primaryContainer: "#34468E",
  onPrimaryContainer: "#DEE4FF",
  secondaryContainer: "#40445E",
  onSecondaryContainer: "#E4E6FF",
  surface: "#191D2A",
  surfaceContainer: "#222737",
  surfaceContainerHigh: "#2E3447",
  onSurface: "#E3E7F5",
  onSurfaceVariant: "#BBC2D8",
  outline: "#8C95AE",
  outlineVariant: "#454D63",
  error: "#FFB4AB",
  onError: "#690005",
  success: "#9FD8B0",
  onSuccess: "#073B20",
  warning: "#F2C66D",
  onWarning: "#442D00",
  inverseSurface: "#E0E4F3",
  onInverseSurface: "#292E40",
  onPrimaryFixed: "#E3E8FF",
  "app.brand": "#A4D0EF",
});

const palettes: Readonly<Record<ThemeMode, ThemePalette>> = Object.freeze({
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
});

// One authoritative semantic source. Both themes bake this exact scene; no
// screen or operation is edited when the preference changes. Pixel literals
// live only in the palettes above, including the application extension slot.
const source = {
  tenun: "semantic-display-list",
  version: 1,
  designWidth: 360,
  contentHeight: 420,
  background: colorSlot("background"),
  ops: [
    { op: "rect", x: 20, y: 24, w: 320, h: 248, r: 16, color: colorSlot("surface") },
    { op: "outline", x: 20, y: 24, w: 320, h: 248, r: 16, width: 1, color: colorSlot("outline") },
    { op: "text", x: 40, y: 66, text: "One screen, two themes", size: 20, weight: 600, color: colorSlot("onSurface") },
    { op: "text", x: 40, y: 104, text: "Colors follow semantic slots.", size: 15, weight: 400, color: colorSlot("onSurfaceVariant") },
    { op: "circle", cx: 54, cy: 146, r: 10, color: colorSlot("app.brand") },
    { op: "rect", x: 40, y: 182, w: 280, h: 56, r: 28, color: colorSlot("primary") },
    { op: "text", x: 100, y: 216, text: "Change theme", size: 17, weight: 600, color: colorSlot("onPrimary") },
  ],
  taps: [
    { x: 40, y: 182, w: 280, h: 56, action: "tap", payload: { id: 0 } },
  ],
} satisfies SemanticDisplayListScene;

export const THEME_REFERENCE_SCENE: SemanticDisplayListScene = Object.freeze({
  ...source,
  ops: Object.freeze(source.ops.map((op) => Object.freeze(op))),
  taps: Object.freeze(source.taps.map((tap) => Object.freeze({
    ...tap,
    payload: Object.freeze(tap.payload),
  }))),
});

export type ThemePreferenceErrorCode =
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "INVALID_STORED_PREFERENCE"
  | "INVALID_PREFERENCE"
  | "SWITCH_BUSY";

export class ThemePreferenceError extends Error {
  constructor(
    readonly code: ThemePreferenceErrorCode,
    message: string,
    readonly failure?: CapabilityFailure,
  ) {
    super(`[TENUN_THEME_EXAMPLE] ${message}`);
    this.name = "ThemePreferenceError";
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}

/**
 * Example-owned policy: initialize before rendering; serialize changes by
 * explicitly refusing a second in-flight switch. Persist first, then publish
 * the new mode/scene. A failed write never appears as a persisted update.
 */
export class ThemeContractExample {
  private switching = false;

  private constructor(
    private readonly storage: ThemePreferenceStorage,
    private modeValue: ThemeMode,
  ) {}

  static async open(storage: ThemePreferenceStorage): Promise<ThemeContractExample> {
    const stored = await storage.get(THEME_PREFERENCE_KEY);
    if (!stored.ok) {
      throw new ThemePreferenceError(
        "STORAGE_READ_FAILED",
        "Cannot initialize the theme preference from host storage",
        stored.failure,
      );
    }
    if (stored.value !== null && !isThemeMode(stored.value)) {
      throw new ThemePreferenceError(
        "INVALID_STORED_PREFERENCE",
        "Stored theme preference must be light or dark",
      );
    }
    return new ThemeContractExample(storage, stored.value ?? "light");
  }

  get mode(): ThemeMode {
    return this.modeValue;
  }

  /** Returns a new host scene; consumer mutation cannot change its source. */
  render(): DisplayListScene {
    return bakeThemeScene(THEME_REFERENCE_SCENE, palettes[this.modeValue]);
  }

  async setMode(mode: ThemeMode): Promise<DisplayListScene> {
    if (!isThemeMode(mode)) {
      throw new ThemePreferenceError("INVALID_PREFERENCE", "Theme preference must be light or dark");
    }
    if (this.switching) {
      throw new ThemePreferenceError("SWITCH_BUSY", "A theme preference write is already in flight");
    }
    this.switching = true;
    try {
      // Validate and bake before touching storage. The complete scene remains
      // private until persistence succeeds; no partial update is published.
      const next = bakeThemeScene(THEME_REFERENCE_SCENE, palettes[mode]);
      const saved = await this.storage.set(THEME_PREFERENCE_KEY, mode);
      if (!saved.ok) {
        throw new ThemePreferenceError(
          "STORAGE_WRITE_FAILED",
          "Theme preference was not persisted; the previous theme is unchanged",
          saved.failure,
        );
      }
      this.modeValue = mode;
      return next;
    } finally {
      this.switching = false;
    }
  }
}

/**
 * TN-143 opt-in reference contract. Semantic scenes stay in the framework;
 * baking produces the existing concrete-color v1 host scene. This does not
 * change layoutScreen or implement TN-068's inherited widget context.
 */
import type { DisplayListScene, DisplayOp, SerializedTap } from "./display-list";
import { LayoutError, validateTextClip } from "./display-list";
import { TextInputError, validateTextInputOp } from "./text-input";

export const SEMANTIC_COLOR_SLOTS = Object.freeze([
  "background", "onBackground", "primary", "onPrimary",
  "primaryContainer", "onPrimaryContainer", "secondaryContainer",
  "onSecondaryContainer", "surface", "surfaceContainer",
  "surfaceContainerHigh", "onSurface", "onSurfaceVariant", "outline",
  "outlineVariant", "error", "onError", "success", "onSuccess", "warning",
  "onWarning", "inverseSurface", "onInverseSurface", "onPrimaryFixed",
] as const);

export type SemanticColorSlot = (typeof SEMANTIC_COLOR_SLOTS)[number];
export type ColorSlot = SemanticColorSlot | `app.${string}`;
export interface ColorRef { readonly slot: ColorSlot }
export type ThemePalette = Readonly<
  Record<SemanticColorSlot, string> & Partial<Record<`app.${string}`, string>>
>;

export type ThemeContractErrorCode =
  | "INVALID_SLOT" | "INVALID_COLOR" | "MISSING_SLOT"
  | "INVALID_COLOR_REF" | "INVALID_PALETTE" | "INVALID_SCENE";

export class ThemeContractError extends Error {
  constructor(readonly code: ThemeContractErrorCode, message: string) {
    super(`[TENUN_THEME_CONTRACT] ${message}`);
    this.name = "ThemeContractError";
  }
}

const slots: ReadonlySet<string> = new Set(SEMANTIC_COLOR_SLOTS);
const own = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isSlot(value: unknown): value is ColorSlot {
  return typeof value === "string" &&
    (slots.has(value) || /^app\.[A-Za-z][A-Za-z0-9_]*$/.test(value));
}

/** Canonical names only: legacy aliases are not silently normalized. */
export function colorSlot(name: ColorSlot): ColorRef {
  if (!isSlot(name)) {
    throw new ThemeContractError("INVALID_SLOT", `Unknown color slot: ${String(name)}`);
  }
  return Object.freeze({ slot: name });
}

/**
 * TN-170: derives a complete ordinary-widget theme config from a
 * semantic palette, so a TN-143 slot vocabulary drives every role the
 * kit's widgets consume — including the roles resolveRoles only honors
 * when declared (surfaceContainer, surfaceContainerHigh, onSurfaceVariant,
 * inverseSurface, onInverseSurface, onPrimaryFixed). Validation rides
 * defineColorPalette; the returned config is what ApplicationRuntime's
 * constructor and setTheme accept.
 */
export function paletteTheme(palette: ThemePalette): { colors: Record<string, string> } {
  const p = defineColorPalette(palette);
  return {
    colors: {
      surface: p.surface,
      surfaceRaised: p.surfaceContainer,
      text: p.onSurface,
      accent: p.primary,
      danger: p.error,
      success: p.success,
      warning: p.warning,
      outline: p.outline,
      outlineVariant: p.outlineVariant,
      primaryContainer: p.primaryContainer,
      onPrimaryContainer: p.onPrimaryContainer,
      onPrimary: p.onPrimary,
      secondaryContainer: p.secondaryContainer,
      onSecondaryContainer: p.onSecondaryContainer,
      surfaceContainer: p.surfaceContainer,
      surfaceContainerHigh: p.surfaceContainerHigh,
      onSurfaceVariant: p.onSurfaceVariant,
      inverseSurface: p.inverseSurface,
      onInverseSurface: p.onInverseSurface,
      onPrimaryFixed: p.onPrimaryFixed,
    },
  };
}

/**
 * A complete palette owns all literals. Eight-digit colors use Android's
 * #AARRGGBB order, not CSS #RRGGBBAA. Copy first to retain one value snapshot.
 */
export function defineColorPalette<T extends ThemePalette>(palette: T): Readonly<T> {
  if (!isRecord(palette) || Object.getOwnPropertySymbols(palette).length > 0) {
    throw new ThemeContractError("INVALID_PALETTE", "A palette must be a string-keyed object");
  }
  const copy = { ...palette };
  for (const slot of SEMANTIC_COLOR_SLOTS) {
    if (!own(copy, slot)) {
      throw new ThemeContractError("MISSING_SLOT", `Palette is missing ${slot}`);
    }
  }
  for (const [name, color] of Object.entries(copy)) {
    if (!isSlot(name)) {
      throw new ThemeContractError("INVALID_SLOT", `Unknown palette slot: ${name}`);
    }
    if (typeof color !== "string" || !/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
      throw new ThemeContractError("INVALID_COLOR", `Invalid color for ${name}; expected #RRGGBB or #AARRGGBB`);
    }
  }
  return Object.freeze(copy);
}

type ColorField = "color" | "colorTo" | "track";
type NonColorField = "op" | "x" | "y" | "w" | "h" | "r" | "shadow" |
  "width" | "text" | "size" | "weight" | "align" | "cx" | "cy" | "progress" |
  "x1" | "y1" | "x2" | "y2" | "fixed" | "anchor" | "anchorSize" |
  "id" | "selection" | "composing" | "focused" | "sessionId" | "revision" |
  "keyboardType" | "returnAction" | "readOnly" | "label" | "clip" |
  "contentHeight" | "ops";
type AllKeys<T> = T extends unknown ? keyof T : never;
type AssertNever<T extends never> = T;
// Every new host field must be classified so color literals cannot slip through.
type UnclassifiedFields = AssertNever<Exclude<AllKeys<DisplayOp>, ColorField | NonColorField>>;

/** Distributes over each operation so its geometry and optional fields survive. */
type SemanticOp<T> = T extends DisplayOp ? {
  readonly [K in keyof T]: K extends ColorField ? ColorRef : T[K];
} : never;
export type SemanticDisplayOp = SemanticOp<DisplayOp>;

/** Framework-only root scope; never send this marker to a native host. */
export interface SemanticDisplayListScene {
  readonly tenun: "semantic-display-list";
  readonly version: 1;
  readonly designWidth: number;
  readonly contentHeight: number;
  readonly background: ColorRef;
  readonly ops: readonly SemanticDisplayOp[];
  readonly taps: readonly Readonly<SerializedTap>[];
}

function resolve(ref: ColorRef, palette: ThemePalette, field: string): string {
  if (!isRecord(ref) || !own(ref, "slot") || Object.keys(ref).length !== 1 ||
      Object.getOwnPropertySymbols(ref).length !== 0) {
    throw new ThemeContractError("INVALID_COLOR_REF", `${field} must be a { slot } reference`);
  }
  if (!isSlot(ref.slot)) {
    throw new ThemeContractError("INVALID_SLOT", `Unknown slot in ${field}: ${String(ref.slot)}`);
  }
  const color = own(palette, ref.slot) ? palette[ref.slot] : undefined;
  if (color === undefined) {
    throw new ThemeContractError("MISSING_SLOT", `Palette is missing ${ref.slot} used by ${field}`);
  }
  return color;
}

// A new operation kind needs an explicit bake path; unchecked inputs still fail.
function unknownOperation(_op: never, at: number | string): never {
  throw new ThemeContractError("INVALID_SCENE", `Unknown operation at ${at}`);
}

function bakeOp(op: SemanticDisplayOp, palette: ThemePalette, at: number | string): DisplayOp {
  const where = typeof at === "number" ? `ops[${at}]` : at;
  if (!isRecord(op)) {
    throw new ThemeContractError("INVALID_SCENE", `Invalid operation at ${where}`);
  }
  switch (op.op) {
    case "text-input":
      try {
        return validateTextInputOp(op);
      } catch (error) {
        if (error instanceof TextInputError) {
          throw new ThemeContractError("INVALID_SCENE", `${where}: ${error.message}`);
        }
        throw error;
      }
    case "gradient":
      return { ...op, color: resolve(op.color, palette, `${where}.color`),
        colorTo: resolve(op.colorTo, palette, `${where}.colorTo`) };
    case "ring": {
      const { track, ...rest } = op;
      const result = { ...rest, color: resolve(op.color, palette, `${where}.color`) };
      return track === undefined ? result :
        { ...result, track: resolve(track, palette, `${where}.track`) };
    }
    case "text": {
      const color = resolve(op.color, palette, `${where}.color`);
      if (op.clip === undefined) return { ...op, color };
      try {
        return { ...op, color, clip: validateTextClip(op.clip) };
      } catch (error) {
        if (error instanceof LayoutError) throw new ThemeContractError("INVALID_SCENE", `${where}.clip: ${error.message}`);
        throw error;
      }
    }
    case "rect": case "outline": case "circle": case "line":
      return { ...op, color: resolve(op.color, palette, `${where}.color`) };
    case "scroll-region": {
      // A colorless container: only its children carry color references, and
      // they bake recursively with the region's id as the diagnostic prefix.
      // (The mapped semantic type does not recurse, so nested ops arrive
      // typed as their semantic shapes by construction.) TN-168: a non-array
      // ops field is a typed contract error (was a bare TypeError from
      // null.map), and children are traversed so sparse-array HOLES reach
      // bakeOp's isRecord check — Array.prototype.map skips holes, which
      // silently passed them into the baked scene.
      if (!Array.isArray(op.ops)) {
        throw new ThemeContractError("INVALID_SCENE",
          `${where}.scroll-region[${op.id}].ops is not an array`);
      }
      const baked = new Array<DisplayOp>(op.ops.length);
      for (let child = 0; child < op.ops.length; child++) {
        baked[child] = bakeOp(op.ops[child] as SemanticDisplayOp, palette,
          `${where}.scroll-region[${op.id}][${child}]`);
      }
      return { ...op, ops: baked };
    }
    default:
      return unknownOperation(op, where);
  }
}

/**
 * Resolves a fresh complete host scene, or throws without changing the source
 * or a previously committed scene. Geometry/taps remain the existing v1
 * contract; this layer validates the theme boundary and scene discriminants.
 */
export function bakeThemeScene(source: SemanticDisplayListScene, palette: ThemePalette): DisplayListScene {
  if (!isRecord(source) || source.tenun !== "semantic-display-list" || source.version !== 1 ||
      !Array.isArray(source.ops) || !Array.isArray(source.taps)) {
    throw new ThemeContractError("INVALID_SCENE", "Expected a semantic-display-list v1 scene");
  }
  const snapshot = defineColorPalette(palette);
  const background = resolve(source.background, snapshot, "background");
  const ops = Array.from(source.ops, (op: SemanticDisplayOp, index: number) => bakeOp(op, snapshot, index));
  const taps = Array.from(source.taps, (tap: Readonly<SerializedTap>, index: number) => {
    if (!isRecord(tap) || !isRecord(tap.payload)) {
      throw new ThemeContractError("INVALID_SCENE", `Invalid tap at ${index}`);
    }
    return { ...tap, payload: { ...tap.payload } };
  });
  return { tenun: "display-list", version: 1, designWidth: source.designWidth,
    contentHeight: source.contentHeight, background, ops, taps };
}

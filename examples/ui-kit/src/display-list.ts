/**
 * Compatibility re-export: the display-list scene model and layoutScreen
 * lowering moved to @tenunjs/widgets (TN-133 extraction, behavior-
 * preserving — the module was moved verbatim with import paths rewired
 * and the SchemeRoles type inlined field-for-field). This shim keeps
 * every existing examples/ import path working. SchemeRoles itself stays
 * exported from ./scheme (example-side) to avoid ambiguity; the seed
 * generator (colorSchemeFromSeed) never moved.
 */
export {
  Canvas,
  ThemeScope,
  ThemeScopeBox,
  layoutScreen,
  resolveRoles,
  textWidth,
  wrapText,
} from "@tenunjs/widgets";
export type {
  CanvasProps,
  DisplayListScene,
  DisplayOp,
  FixedAnchor,
  FixedPosition,
  GradientOp,
  LineOp,
  OutlineOp,
  RectOp,
  RenderContext,
  RingOp,
  SerializedTap,
  TextOp,
  CircleOp,
  ThemeScopeProps,
} from "@tenunjs/widgets";

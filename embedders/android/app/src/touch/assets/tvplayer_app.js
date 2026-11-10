globalThis.__TVPLAYER_FORM__="phone";
(function(){
// packages/protocol/src/index.ts
var MutationOpCode = {
  BEGIN_TRANSACTION: "begin_transaction",
  CREATE_NODE: "create_node",
  SET_PROPS: "set_props",
  SET_TEXT: "set_text",
  INSERT_CHILD: "insert_child",
  MOVE_CHILD: "move_child",
  REMOVE_CHILD: "remove_child",
  DESTROY_NODE: "destroy_node",
  COMMIT_TRANSACTION: "commit_transaction"
};
var HostWidgetKind = {
  ROOT: "root",
  COLUMN: "column",
  ROW: "row",
  TEXT: "text",
  BUTTON: "button",
  INPUT: "input",
  LIST_ITEM: "list-item",
  SCROLL_VIEW: "scroll-view",
  CARD: "card",
  SCAFFOLD: "scaffold",
  APP_BAR: "app-bar",
  SPACER: "spacer"
};
var OPCODES = new Set(Object.values(MutationOpCode));
var WIDGET_KINDS = new Set(Object.values(HostWidgetKind));
function isValidWidgetKind(kind) {
  return WIDGET_KINDS.has(kind);
}

// packages/jsx-runtime/src/prop-codecs.ts
var PROP_SCHEMAS = {
  text: {
    variant: { type: "string" },
    color: { type: ["string", "object"] },
    semanticsId: { type: "string" },
    maxLines: { type: "number" },
    ellipsis: { type: "boolean" }
  },
  button: { variant: { type: "string" }, onPress: { type: "function" }, semanticsId: { type: "string" } },
  column: {
    padding: { type: ["string", "number"] },
    gap: { type: ["string", "number"] },
    align: { type: "string" },
    justify: { type: "string" }
  },
  row: {
    padding: { type: ["string", "number"] },
    gap: { type: ["string", "number"] },
    align: { type: "string" },
    justify: { type: "string" }
  },
  card: {
    padding: { type: ["string", "number"] },
    radius: { type: ["string", "number"] },
    background: { type: ["string", "object"] },
    elevation: { type: "boolean" },
    semantics: { type: "object" }
  },
  "app-bar": { title: { type: "string", required: true }, onMenu: { type: "function" }, semanticsId: { type: "string" } },
  input: {
    field: { type: "string" },
    value: { type: "string" },
    placeholder: { type: "string" }
  },
  "list-item": { title: { type: "string" }, details: { type: "string" } }
};

class JsxPropValidationError extends Error {
  kind;
  prop;
  constructor(kind, prop, reason) {
    super(`[TENUN_PROP_INVALID] ${kind}.${prop}: ${reason}`);
    this.name = "JsxPropValidationError";
    this.kind = kind;
    this.prop = prop;
  }
}
function describe(value) {
  if (value === null)
    return "null";
  if (Array.isArray(value))
    return "array";
  return typeof value;
}
function validateProps(kind, props) {
  const schema = PROP_SCHEMAS[kind];
  if (!schema)
    return;
  for (const [prop, rule] of Object.entries(schema)) {
    const value = props[prop];
    if (value === undefined || value === null) {
      if (rule.required) {
        throw new JsxPropValidationError(kind, prop, "required prop is missing");
      }
      continue;
    }
    const accepted = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!accepted.includes(typeof value)) {
      throw new JsxPropValidationError(kind, prop, `expected ${accepted.join(" | ")}, got ${describe(value)}`);
    }
  }
  for (const prop of Object.keys(props)) {
    if (!(prop in schema)) {
      throw new JsxPropValidationError(kind, prop, "unknown prop for this widget kind");
    }
  }
}

// packages/jsx-runtime/src/jsx-runtime.ts
var Fragment = Symbol.for("tenun.fragment");

class JsxValidationError extends Error {
  constructor(message) {
    super(`[TENUN_JSX_ERROR] ${message}`);
    this.name = "JsxValidationError";
  }
}
function extractKey(explicit, props) {
  const raw = explicit !== undefined ? explicit : props.key;
  delete props.key;
  if (raw === undefined || raw === null)
    return null;
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new JsxValidationError(`Invalid key: must be string or number (no coercion), got ${typeof raw}`);
  }
  return raw;
}
function buildNode(type, props, key) {
  if (type === Fragment) {
    const fragmentProps = props ? { ...props } : {};
    const rawProps2 = fragmentProps;
    const children2 = rawProps2.children;
    delete rawProps2.children;
    const fragmentKey = extractKey(key, rawProps2);
    return {
      kind: Fragment,
      key: fragmentKey,
      props: fragmentProps,
      children: normalizeChildren(children2)
    };
  }
  if (typeof type !== "function" && typeof type !== "string") {
    throw new JsxValidationError(`Invalid widget kind: expected function component or HostWidgetKind, got ${typeof type}`);
  }
  if (typeof type === "string" && !isValidWidgetKind(type)) {
    throw new JsxValidationError(`Invalid host widget kind: "${type}" is not a known HostWidgetKind`);
  }
  const rawProps = props ? { ...props } : {};
  const record = rawProps;
  const childrenProp = record.children;
  delete record.children;
  const explicitKey = extractKey(key, record);
  const children = normalizeChildren(childrenProp);
  if (typeof type === "string") {
    validateProps(type, rawProps);
  }
  return {
    kind: type,
    key: explicitKey,
    props: Object.freeze(rawProps),
    children
  };
}
function jsx(type, props, key) {
  return buildNode(type, props, key);
}
function normalizeChildren(children) {
  if (children === undefined || children === null || typeof children === "boolean") {
    return [];
  }
  if (Array.isArray(children)) {
    const result = [];
    for (const child of children) {
      if (child !== null && child !== undefined && typeof child !== "boolean") {
        if (Array.isArray(child)) {
          result.push(...normalizeChildren(child));
        } else {
          result.push(child);
        }
      }
    }
    return Object.freeze(result);
  }
  return Object.freeze([children]);
}
// packages/jsx-runtime/src/jsx-dev-runtime.ts
function jsxDEV(type, props, key, isStaticChildren, source, self) {
  const node = buildNode(type, props, key);
  if (source && typeof source === "object") {
    const location = {
      fileName: String(source.fileName),
      lineNumber: Number(source.lineNumber),
      columnNumber: Number(source.columnNumber)
    };
    return { ...node, source: location };
  }
  return node;
}
// packages/widgets/src/structural.ts
function virtual(kind, props) {
  return {
    kind,
    key: null,
    props,
    children: childrenOf(props)
  };
}
function flatten(into, child) {
  if (child === null || child === undefined || typeof child === "boolean")
    return;
  if (Array.isArray(child)) {
    for (const item of child)
      flatten(into, item);
    return;
  }
  into.push(child);
}
function childrenOf(props) {
  const kids = [];
  flatten(kids, props.child);
  flatten(kids, props.children);
  return Object.freeze(kids);
}
var SizedBoxKind = Symbol.for("tenun.widgets.sized-box");
function SizedBox(props) {
  return virtual(SizedBoxKind, props);
}
var CenterKind = Symbol.for("tenun.widgets.center");
var StackKind = Symbol.for("tenun.widgets.stack");
function Stack(props) {
  return virtual(StackKind, props);
}
var PositionedKind = Symbol.for("tenun.widgets.positioned");
function Positioned(props) {
  return virtual(PositionedKind, props);
}
var ExpandedKind = Symbol.for("tenun.widgets.expanded");
function Expanded(props) {
  return virtual(ExpandedKind, props);
}
var GestureDetectorKind = Symbol.for("tenun.widgets.gesture-detector");
function GestureDetector(props) {
  return virtual(GestureDetectorKind, props);
}
var ContainerKind = Symbol.for("tenun.widgets.container");
function Container(props) {
  return virtual(ContainerKind, props);
}
var IconKind = Symbol.for("tenun.widgets.icon");
var WrapKind = Symbol.for("tenun.widgets.wrap");

// packages/widgets/src/text-input.ts
class TextInputError extends Error {
  code;
  constructor(code, message) {
    super(`[TENUN_TEXT_INPUT] ${code}: ${message}`);
    this.code = code;
    this.name = "TextInputError";
  }
}
var TextFieldKind = Symbol.for("tenun.widgets.text-field");
var NUMERIC_DRAFT_PATTERNS = {
  number: /^-?[0-9]*$/,
  decimal: /^-?[0-9]*([.,][0-9]*)?$/
};
function numericDraftError(keyboardType, text) {
  if (keyboardType === "text")
    return null;
  return NUMERIC_DRAFT_PATTERNS[keyboardType].test(text) ? null : `numeric "${keyboardType}" draft ${JSON.stringify(text)} is not admissible`;
}
var record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function fail(code, message) {
  throw new TextInputError(code, message);
}
function identifier(value, code) {
  if (typeof value !== "string" || value.trim().length === 0)
    fail(code, "id must be a nonempty string");
  return value;
}
function integer(value, minimum, code, name) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    fail(code, `${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}
function resolveTextFieldProps(value) {
  if (!record(value))
    fail("INVALID_TEXT_FIELD", "TextField props must be an object");
  const {
    id,
    value: text,
    onChanged,
    label = "",
    placeholder = "",
    readOnly = false,
    onSubmitted,
    keyboardType = "text",
    inputAction = "done"
  } = value;
  const fieldId = identifier(id, "INVALID_TEXT_FIELD");
  if (typeof text !== "string" || typeof label !== "string" || typeof placeholder !== "string" || typeof readOnly !== "boolean" || typeof onChanged !== "function" || onSubmitted !== undefined && typeof onSubmitted !== "function") {
    fail("INVALID_TEXT_FIELD", "TextField requires string value/labels, boolean readOnly, and typed callbacks");
  }
  if (/[\r\n]/.test(text))
    fail("INVALID_TEXT_FIELD", "Single-line TextField value must not contain CR or LF");
  if (keyboardType !== "text" && keyboardType !== "number" && keyboardType !== "decimal") {
    fail("INVALID_TEXT_FIELD", 'keyboardType must be "text", "number", or "decimal"');
  }
  if (inputAction !== "done" && inputAction !== "next") {
    fail("INVALID_TEXT_FIELD", 'inputAction must be "done" or "next"');
  }
  const contentError = numericDraftError(keyboardType, text);
  if (contentError !== null)
    fail("INVALID_TEXT_CONTENT", contentError);
  return Object.freeze({
    id: fieldId,
    value: text,
    label,
    placeholder,
    readOnly,
    keyboardType,
    inputAction,
    onChanged,
    ...onSubmitted === undefined ? {} : { onSubmitted }
  });
}
function TextField(props) {
  return { kind: TextFieldKind, key: null, props: resolveTextFieldProps(props), children: [] };
}
function editingValue(value, code) {
  const { text, selection, composing } = value;
  if (typeof text !== "string" || !record(selection))
    fail(code, "text and selection are required");
  if (/[\r\n]/.test(text))
    fail(code, "Single-line text input must not contain CR or LF");
  const base = integer(selection.base, 0, code, "selection.base");
  const extent = integer(selection.extent, 0, code, "selection.extent");
  if (base > text.length || extent > text.length)
    fail(code, "selection is outside the UTF-16 text range");
  let range = null;
  if (composing !== null) {
    if (!record(composing))
      fail(code, "composing must be null or an ordered nonempty range");
    const start = integer(composing.start, 0, code, "composing.start");
    const end = integer(composing.end, 0, code, "composing.end");
    if (start >= end || end > text.length)
      fail(code, "composing is outside the UTF-16 text range or empty");
    range = Object.freeze({ start, end });
  }
  return Object.freeze({ text, selection: Object.freeze({ base, extent }), composing: range });
}
function validateTextInputIdentity(value) {
  if (!record(value))
    fail("INVALID_TEXT_EDIT", "text input event must be an object");
  const { id, sessionId, baseRevision } = value;
  return Object.freeze({
    id: identifier(id, "INVALID_TEXT_EDIT"),
    sessionId: integer(sessionId, 1, "INVALID_TEXT_EDIT", "sessionId"),
    baseRevision: integer(baseRevision, 0, "INVALID_TEXT_EDIT", "baseRevision")
  });
}
function validateTextEditEvent(value) {
  if (!record(value))
    fail("INVALID_TEXT_EDIT", "text edit event must be an object");
  const copy = { ...value };
  return Object.freeze({ ...validateTextInputIdentity(copy), ...editingValue(copy, "INVALID_TEXT_EDIT") });
}
function validateTextInputOp(value) {
  const code = "INVALID_TEXT_INPUT";
  if (!record(value))
    fail(code, "text-input descriptor must be an object");
  const copy = { ...value };
  const {
    op,
    id,
    x,
    y,
    w,
    h,
    focused,
    sessionId,
    revision,
    keyboardType,
    returnAction,
    readOnly,
    label,
    fixed,
    anchor,
    anchorSize
  } = copy;
  if (op !== "text-input" || typeof focused !== "boolean" || typeof readOnly !== "boolean" || typeof label !== "string" || keyboardType !== "text" && keyboardType !== "number" && keyboardType !== "decimal" || returnAction !== "done" && returnAction !== "next") {
    fail(code, "invalid text-input descriptor flags, label, or keyboard intent");
  }
  for (const [name, dimension] of Object.entries({ x, y, w, h })) {
    if (typeof dimension !== "number" || !Number.isFinite(dimension) || (name === "w" || name === "h") && dimension < 0)
      fail(code, `${name} must be valid finite geometry`);
  }
  const sid = integer(sessionId, 0, code, "sessionId");
  const rev = integer(revision, 0, code, "revision");
  const state = editingValue(copy, code);
  const contentError = numericDraftError(keyboardType, state.text);
  if (contentError !== null)
    fail("INVALID_TEXT_CONTENT", contentError);
  if (focused && (sid === 0 || readOnly) || !focused && (sid !== 0 || rev !== 0 || state.composing !== null)) {
    fail(code, "focus, session, revision, readOnly and composition disagree");
  }
  if (fixed !== undefined && typeof fixed !== "boolean" || anchor !== undefined && anchor !== "bottom" && anchor !== "center" || anchorSize !== undefined && (typeof anchorSize !== "number" || !Number.isFinite(anchorSize) || anchorSize < 0)) {
    fail(code, "invalid fixed-position metadata");
  }
  return Object.freeze({
    op,
    id: identifier(id, code),
    x,
    y,
    w,
    h,
    ...state,
    focused,
    sessionId: sid,
    revision: rev,
    keyboardType,
    returnAction,
    readOnly,
    label,
    ...fixed === undefined ? {} : { fixed },
    ...anchor === undefined ? {} : { anchor },
    ...anchorSize === undefined ? {} : { anchorSize }
  });
}
function nextTextRevision(revision) {
  return integer(revision + 1, 0, "INVALID_TEXT_EDIT", "next revision");
}
function textInputDescriptor(props, frame, active) {
  const focused = !props.readOnly && active?.id === props.id;
  const echoed = focused && active.text === props.value;
  return validateTextInputOp({
    op: "text-input",
    ...frame,
    id: props.id,
    text: props.value,
    selection: echoed ? active.selection : { base: props.value.length, extent: props.value.length },
    composing: echoed ? active.composing : null,
    focused,
    sessionId: focused ? active.sessionId : 0,
    revision: focused ? echoed ? active.revision : nextTextRevision(active.revision) : 0,
    keyboardType: props.keyboardType,
    returnAction: props.inputAction,
    readOnly: props.readOnly,
    label: props.label
  });
}

// packages/widgets/src/display-list.ts
function validateLocale(value, where = "locale") {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LayoutError("INVALID_THEME_TOKEN", `${where} must be a non-empty string`);
  }
  return value.trim();
}
function validateTextScale(value, where = "textScale") {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new LayoutError("INVALID_THEME_TOKEN", `${where} must be a positive finite number`);
  }
  return value;
}
function validatePlatform(value, where = "platform") {
  if (value !== "android" && value !== "ios" && value !== "web") {
    throw new LayoutError("INVALID_THEME_TOKEN", `${where} must be "android", "ios", or "web"`);
  }
  return value;
}
var SEMANTIC_SLOT_NAMES = new Set([
  "background",
  "onBackground",
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondaryContainer",
  "onSecondaryContainer",
  "surface",
  "surfaceContainer",
  "surfaceContainerHigh",
  "onSurface",
  "onSurfaceVariant",
  "outline",
  "outlineVariant",
  "error",
  "onError",
  "success",
  "onSuccess",
  "warning",
  "onWarning",
  "inverseSurface",
  "onInverseSurface",
  "onPrimaryFixed"
]);
var APP_SLOT_PATTERN = /^app\.[A-Za-z][A-Za-z0-9_]*$/;
function isColorRefValue(value) {
  return typeof value === "object" && value !== null && typeof value.slot === "string" && (SEMANTIC_SLOT_NAMES.has(value.slot) || APP_SLOT_PATTERN.test(value.slot));
}

class LayoutError extends Error {
  code;
  constructor(code, message) {
    super(`[TENUN_LAYOUT_ERROR] ${message}`);
    this.code = code;
    this.name = "LayoutError";
  }
}
function validateLayoutViewport(viewport) {
  if (!viewport || typeof viewport !== "object") {
    throw new LayoutError("INVALID_VIEWPORT", "Viewport width and height must be positive finite numbers");
  }
  const width = viewport.width;
  const height = viewport.height;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new LayoutError("INVALID_VIEWPORT", "Viewport width and height must be positive finite numbers");
  }
  return Object.freeze({ width, height });
}
function validateTextClip(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LayoutError("INVALID_CONSTRAINT", "Text clip must be a rectangle");
  }
  const { x, y, w, h } = value;
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y) || typeof w !== "number" || !Number.isFinite(w) || w < 0 || typeof h !== "number" || !Number.isFinite(h) || h < 0) {
    throw new LayoutError("INVALID_CONSTRAINT", "Text clip must have finite coordinates and nonnegative finite dimensions");
  }
  return { x, y, w, h };
}
var TRANSITION_KINDS = new Set(["slide", "fade"]);
var TRANSITION_DIRECTIONS = new Set(["forward", "backward"]);
var TRANSITION_DEFAULT_DURATION_MS = 240;
function normalizeSceneTransition(request) {
  const kind = request.kind ?? "slide";
  const direction = request.direction ?? "forward";
  const durationMs = request.durationMs ?? TRANSITION_DEFAULT_DURATION_MS;
  if (!TRANSITION_KINDS.has(kind)) {
    throw new LayoutError("INVALID_TRANSITION", `unknown transition kind "${String(kind)}"`);
  }
  if (!TRANSITION_DIRECTIONS.has(direction)) {
    throw new LayoutError("INVALID_TRANSITION", `unknown transition direction "${String(direction)}"`);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 1e4) {
    throw new LayoutError("INVALID_TRANSITION", "transition durationMs must be a finite value in (0, 10000]");
  }
  return { kind, direction, durationMs };
}
var Canvas = Symbol.for("tenun.preview.canvas");
var ScrollViewKind = Symbol.for("tenun.widgets.scroll-view");
var ThemeScope = Symbol.for("tenun.preview.theme-scope");
function scopeThemeColors(palette) {
  return {
    accent: palette.primary,
    danger: palette.error,
    surface: palette.surface,
    surfaceRaised: palette.surfaceContainer,
    text: palette.onSurface,
    primaryContainer: palette.primaryContainer,
    onPrimaryContainer: palette.onPrimaryContainer,
    outlineVariant: palette.outlineVariant
  };
}
function resolveRoles(theme) {
  const c = theme.colors ?? {};
  return {
    primary: c.accent ?? "#4C8DFF",
    onPrimary: c.onPrimary ?? "#FFFFFF",
    primaryContainer: c.primaryContainer ?? "#223354",
    onPrimaryContainer: c.onPrimaryContainer ?? "#D6E4FF",
    secondaryContainer: c.secondaryContainer ?? "#30354A",
    onSecondaryContainer: c.onSecondaryContainer ?? "#DCE4FF",
    surface: c.surface ?? "#101014",
    surfaceContainer: c.surfaceContainer ?? "#16161D",
    surfaceContainerHigh: c.surfaceContainerHigh ?? "#232330",
    onSurface: c.text ?? "#F2F2F7",
    onSurfaceVariant: c.onSurfaceVariant ?? "#9AA3B2",
    outline: c.outline ?? "#474B5A",
    outlineVariant: c.outlineVariant ?? "#26262F",
    error: c.danger ?? "#FF5A5F",
    success: c.success ?? "#3DD68C",
    warning: c.warning ?? "#F5A623",
    inverseSurface: c.inverseSurface ?? "#2E2E3C",
    onInverseSurface: c.onInverseSurface ?? "#F2F2F7",
    onPrimaryFixed: c.onPrimaryFixed ?? "#FFFFFF"
  };
}
var SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
var RADIUS = { sm: 8, md: 14, lg: 22 };
var TYPOGRAPHY = {
  label: { size: 14, lineHeight: 20, weight: 600 },
  caption: { size: 13, lineHeight: 18, weight: 400 },
  body: { size: 17, lineHeight: 24, weight: 400 },
  title: { size: 22, lineHeight: 30, weight: 600 },
  headline: { size: 30, lineHeight: 38, weight: 700 },
  display: { size: 44, lineHeight: 52, weight: 700 }
};
var DESIGN_WIDTH = 720;
function finiteNonnegative(value, where) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new LayoutError("INVALID_THEME_TOKEN", `${where} must be a nonnegative finite number`);
  }
  return value;
}
function finitePositive(value, where) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new LayoutError("INVALID_THEME_TOKEN", `${where} must be a positive finite number`);
  }
  return value;
}
function validateTypographyEntry(entry, where) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new LayoutError("INVALID_THEME_TOKEN", `${where} must be an object`);
  }
  finitePositive(entry.size, `${where}.size`);
  if (entry.lineHeight !== undefined) {
    finitePositive(entry.lineHeight, `${where}.lineHeight`);
  }
  const w = entry.weight;
  if (w !== undefined && w !== "bold" && w !== "normal" && !(typeof w === "number" && Number.isFinite(w))) {
    throw new LayoutError("INVALID_THEME_TOKEN", `${where}.weight must be a finite number or 'normal'/'bold'`);
  }
}
function pushTokenScope(ctx, raw) {
  if (raw === undefined || raw === null || typeof raw !== "object")
    return false;
  const scope = raw;
  if (scope.spacing !== undefined) {
    if (typeof scope.spacing !== "object" || scope.spacing === null || Array.isArray(scope.spacing)) {
      throw new LayoutError("INVALID_THEME_TOKEN", "ThemeScope tokens.spacing must be an object");
    }
    for (const [key, value] of Object.entries(scope.spacing)) {
      finiteNonnegative(value, `ThemeScope tokens.spacing.${key}`);
    }
  }
  if (scope.radius !== undefined) {
    if (typeof scope.radius !== "object" || scope.radius === null || Array.isArray(scope.radius)) {
      throw new LayoutError("INVALID_THEME_TOKEN", "ThemeScope tokens.radius must be an object");
    }
    for (const [key, value] of Object.entries(scope.radius)) {
      finiteNonnegative(value, `ThemeScope tokens.radius.${key}`);
    }
  }
  if (scope.typography !== undefined) {
    if (typeof scope.typography !== "object" || scope.typography === null || Array.isArray(scope.typography)) {
      throw new LayoutError("INVALID_THEME_TOKEN", "ThemeScope tokens.typography must be an object");
    }
    for (const [variant, entry] of Object.entries(scope.typography)) {
      validateTypographyEntry(entry, `ThemeScope tokens.typography.${variant}`);
    }
  }
  ctx.tokenScopes.push(scope);
  return true;
}
function buildTokenSet(theme) {
  const spacing = { ...SPACING };
  if (theme.spacing !== undefined) {
    if (typeof theme.spacing !== "object" || theme.spacing === null || Array.isArray(theme.spacing)) {
      throw new LayoutError("INVALID_THEME_TOKEN", "theme.spacing must be an object");
    }
    for (const [key, value] of Object.entries(theme.spacing)) {
      spacing[key] = finiteNonnegative(value, `theme.spacing.${key}`);
    }
  }
  const radius = { ...RADIUS };
  if (theme.radius !== undefined) {
    if (typeof theme.radius !== "object" || theme.radius === null || Array.isArray(theme.radius)) {
      throw new LayoutError("INVALID_THEME_TOKEN", "theme.radius must be an object");
    }
    for (const [key, value] of Object.entries(theme.radius)) {
      radius[key] = finiteNonnegative(value, `theme.radius.${key}`);
    }
  }
  const typography = { ...TYPOGRAPHY };
  if (theme.typography !== undefined) {
    if (typeof theme.typography !== "object" || theme.typography === null || Array.isArray(theme.typography)) {
      throw new LayoutError("INVALID_THEME_TOKEN", "theme.typography must be an object");
    }
    for (const [variant, entry] of Object.entries(theme.typography)) {
      validateTypographyEntry(entry, `theme.typography.${variant}`);
      const size = finitePositive(entry.size, `theme.typography.${variant}.size`);
      let lineHeight;
      if (entry.lineHeight !== undefined) {
        lineHeight = finitePositive(entry.lineHeight, `theme.typography.${variant}.lineHeight`);
      } else {
        const existing = TYPOGRAPHY[variant];
        lineHeight = existing ? Math.round(size * (existing.lineHeight / existing.size)) : Math.round(size * 1.3);
      }
      let weight;
      const w = entry.weight;
      if (w === "bold") {
        weight = 700;
      } else if (w === "normal") {
        weight = 400;
      } else if (w === undefined) {
        weight = TYPOGRAPHY[variant]?.weight ?? 400;
      } else {
        weight = w;
      }
      typography[variant] = { size, lineHeight, weight };
    }
  }
  return { spacing, radius, typography };
}
function spacing(ctx, value, fallback) {
  if (typeof value === "number")
    return value;
  if (typeof value === "string") {
    for (let index = ctx.tokenScopes.length - 1;index >= 0; index--) {
      const scoped = ctx.tokenScopes[index].spacing?.[value];
      if (typeof scoped === "number")
        return scoped;
    }
    const themed = ctx.tokens.spacing[value];
    if (typeof themed === "number")
      return themed;
  }
  return fallback;
}
function radius(ctx, value, fallback) {
  if (typeof value === "number")
    return value;
  if (typeof value === "string") {
    for (let index = ctx.tokenScopes.length - 1;index >= 0; index--) {
      const scoped = ctx.tokenScopes[index].radius?.[value];
      if (typeof scoped === "number")
        return scoped;
    }
    const themed = ctx.tokens.radius[value];
    if (typeof themed === "number")
      return themed;
  }
  return fallback;
}
function typography(ctx, variant) {
  const name = typeof variant === "string" ? variant : "body";
  let resolved;
  for (let index = ctx.tokenScopes.length - 1;index >= 0; index--) {
    const scoped = ctx.tokenScopes[index].typography?.[name];
    if (scoped !== undefined) {
      const weight = scoped.weight === "bold" ? 700 : scoped.weight === "normal" ? 400 : scoped.weight ?? 400;
      const lineHeight = scoped.lineHeight ?? Math.round(scoped.size * 1.3);
      resolved = {
        size: scoped.size,
        lineHeight,
        weight
      };
      break;
    }
  }
  if (!resolved) {
    const themed = ctx.tokens.typography[name];
    resolved = themed !== undefined ? themed : ctx.tokens.typography.body;
  }
  if (ctx.textScale === 1)
    return resolved;
  return {
    size: Math.round(resolved.size * ctx.textScale * 100) / 100,
    lineHeight: Math.round(resolved.lineHeight * ctx.textScale * 100) / 100,
    weight: resolved.weight
  };
}
var CHAR_WIDTH_FACTOR = 0.56;
function textWidth(text, size) {
  return text.length * size * CHAR_WIDTH_FACTOR;
}
function wrapText(text, size, maxWidth) {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0)
    return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    if (textWidth(word, size) > maxWidth) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      let chunk = "";
      for (const cluster of graphemeClusters(word)) {
        const next = chunk + cluster;
        if (chunk.length > 0 && textWidth(next, size) > maxWidth) {
          lines.push(chunk);
          chunk = cluster;
        } else {
          chunk = next;
        }
      }
      current = chunk;
      continue;
    }
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (textWidth(candidate, size) <= maxWidth || current.length === 0) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0)
    lines.push(current);
  return lines;
}
function maxLinesOf(props) {
  const value = props.maxLines;
  if (value === undefined || value === null)
    return Number.MAX_SAFE_INTEGER;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new LayoutError("INVALID_CONSTRAINT", `Text maxLines must be a positive integer, got ${String(value)}`);
  }
  return value;
}
function isExtendCodePoint(codePoint, previous) {
  if (codePoint === 8205 || previous === 8205)
    return true;
  if (codePoint >= 768 && codePoint <= 879)
    return true;
  if (codePoint >= 1611 && codePoint <= 1631)
    return true;
  if (codePoint === 1648)
    return true;
  if (codePoint >= 6832 && codePoint <= 6911)
    return true;
  if (codePoint >= 7616 && codePoint <= 7679)
    return true;
  if (codePoint >= 8400 && codePoint <= 8447)
    return true;
  if (codePoint >= 65024 && codePoint <= 65039)
    return true;
  if (codePoint >= 127995 && codePoint <= 127999)
    return true;
  return false;
}
function graphemeClusters(word) {
  const clusters = [];
  let current = "";
  let previousCodePoint = 0;
  let consecutiveRIs = 0;
  for (const codePointText of word) {
    const codePoint = codePointText.codePointAt(0);
    const isRI = codePoint >= 127462 && codePoint <= 127487;
    let extend = false;
    if (current.length > 0) {
      if (isRI) {
        if (consecutiveRIs % 2 === 1) {
          extend = true;
        }
      } else if (isExtendCodePoint(codePoint, previousCodePoint)) {
        extend = true;
      }
    }
    if (extend) {
      current += codePointText;
    } else {
      if (current.length > 0)
        clusters.push(current);
      current = codePointText;
    }
    consecutiveRIs = isRI ? consecutiveRIs + 1 : 0;
    previousCodePoint = codePoint;
  }
  if (current.length > 0)
    clusters.push(current);
  return clusters;
}
function layoutTextLines(props, text, typography2, maxWidth) {
  const maxLines = maxLinesOf(props);
  if (props.ellipsis !== undefined && props.ellipsis !== null && typeof props.ellipsis !== "boolean") {
    throw new LayoutError("INVALID_CONSTRAINT", "Text ellipsis must be a boolean");
  }
  const lines = wrapText(text, typography2.size, Math.max(maxWidth, 1));
  if (lines.length <= maxLines)
    return { lines, truncated: false };
  const cut = lines.slice(0, maxLines);
  if (props.ellipsis === true) {
    const budget = Math.max(maxWidth, 1);
    const marker = "…";
    const markerWidth = textWidth(marker, typography2.size);
    if (markerWidth > budget) {
      cut[maxLines - 1] = "";
    } else {
      let clusters = graphemeClusters(cut[maxLines - 1]);
      while (clusters.length > 0 && textWidth(`${clusters.join("")}${marker}`, typography2.size) > budget) {
        clusters.pop();
      }
      cut[maxLines - 1] = `${clusters.join("")}${marker}`;
    }
  }
  return { lines: cut, truncated: true };
}
function isWidgetNode(child) {
  return typeof child === "object" && child !== null && "kind" in child;
}
var asNodeCache = new WeakMap;
function asNode(node) {
  let cached = asNodeCache.get(node);
  if (!cached) {
    cached = { kind: node.kind, props: node.props, children: node.children };
    asNodeCache.set(node, cached);
  }
  return cached;
}
function textContent(node) {
  return node.children.map((child) => typeof child === "string" || typeof child === "number" ? String(child) : "").join("");
}
function widgetChildren(node) {
  return node.children.filter(isWidgetNode).map(asNode);
}
function childNodes(node) {
  const result = [];
  for (const child of node.children) {
    if (typeof child === "string" || typeof child === "number") {
      result.push({ kind: "text", props: {}, children: [child] });
    } else if (isWidgetNode(child)) {
      result.push(asNode(child));
    }
  }
  return result;
}
var activeWidgetContext = null;
function withWidgetContext(context, fn) {
  const prev = activeWidgetContext;
  activeWidgetContext = context;
  try {
    return fn();
  } finally {
    activeWidgetContext = prev;
  }
}
function makeWidgetContext(ctx) {
  return Object.freeze({
    theme: ctx.theme,
    tokens: ctx.tokens,
    palette: ctx.palette,
    slotPalette: ctx.slotPalette,
    locale: ctx.locale,
    textScale: ctx.textScale,
    platform: ctx.platform
  });
}
function callComponent(ctx, node) {
  const fn = node.kind;
  const prev = activeWidgetContext;
  const widgetCtx = makeWidgetContext(ctx);
  activeWidgetContext = widgetCtx;
  try {
    return asNode(fn({ ...node.props, children: node.children }, widgetCtx));
  } finally {
    activeWidgetContext = prev;
  }
}
function resolveOnce(ctx, node) {
  let resolved = ctx.componentCache.get(node);
  if (!resolved) {
    resolved = callComponent(ctx, node);
    ctx.componentCache.set(node, resolved);
  }
  return resolved;
}
function resolveNode(ctx, kid) {
  let current = kid;
  while (typeof current.kind === "function")
    current = resolveOnce(ctx, current);
  return current;
}
function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new LayoutError("INVALID_CONSTRAINT", `${name} must be a finite nonnegative number`);
  }
  return value;
}
function dimension(props, name) {
  return typeof props[name] === "number" ? nonnegative(props[name], name) : undefined;
}
function offset(props, name) {
  const value = props[name];
  if (typeof value !== "number")
    return;
  if (!Number.isFinite(value))
    throw new LayoutError("INVALID_CONSTRAINT", `${name} must be finite`);
  return value;
}
function gapOf(ctx, props) {
  return nonnegative(spacing(ctx, props.gap, 0), "gap");
}
function paddingOf(ctx, props, fallback) {
  return nonnegative(spacing(ctx, props.padding, fallback), "padding");
}
function loose(maxW, maxH = Infinity) {
  return { minW: 0, maxW, minH: 0, maxH };
}
function tight(frame) {
  return { minW: frame.w, maxW: frame.w, minH: frame.h, maxH: frame.h };
}
function constrain(frame, bounds) {
  return {
    w: Math.min(Math.max(nonnegative(frame.w, "measured width"), bounds.minW), bounds.maxW),
    h: Math.min(Math.max(nonnegative(frame.h, "measured height"), bounds.minH), bounds.maxH)
  };
}
function inset(bounds, pad) {
  return {
    minW: Math.max(0, bounds.minW - pad * 2),
    maxW: Math.max(0, bounds.maxW - pad * 2),
    minH: Math.max(0, bounds.minH - pad * 2),
    maxH: Math.max(0, bounds.maxH - pad * 2)
  };
}
function withDimensions(bounds, props) {
  const width = dimension(props, "width");
  const height = dimension(props, "height");
  const w = width === undefined ? undefined : Math.min(Math.max(width, bounds.minW), bounds.maxW);
  const h = height === undefined ? undefined : Math.min(Math.max(height, bounds.minH), bounds.maxH);
  return {
    minW: w ?? bounds.minW,
    maxW: w ?? bounds.maxW,
    minH: h ?? bounds.minH,
    maxH: h ?? bounds.maxH
  };
}
function decorationLayout(ctx, node, bounds, pad = 0, gap = 0) {
  const inner = inset(bounds, pad);
  const kids = childNodes(node);
  const frames = kids.map((kid) => measure(ctx, kid, kids.length === 1 ? inner : loose(inner.maxW)));
  let y = pad;
  const children = kids.map((kid, index) => {
    const frame = frames[index];
    const child = { kid, frame, x: pad, y };
    y += frame.h + (index < kids.length - 1 ? gap : 0);
    return child;
  });
  return {
    frame: constrain({ w: pad * 2 + Math.max(...frames.map((frame) => frame.w), 0), h: y + pad }, bounds),
    children
  };
}
function flexLayout(ctx, node, bounds, axis) {
  const horizontal = axis === "row";
  const pad = paddingOf(ctx, node.props, 0);
  const gap = gapOf(ctx, node.props);
  const inner = inset(bounds, pad);
  const mainMax = horizontal ? inner.maxW : inner.maxH;
  const crossMax = horizontal ? inner.maxH : inner.maxW;
  const align = crossAlignOf(node.props, horizontal ? "center" : "start");
  const kids = childNodes(node).map((kid) => resolveNode(ctx, kid));
  const flexes = kids.map((kid) => {
    if (kid.kind !== ExpandedKind)
      return 0;
    const value = kid.props.flex ?? 1;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new LayoutError("INVALID_CONSTRAINT", "Expanded flex must be a positive finite number");
    }
    return value;
  });
  const flexSum = flexes.reduce((sum, value) => sum + value, 0);
  if (flexSum > 0 && !Number.isFinite(mainMax)) {
    throw new LayoutError("UNBOUNDED_FLEX", `Expanded requires a bounded ${axis} main axis`);
  }
  if (!Number.isFinite(flexSum)) {
    throw new LayoutError("INVALID_CONSTRAINT", "Combined flex must be finite");
  }
  const crossTight = align === "stretch" && Number.isFinite(crossMax);
  const childBounds = (share) => horizontal ? {
    minW: share ?? 0,
    maxW: share ?? mainMax,
    minH: crossTight ? crossMax : 0,
    maxH: crossMax
  } : {
    minW: crossTight ? crossMax : 0,
    maxW: crossMax,
    minH: share ?? 0,
    maxH: share ?? Infinity
  };
  const frames = kids.map((kid, index) => flexes[index] > 0 ? { w: 0, h: 0 } : measure(ctx, kid, childBounds()));
  const gaps = nonnegative(gap * Math.max(kids.length - 1, 0), "combined gaps");
  if (horizontal && flexSum === 0) {
    const available = Math.max(mainMax - gaps, 0);
    const natural = frames.reduce((sum, frame2) => sum + frame2.w, 0);
    let excess = natural - available;
    if (excess > 0) {
      const shrinkable = kids.map((kid, index) => ({ kid, index })).filter(({ kid }) => kid.kind === "text" || kid.kind === "column" || kid.kind === "row");
      const total = shrinkable.reduce((sum, entry) => sum + frames[entry.index].w, 0);
      for (const entry of shrinkable) {
        const previous = frames[entry.index];
        const share = total > 0 ? previous.w / total : 1 / shrinkable.length;
        const reduced = Math.max(previous.w - excess * share, Math.min(96, previous.w));
        const taken = previous.w - reduced;
        if (taken > 0) {
          frames[entry.index] = measure(ctx, entry.kid, { ...childBounds(), maxW: reduced });
          excess -= taken;
        }
        if (excess <= 0)
          break;
      }
    }
  }
  const fixedMain = nonnegative(frames.reduce((sum, frame2) => sum + (horizontal ? frame2.w : frame2.h), 0), "combined child size");
  const free = Number.isFinite(mainMax) ? Math.max(mainMax - gaps - fixedMain, 0) : 0;
  flexes.forEach((flex, index) => {
    if (flex > 0)
      frames[index] = measure(ctx, kids[index], childBounds(free * (flex / flexSum)));
  });
  if (horizontal && align === "stretch" && !Number.isFinite(crossMax)) {
    const height = Math.max(...frames.map((frame2) => frame2.h), 0);
    frames.forEach((frame2, index) => {
      if (!frame2.bounds)
        throw new LayoutError("INVALID_CONSTRAINT", "Missing measured child constraints");
      frames[index] = measure(ctx, kids[index], { ...frame2.bounds, minH: height, maxH: height });
    });
  }
  const naturalMain = nonnegative(frames.reduce((sum, frame2) => sum + (horizontal ? frame2.w : frame2.h), 0) + gaps, "combined child size");
  const naturalCross = Math.max(...frames.map((frame2) => horizontal ? frame2.h : frame2.w), 0);
  const main = Number.isFinite(mainMax) ? mainMax : naturalMain;
  const frame = constrain(horizontal ? { w: main + pad * 2, h: naturalCross + pad * 2 } : { w: naturalCross + pad * 2, h: main + pad * 2 }, bounds);
  const availableMain = Math.max((horizontal ? frame.w : frame.h) - pad * 2, 0);
  const availableCross = Math.max((horizontal ? frame.h : frame.w) - pad * 2, 0);
  const slack = Math.max(availableMain - naturalMain, 0);
  const justify = node.props.justify ?? "start";
  const between = justify === "between" && kids.length > 1 ? slack / (kids.length - 1) : 0;
  const around = justify === "around" && kids.length > 0 ? slack / kids.length : 0;
  let cursor = pad + (justify === "end" ? slack : justify === "center" ? slack / 2 : around / 2);
  const children = kids.map((kid, index) => {
    const child = frames[index];
    const cross = horizontal ? child.h : child.w;
    const crossOffset = pad + (align === "end" ? availableCross - cross : align === "center" ? (availableCross - cross) / 2 : 0);
    const placement = { kid, frame: child, x: horizontal ? cursor : crossOffset, y: horizontal ? crossOffset : cursor };
    cursor += (horizontal ? child.w : child.h) + gap + between + around;
    return placement;
  });
  return { frame, children };
}
function scrollLayout(ctx, node, bounds) {
  const pad = paddingOf(ctx, node.props, 0);
  const gap = gapOf(ctx, node.props);
  const inner = inset(bounds, pad);
  const kids = childNodes(node).map((kid) => resolveNode(ctx, kid));
  for (const kid of kids) {
    if (kid.kind === ScrollViewKind) {
      throw new LayoutError("INVALID_CONSTRAINT", "Nested ScrollView is not part of this scroll contract yet");
    }
  }
  if (!Number.isFinite(bounds.maxH)) {
    throw new LayoutError("UNBOUNDED_FLEX", "ScrollView requires a bounded main axis (e.g. inside Expanded)");
  }
  const frames = kids.map((kid) => measure(ctx, kid, { minW: 0, maxW: inner.maxW, minH: 0, maxH: Infinity }));
  const gaps = nonnegative(gap * Math.max(kids.length - 1, 0), "combined gaps");
  const naturalMain = nonnegative(frames.reduce((sum, frame2) => sum + frame2.h, 0) + gaps, "content height");
  const naturalCross = Math.max(...frames.map((frame2) => frame2.w), 0);
  const viewportW = Number.isFinite(inner.maxW) ? inner.maxW : naturalCross;
  const viewportH = Number.isFinite(inner.maxH) ? inner.maxH : naturalMain;
  const frame = constrain({ w: viewportW + pad * 2, h: viewportH + pad * 2 }, bounds);
  let cursor = pad;
  const children = kids.map((kid, index) => {
    const child = frames[index];
    const placement = { kid, frame: child, x: pad, y: cursor };
    cursor += child.h + gap;
    return placement;
  });
  return { frame, children };
}
function stackLayout(ctx, node, bounds) {
  const kids = childNodes(node).map((kid) => resolveNode(ctx, kid));
  const baseIndex = kids.findIndex((kid) => kid.kind !== PositionedKind);
  const base = kids[baseIndex];
  const baseFrame = base ? measure(ctx, base, loose(bounds.maxW, bounds.maxH)) : undefined;
  const frame = constrain(baseFrame ?? { w: 0, h: 0 }, bounds);
  const rawAlign = typeof node.props.alignment === "string" ? node.props.alignment : "topLeft";
  const alignment = STACK_ALIGNMENT[rawAlign] ?? STACK_ALIGNMENT.topLeft;
  const children = [];
  for (const [index, kid] of kids.entries()) {
    if (kid.kind !== PositionedKind) {
      const child = index === baseIndex && baseFrame ? baseFrame : measure(ctx, kid, loose(frame.w, frame.h));
      children.push({ kid, frame: child, x: (frame.w - child.w) * alignment.ax, y: (frame.h - child.h) * alignment.ay });
      continue;
    }
    const left = offset(kid.props, "left");
    const right = offset(kid.props, "right");
    const top = offset(kid.props, "top");
    const bottom = offset(kid.props, "bottom");
    const width = left !== undefined && right !== undefined ? Math.max(frame.w - left - right, 0) : undefined;
    const height = top !== undefined && bottom !== undefined ? Math.max(frame.h - top - bottom, 0) : undefined;
    const childBounds = {
      minW: width ?? 0,
      maxW: width ?? frame.w,
      minH: height ?? 0,
      maxH: height ?? frame.h
    };
    for (const nested of childNodes(kid)) {
      const child = measure(ctx, nested, childBounds);
      children.push({
        kid: nested,
        frame: child,
        x: left ?? (right === undefined ? 0 : frame.w - right - child.w),
        y: top ?? (bottom === undefined ? 0 : frame.h - bottom - child.h)
      });
    }
  }
  return { frame, children };
}
function scaffoldLayout(ctx, node, bounds) {
  const kids = widgetChildren(node).map((kid) => resolveNode(ctx, kid));
  const appBar = kids.find((kid) => kid.kind === "app-bar");
  const bodies = kids.filter((kid) => kid !== appBar);
  const barFrame = appBar ? measure(ctx, appBar, { ...loose(bounds.maxW), minW: bounds.maxW }) : { w: 0, h: 0 };
  const available = Number.isFinite(bounds.maxH) ? Math.max(bounds.maxH - barFrame.h, 0) : Infinity;
  const children = appBar ? [{ kid: appBar, frame: barFrame, x: 0, y: 0 }] : [];
  let y = barFrame.h;
  for (const kid of bodies) {
    const child = measure(ctx, kid, {
      minW: bounds.maxW,
      maxW: bounds.maxW,
      minH: bodies.length === 1 && Number.isFinite(available) ? available : 0,
      maxH: bodies.length === 1 ? available : Infinity
    });
    children.push({ kid, frame: child, x: 0, y });
    y += child.h;
  }
  return { frame: constrain({ w: bounds.maxW, h: y }, bounds), children };
}
function measure(ctx, node, boundsOrWidth) {
  const bounds = typeof boundsOrWidth === "number" ? loose(boundsOrWidth) : boundsOrWidth;
  return { ...measureNode(ctx, node, bounds), bounds };
}
function measureNode(ctx, node, bounds) {
  const { kind, props } = node;
  if (typeof kind === "function")
    return measure(ctx, resolveOnce(ctx, node), bounds);
  if (kind === TextFieldKind) {
    resolveTextFieldProps(props);
    return constrain({ w: Number.isFinite(bounds.maxW) ? bounds.maxW : 240, h: 72 }, bounds);
  }
  if (kind === Canvas) {
    return constrain({ w: dimension(props, "width") ?? bounds.maxW, h: dimension(props, "height") ?? 0 }, bounds);
  }
  if (kind === ThemeScope) {
    const pushed = pushTokenScope(ctx, props.tokens);
    const prevLocale = ctx.locale;
    const prevTextScale = ctx.textScale;
    const prevPlatform = ctx.platform;
    if (props.locale !== undefined)
      ctx.locale = validateLocale(props.locale, "ThemeScope locale");
    if (props.textScale !== undefined)
      ctx.textScale = validateTextScale(props.textScale, "ThemeScope textScale");
    if (props.platform !== undefined)
      ctx.platform = validatePlatform(props.platform, "ThemeScope platform");
    try {
      return decorationLayout(ctx, node, bounds).frame;
    } finally {
      if (pushed)
        ctx.tokenScopes.pop();
      ctx.locale = prevLocale;
      ctx.textScale = prevTextScale;
      ctx.platform = prevPlatform;
    }
  }
  if (kind === SizedBoxKind) {
    const own = withDimensions(bounds, props);
    const frames = childNodes(node).map((kid) => measure(ctx, kid, own));
    return constrain({ w: Math.max(...frames.map((frame) => frame.w), 0), h: Math.max(...frames.map((frame) => frame.h), 0) }, own);
  }
  if (kind === CenterKind) {
    const frames = childNodes(node).map((kid) => measure(ctx, kid, loose(bounds.maxW, bounds.maxH)));
    return constrain({
      w: Number.isFinite(bounds.maxW) ? bounds.maxW : Math.max(...frames.map((frame) => frame.w), 0),
      h: Number.isFinite(bounds.maxH) ? bounds.maxH : Math.max(...frames.map((frame) => frame.h), 0)
    }, bounds);
  }
  if (kind === StackKind)
    return stackLayout(ctx, node, bounds).frame;
  if (kind === ScrollViewKind)
    return scrollLayout(ctx, node, bounds).frame;
  if (kind === WrapKind) {
    const flow = layoutWrapChildren(ctx, node, bounds.maxW);
    return constrain({ w: flow.width, h: flow.height }, bounds);
  }
  if (kind === ContainerKind) {
    const own = withDimensions(bounds, props);
    if (childNodes(node).length === 0)
      return constrain({ w: own.maxW, h: own.minH }, own);
    return decorationLayout(ctx, node, own, paddingOf(ctx, props, 0)).frame;
  }
  if (kind === IconKind) {
    const size = dimension(props, "size") ?? 24;
    return constrain({ w: textWidth(typeof props.glyph === "string" ? props.glyph : "", size), h: Math.round(size * 1.2) }, bounds);
  }
  if (kind === PositionedKind || kind === ExpandedKind || kind === GestureDetectorKind || typeof kind === "symbol") {
    return decorationLayout(ctx, node, bounds).frame;
  }
  switch (kind) {
    case "text": {
      const ty = typography(ctx, props.variant);
      const { lines } = layoutTextLines(props, textContent(node), ty, bounds.maxW);
      let widest = 0;
      for (const line of lines) {
        const width = textWidth(line, ty.size);
        if (width > widest)
          widest = width;
      }
      return constrain({ w: Math.min(widest, bounds.maxW), h: lines.length * ty.lineHeight }, bounds);
    }
    case "button": {
      const label = textContent(node) || "Button";
      return constrain({ w: Math.max(96, textWidth(label, typography(ctx, "body").size) + 48), h: 64 }, bounds);
    }
    case "card":
      return decorationLayout(ctx, node, bounds, paddingOf(ctx, props, 16), spacing(ctx, "sm", 8)).frame;
    case "column":
      return flexLayout(ctx, node, bounds, "column").frame;
    case "row":
      return flexLayout(ctx, node, bounds, "row").frame;
    case "app-bar":
      return constrain({ w: bounds.maxW, h: 96 }, bounds);
    case "spacer":
      return constrain({ w: 0, h: nonnegative(spacing(ctx, props.size, 16), "spacer size") }, bounds);
    case "scaffold":
      return scaffoldLayout(ctx, node, bounds).frame;
    default:
      return constrain({ w: 0, h: 0 }, bounds);
  }
}
function placeChildren(ctx, layout, x, y) {
  for (const child of layout.children)
    place(ctx, child.kid, x + child.x, y + child.y, child.frame);
}
function fieldTextWindow(text, size, width, offset2 = 0) {
  let cursor = 0;
  let start = 0;
  let visible = "";
  for (const character of text) {
    const advance = textWidth(character, size);
    if (cursor >= offset2 && cursor + advance <= offset2 + width) {
      if (visible.length === 0)
        start = cursor - offset2;
      visible += character;
    }
    cursor += advance;
    if (cursor > offset2 + width)
      break;
  }
  return { text: visible, x: start };
}
function placeTextField(ctx, rawProps, x, y, w, h) {
  const props = resolveTextFieldProps(rawProps);
  if (ctx.textFieldIds.has(props.id)) {
    throw new TextInputError("DUPLICATE_TEXT_FIELD", `TextField id "${props.id}" appears more than once in a screen`);
  }
  ctx.textFieldIds.add(props.id);
  const descriptor = textInputDescriptor(props, { x, y, w, h }, ctx.textInput?.active);
  ctx.textFields.push({ props, descriptor });
  const C = ctx.palette;
  const surface = ctx.theme.colors?.surfaceRaised ?? ctx.theme.colors?.surface ?? C.surfaceContainer;
  const foreground = ctx.theme.colors?.text ?? C.onSurface;
  const inset2 = Math.min(12, w / 2);
  const innerWidth = Math.max(0, w - inset2 * 2);
  const verticalInset = Math.min(2, h / 2);
  const clip = { x: x + inset2, y: y + verticalInset, w: innerWidth, h: Math.max(0, h - verticalInset * 2) };
  const size = Math.min(17, h / 3);
  const baseline = y + Math.min(h, props.label ? h * 0.72 : h / 2 + size * 0.36);
  const textTop = Math.max(y, baseline - size);
  const radius2 = Math.min(8, w / 2, h / 2);
  ctx.ops.push({ op: "rect", x, y, w, h, r: radius2, color: surface });
  ctx.ops.push({
    op: "outline",
    x,
    y,
    w,
    h,
    r: radius2,
    color: descriptor.focused ? C.primary : C.outline,
    width: descriptor.focused ? 2 : 1
  });
  if (props.label && innerWidth > 0 && h > 0) {
    const labelSize = Math.min(12, size);
    ctx.ops.push({
      op: "text",
      x: x + inset2,
      y: y + Math.min(h, 17),
      text: fieldTextWindow(props.label, labelSize, innerWidth).text,
      size: labelSize,
      weight: 500,
      color: descriptor.focused ? C.primary : foreground,
      clip
    });
  }
  const extentX = textWidth(descriptor.text.slice(0, descriptor.selection.extent), size);
  const offset2 = descriptor.focused ? Math.max(0, extentX - innerWidth + 1) : 0;
  const position = (index) => x + inset2 + Math.max(0, Math.min(innerWidth, textWidth(descriptor.text.slice(0, index), size) - offset2));
  let selected;
  if (descriptor.focused && descriptor.selection.base !== descriptor.selection.extent) {
    const left = position(Math.min(descriptor.selection.base, descriptor.selection.extent));
    const right = position(Math.max(descriptor.selection.base, descriptor.selection.extent));
    selected = { x: left, y: textTop, w: right - left, h: Math.max(0, Math.min(h, size * 1.2)) };
    ctx.ops.push({ op: "rect", ...selected, r: 0, color: C.primaryContainer });
  }
  const shown = descriptor.text || props.placeholder;
  const window = fieldTextWindow(shown, size, innerWidth, descriptor.text ? offset2 : 0);
  if (window.text && h > 0) {
    const text = {
      op: "text",
      x: x + inset2 + window.x,
      y: baseline,
      text: window.text,
      size,
      weight: 400,
      color: foreground,
      clip
    };
    ctx.ops.push(text);
    if (selected)
      ctx.ops.push({ ...text, color: C.onPrimaryContainer, clip: selected });
  }
  if (descriptor.focused && descriptor.composing) {
    ctx.ops.push({
      op: "line",
      x1: position(descriptor.composing.start),
      x2: position(descriptor.composing.end),
      y1: Math.min(y + h, baseline + 2),
      y2: Math.min(y + h, baseline + 2),
      width: 1,
      color: C.primary
    });
  }
  if (descriptor.focused && descriptor.selection.base === descriptor.selection.extent) {
    ctx.ops.push({
      op: "line",
      x1: position(descriptor.selection.extent),
      x2: position(descriptor.selection.extent),
      y1: textTop,
      y2: Math.min(y + h, baseline + 2),
      width: 1,
      color: C.primary
    });
  }
  ctx.ops.push(descriptor);
  let focusTapId;
  if (!props.readOnly) {
    focusTapId = addTap(ctx, x, y, w, h, () => {
      if (!ctx.textInput) {
        throw new TextInputError("TEXT_INPUT_RUNTIME_REQUIRED", "Editable TextField focus requires ApplicationRuntime");
      }
      ctx.textInput.focus(props.id);
    });
  }
  ctx.semantics.push({
    id: props.id,
    role: "textfield",
    value: descriptor.text,
    hint: props.label ?? props.placeholder,
    state: { focused: descriptor.focused, readOnly: props.readOnly === true },
    bounds: { x, y, w, h },
    ...focusTapId !== undefined ? { actions: [{ name: "focus", tapId: focusTapId }] } : {}
  });
}
function place(ctx, node, x, y, frame) {
  const { kind, props } = node;
  const { w, h, bounds } = frame;
  if (!bounds)
    throw new LayoutError("INVALID_CONSTRAINT", "Placement requires the measured constraints");
  if (typeof kind === "function") {
    return place(ctx, resolveOnce(ctx, node), x, y, frame);
  }
  if (kind === TextFieldKind) {
    placeTextField(ctx, props, x, y, w, h);
    return h;
  }
  if (kind === Canvas) {
    const fixedCanvas = props.fixed === true;
    const width = fixedCanvas ? ctx.designWidth : w;
    const height = h;
    const paint = props.paint;
    if (typeof paint === "function") {
      paint({ x: fixedCanvas ? 0 : x, y: fixedCanvas ? 0 : y, w: width }, (op) => ctx.ops.push(offsetOp(op, x, y, {
        fixed: fixedCanvas,
        anchor: props.anchor,
        anchorSize: typeof props.anchorSize === "number" ? props.anchorSize : undefined
      })), (region, run) => {
        const inheritedFixed = region.fixed === undefined && fixedCanvas;
        const fixed = region.fixed ?? fixedCanvas;
        const anchor = region.anchor ?? (inheritedFixed ? props.anchor : undefined);
        const anchorSize = typeof region.anchorSize === "number" ? region.anchorSize : inheritedFixed && typeof props.anchorSize === "number" ? props.anchorSize : undefined;
        addTap(ctx, fixed ? region.x : x + region.x, fixed ? region.y : y + region.y, region.w, region.h, run, "tap", fixed, anchor, anchorSize);
      }, ctx.palette);
    }
    return height;
  }
  if (kind === ThemeScope) {
    const merged = { ...ctx.palette, ...props.scheme ?? {} };
    const slotOverlay = props.slots;
    const pushed = slotOverlay !== undefined && slotOverlay !== null && typeof slotOverlay === "object";
    if (pushed)
      ctx.slotScopes.push(slotOverlay);
    const tokenScope = props.tokens;
    const pushedTokens = pushTokenScope(ctx, tokenScope);
    const locale = props.locale !== undefined ? validateLocale(props.locale, "ThemeScope locale") : ctx.locale;
    const textScale = props.textScale !== undefined ? validateTextScale(props.textScale, "ThemeScope textScale") : ctx.textScale;
    const platform = props.platform !== undefined ? validatePlatform(props.platform, "ThemeScope platform") : ctx.platform;
    const scoped = {
      ...ctx,
      palette: merged,
      theme: { ...ctx.theme, colors: { ...ctx.theme.colors, ...scopeThemeColors(merged) } },
      locale,
      textScale,
      platform
    };
    try {
      placeChildren(scoped, decorationLayout(scoped, node, bounds), x, y);
    } finally {
      if (pushed)
        ctx.slotScopes.pop();
      if (pushedTokens)
        ctx.tokenScopes.pop();
      if (scoped.usedRefs)
        ctx.usedRefs = true;
    }
    return h;
  }
  if (kind === SizedBoxKind) {
    for (const kid of childNodes(node)) {
      const child = measure(ctx, kid, withDimensions(bounds, props));
      place(ctx, kid, x, y, child);
    }
    return h;
  }
  if (kind === CenterKind) {
    for (const kid of childNodes(node)) {
      const child = measure(ctx, kid, loose(bounds.maxW, bounds.maxH));
      place(ctx, kid, x + (w - child.w) / 2, y + (h - child.h) / 2, child);
    }
    return h;
  }
  if (kind === StackKind) {
    placeChildren(ctx, stackLayout(ctx, node, bounds), x, y);
    return h;
  }
  if (kind === ScrollViewKind) {
    const layout = scrollLayout(ctx, node, bounds);
    const regionId = typeof props.id === "string" && props.id.length > 0 ? props.id : `scroll@${x},${y},${w},${h}`;
    const outerOps = ctx.ops;
    const outerTaps = ctx.tapRegions;
    const outerSemantics = ctx.semantics;
    ctx.ops = [];
    ctx.tapRegions = [];
    ctx.semantics = [];
    let nestedOps = [];
    let nestedTaps = [];
    let nestedSemantics = [];
    try {
      placeChildren(ctx, layout, 0, 0);
      nestedOps = ctx.ops;
      nestedTaps = ctx.tapRegions;
      nestedSemantics = ctx.semantics;
    } finally {
      ctx.ops = outerOps;
      ctx.tapRegions = outerTaps;
      ctx.semantics = outerSemantics;
    }
    const contentHeight = layout.children.length > 0 ? Math.max(...layout.children.map((child) => child.y + child.frame.h)) + paddingOf(ctx, props, 0) : 0;
    for (const tap of nestedTaps)
      outerTaps.push({ ...tap, scroll: regionId });
    for (const sem of nestedSemantics) {
      outerSemantics.push({ ...sem, scroll: regionId });
    }
    outerOps.push({ op: "scroll-region", id: regionId, x, y, w, h, contentHeight, ops: nestedOps });
    return h;
  }
  if (kind === ExpandedKind || kind === PositionedKind) {
    placeChildren(ctx, decorationLayout(ctx, node, bounds), x, y);
    return h;
  }
  if (kind === GestureDetectorKind) {
    ctx.absorbedText++;
    try {
      placeChildren(ctx, decorationLayout(ctx, node, bounds), x, y);
    } finally {
      ctx.absorbedText--;
    }
    const actions = [];
    if (typeof props.onTap === "function") {
      actions.push({ name: "press", tapId: addTap(ctx, x, y, w, h, props.onTap) });
    }
    if (typeof props.onLongPress === "function") {
      actions.push({ name: "long-press", tapId: addTap(ctx, x, y, w, h, props.onLongPress, "long-press") });
    }
    if (actions.length > 0 || props.semanticsLabel !== undefined) {
      const label = typeof props.semanticsLabel === "string" ? props.semanticsLabel : deepTextContent(node);
      ctx.semantics.push({
        id: semanticId(props.semanticsId, { x, y, w, h }),
        role: "generic",
        ...label.length > 0 ? { label } : {},
        bounds: { x, y, w, h },
        ...actions.length > 0 ? { actions } : {}
      });
    }
    return h;
  }
  if (kind === ContainerKind) {
    const pad = paddingOf(ctx, props, 0);
    const radius2 = dimension(props, "radius") ?? 0;
    const fill = roleColor(ctx, props.color);
    if (fill !== undefined) {
      const shadow = typeof props.shadow === "number" ? props.shadow : undefined;
      ctx.ops.push({ op: "rect", x, y, w, h, r: radius2, color: fill, ...shadow ? { shadow } : {} });
    }
    const stroke = roleColor(ctx, props.borderColor);
    if (stroke !== undefined) {
      const width = dimension(props, "borderWidth") ?? 3;
      ctx.ops.push({ op: "outline", x, y, w, h, r: radius2, color: stroke, width });
    }
    placeChildren(ctx, decorationLayout(ctx, node, withDimensions(bounds, props), pad), x, y);
    return h;
  }
  if (kind === IconKind) {
    const size = dimension(props, "size") ?? 24;
    const glyph = typeof props.glyph === "string" ? props.glyph : "";
    ctx.ops.push({
      op: "text",
      x: x + (w - textWidth(glyph, size)) / 2,
      y: y + h / 2 + size * 0.36,
      text: glyph,
      size,
      weight: 600,
      color: roleColor(ctx, props.color) ?? ctx.palette.onSurface
    });
    return h;
  }
  if (kind === WrapKind) {
    const flow = layoutWrapChildren(ctx, node, bounds.maxW);
    let cursorY = y;
    for (const line of flow.lines) {
      let cursorX = x;
      for (const entry of line.entries) {
        place(ctx, entry.kid, cursorX, cursorY, entry.frame);
        cursorX += entry.frame.w + flow.spacing;
      }
      cursorY += line.height + flow.runSpacing;
    }
    return h;
  }
  if (typeof kind === "symbol") {
    placeChildren(ctx, decorationLayout(ctx, node, bounds), x, y);
    return h;
  }
  switch (kind) {
    case "text": {
      const ty = typography(ctx, props.variant);
      const maxWrapWidth = Math.max(w, bounds.maxW);
      const { lines } = layoutTextLines(props, textContent(node), ty, maxWrapWidth);
      const align = props.align === "center" ? "center" : "left";
      const boxWidth = typeof props.width === "number" ? props.width : w;
      lines.forEach((line, index) => {
        const lineWidth = textWidth(line, ty.size);
        const lineX = align === "center" ? x + Math.max((boxWidth - lineWidth) / 2, 0) : x;
        ctx.ops.push({
          op: "text",
          x: lineX,
          y: y + index * ty.lineHeight + ty.lineHeight * 0.78,
          text: line,
          size: ty.size,
          weight: ty.weight,
          color: roleColor(ctx, props.color) ?? ctx.theme.colors?.text ?? "#F2F2F7"
        });
      });
      if (ctx.absorbedText === 0) {
        const text = textContent(node);
        if (text.length > 0) {
          ctx.semantics.push({
            id: semanticId(props.semanticsId, { x, y, w, h }),
            role: props.variant === "title" || props.variant === "headline" || props.variant === "display" ? "header" : "text",
            label: text,
            bounds: { x, y, w, h }
          });
        }
      }
      return h;
    }
    case "button": {
      const ty = typography(ctx, "body");
      const label = textContent(node) || "Button";
      const variant = typeof props.variant === "string" ? props.variant : "primary";
      const palette = ctx.theme.colors ?? {};
      const accent = palette.accent ?? "#4C8DFF";
      const danger = palette.danger ?? "#FF5A5F";
      const r = 32;
      const onPrimary = ctx.palette.onPrimary;
      const container = palette.primaryContainer ?? "#223354";
      const onContainer = palette.onPrimaryContainer ?? "#D6E4FF";
      let fill = accent;
      let labelColor = onPrimary;
      let stroked = false;
      let shadow;
      if (variant === "secondary") {
        fill = null;
        stroked = true;
        labelColor = accent;
      } else if (variant === "tonal") {
        fill = container;
        labelColor = onContainer;
      } else if (variant === "text") {
        fill = null;
        labelColor = accent;
      } else if (variant === "danger") {
        fill = danger;
      } else {
        shadow = 10;
      }
      if (fill !== null) {
        ctx.ops.push({ op: "rect", x, y, w, h, r, color: fill, ...shadow ? { shadow } : {} });
      } else if (stroked) {
        ctx.ops.push({ op: "outline", x, y, w, h, r, color: accent, width: 3 });
      }
      ctx.ops.push({
        op: "text",
        x: x + (w - textWidth(label, ty.size)) / 2,
        y: y + h / 2 + ty.size * 0.36,
        text: label,
        size: ty.size,
        weight: 600,
        color: labelColor
      });
      if (typeof props.onPress === "function") {
        const tapId = addTap(ctx, x, y, w, h, props.onPress);
        ctx.semantics.push({
          id: semanticId(props.semanticsId, { x, y, w, h }),
          role: "button",
          label,
          bounds: { x, y, w, h },
          actions: [{ name: "press", tapId }]
        });
      } else {
        ctx.semantics.push({
          id: semanticId(props.semanticsId, { x, y, w, h }),
          role: "button",
          label,
          state: { disabled: true },
          bounds: { x, y, w, h }
        });
      }
      return h;
    }
    case "card": {
      const pad = paddingOf(ctx, props, 16);
      const elevated = props.background === "surface" || props.elevation === true;
      ctx.ops.push({
        op: "rect",
        x,
        y,
        w,
        h,
        r: radius(ctx, props.radius, 14),
        color: roleColor(ctx, props.background) ?? ctx.theme.colors?.surfaceRaised ?? "#1C1C24",
        ...elevated ? { shadow: 12 } : {}
      });
      placeChildren(ctx, decorationLayout(ctx, node, bounds, pad, spacing(ctx, "sm", 8)), x, y);
      const sem = props.semantics;
      if (sem !== undefined && sem !== null && typeof sem === "object") {
        ctx.semantics.push({
          id: semanticId(sem.id, { x, y, w, h }),
          role: sem.role ?? "container",
          ...typeof sem.label === "string" ? { label: sem.label } : {},
          ...typeof sem.hint === "string" ? { hint: sem.hint } : {},
          ...sem.liveRegion === true || sem.role === "alert" ? { liveRegion: true } : {},
          bounds: { x, y, w, h }
        });
      }
      return h;
    }
    case "column":
    case "row": {
      placeChildren(ctx, flexLayout(ctx, node, bounds, kind), x, y);
      return h;
    }
    case "app-bar": {
      ctx.ops.push({ op: "rect", x, y, w, h, r: 0, color: ctx.theme.colors?.surface ?? "#101014" });
      const hasMenu = typeof props.onMenu === "function";
      const titleX = hasMenu ? 100 : 40;
      let menuTapId;
      if (hasMenu) {
        ctx.ops.push({ op: "text", x: x + 36, y: y + 62, text: "☰", size: Math.round(34 * ctx.textScale * 100) / 100, weight: 600, color: ctx.theme.colors?.text ?? "#F2F2F7" });
        menuTapId = addTap(ctx, x + 12, y + 12, 72, 72, props.onMenu);
      }
      const title = typeof props.title === "string" ? props.title : "";
      ctx.ops.push({
        op: "text",
        x: x + titleX,
        y: y + 62,
        text: title,
        size: Math.round(32 * ctx.textScale * 100) / 100,
        weight: 700,
        color: ctx.theme.colors?.text ?? "#F2F2F7"
      });
      ctx.ops.push({
        op: "line",
        x1: x,
        y1: y + 94,
        x2: x + w,
        y2: y + 94,
        color: ctx.theme.colors?.outlineVariant ?? "#26262F",
        width: 2
      });
      if (title.length > 0) {
        ctx.semantics.push({
          id: semanticId(props.semanticsId, { x: x + titleX, y, w: Math.max(w - titleX, 0), h }),
          role: "header",
          label: title,
          bounds: { x: x + titleX, y, w: Math.max(w - titleX, 0), h }
        });
      }
      if (menuTapId !== undefined) {
        ctx.semantics.push({
          id: `${semanticId(props.semanticsId, { x, y, w, h })}#menu`,
          role: "button",
          label: "Menu",
          bounds: { x: x + 12, y: y + 12, w: 72, h: 72 },
          actions: [{ name: "press", tapId: menuTapId }]
        });
      }
      return h;
    }
    case "spacer":
      return h;
    case "scaffold": {
      ctx.ops.push({ op: "rect", x, y, w, h, r: 0, color: ctx.theme.colors?.surface ?? "#101014" });
      placeChildren(ctx, scaffoldLayout(ctx, node, bounds), x, y);
      return h;
    }
    default:
      return 0;
  }
}
function offsetOp(op, dx, dy, defaults = {}) {
  if (op.op === "scroll-region") {
    return { ...op, x: op.x + dx, y: op.y + dy };
  }
  const explicitlyFixed = op.fixed !== undefined;
  const fixed = op.fixed ?? defaults.fixed === true;
  const anchor = op.anchor ?? (!explicitlyFixed && fixed ? defaults.anchor : undefined);
  const anchorSize = op.anchorSize ?? (!explicitlyFixed && fixed ? defaults.anchorSize : undefined);
  const meta = fixed ? { fixed: true, ...anchor ? { anchor } : {}, ...anchorSize !== undefined ? { anchorSize } : {} } : {};
  switch (op.op) {
    case "circle":
      return fixed ? { ...op, ...meta, cx: op.cx, cy: op.cy } : { ...op, cx: op.cx + dx, cy: op.cy + dy };
    case "ring":
      return fixed ? { ...op, ...meta, cx: op.cx, cy: op.cy } : { ...op, cx: op.cx + dx, cy: op.cy + dy };
    case "line":
      return fixed ? { ...op, ...meta, x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2 } : { ...op, x1: op.x1 + dx, y1: op.y1 + dy, x2: op.x2 + dx, y2: op.y2 + dy };
    case "text": {
      const clip = op.clip === undefined ? undefined : validateTextClip(op.clip);
      const moved = fixed ? { ...op, ...meta, x: op.x, y: op.y } : { ...op, x: op.x + dx, y: op.y + dy };
      return clip === undefined ? moved : {
        ...moved,
        clip: { ...clip, x: clip.x + (fixed ? 0 : dx), y: clip.y + (fixed ? 0 : dy) }
      };
    }
    default:
      return fixed ? { ...op, ...meta, x: op.x, y: op.y } : { ...op, x: op.x + dx, y: op.y + dy };
  }
}
function roleColor(ctx, token) {
  if (isColorRefValue(token)) {
    if (ctx.slotScopes.length > 0)
      return resolveSlotRef(ctx, token);
    ctx.usedRefs = true;
    return token;
  }
  if (typeof token !== "string")
    return;
  if (token.startsWith("#"))
    return token;
  const byRole = ctx.palette[token];
  if (typeof byRole === "string")
    return byRole;
  const themed = ctx.theme.colors?.[token];
  if (typeof themed === "string")
    return themed;
  return;
}
function resolveSlotRef(ctx, ref) {
  for (let index = ctx.slotScopes.length - 1;index >= 0; index--) {
    const overlay = ctx.slotScopes[index];
    const scoped = overlay[ref.slot];
    if (typeof scoped === "string")
      return scoped;
  }
  const value = ctx.slotPalette?.[ref.slot];
  if (typeof value !== "string") {
    throw new LayoutError("INVALID_COLOR_REF", `color slot "${ref.slot}" has no palette value (pass layoutScreen a palette or add the slot to one)`);
  }
  return value;
}
var STACK_ALIGNMENT = {
  topLeft: { ax: 0, ay: 0 },
  topCenter: { ax: 0.5, ay: 0 },
  topRight: { ax: 1, ay: 0 },
  centerLeft: { ax: 0, ay: 0.5 },
  center: { ax: 0.5, ay: 0.5 },
  centerRight: { ax: 1, ay: 0.5 },
  bottomLeft: { ax: 0, ay: 1 },
  bottomCenter: { ax: 0.5, ay: 1 },
  bottomRight: { ax: 1, ay: 1 }
};
function layoutWrapChildren(ctx, node, maxWidth) {
  const spacingValue = spacing(ctx, node.props.spacing, 8);
  const runSpacing = spacing(ctx, node.props.runSpacing, 8);
  const lines = [];
  let entries = [];
  let lineWidth = 0;
  const flush = () => {
    if (entries.length === 0)
      return;
    lines.push({
      entries,
      width: lineWidth,
      height: Math.max(...entries.map((entry) => entry.frame.h), 0)
    });
    entries = [];
    lineWidth = 0;
  };
  for (const kid of childNodes(node)) {
    const frame = measure(ctx, kid, maxWidth);
    if (entries.length > 0 && lineWidth + spacingValue + frame.w > maxWidth)
      flush();
    lineWidth += (entries.length > 0 ? spacingValue : 0) + frame.w;
    entries.push({ kid, frame });
  }
  flush();
  return {
    lines,
    width: lines.reduce((max, line) => Math.max(max, line.width), 0),
    height: lines.reduce((sum, line) => sum + line.height, 0) + runSpacing * Math.max(lines.length - 1, 0),
    spacing: spacingValue,
    runSpacing
  };
}
function crossAlignOf(props, fallback) {
  const value = props.align;
  if (value === "start" || value === "center" || value === "end" || value === "stretch")
    return value;
  return fallback;
}
function semanticId(id, b) {
  if (typeof id === "string" && id.length > 0)
    return id;
  return `sem@${b.x},${b.y},${b.w},${b.h}`;
}
function deepTextContent(node) {
  let out = "";
  for (const child of node.children) {
    if (typeof child === "string" || typeof child === "number")
      out += String(child);
    else if (isWidgetNode(child))
      out += deepTextContent(asNode(child));
  }
  return out;
}
function addTap(ctx, x, y, w, h, run, action = "tap", fixed = false, anchor, anchorSize) {
  const id = ctx.tapRuns.length;
  ctx.tapRuns.push(run);
  ctx.tapRegions.push({
    x,
    y,
    w,
    h,
    action,
    payload: { id },
    ...fixed ? { fixed: true } : {},
    ...fixed && anchor ? { anchor } : {},
    ...fixed && anchorSize !== undefined ? { anchorSize } : {}
  });
  return id;
}
function layoutScreen(theme, tree, viewportOrWidth = DESIGN_WIDTH, textInput, options) {
  const viewport = typeof viewportOrWidth === "number" ? undefined : validateLayoutViewport(viewportOrWidth);
  const designWidth = typeof viewportOrWidth === "number" ? viewportOrWidth : viewport.width;
  if (!Number.isFinite(designWidth) || designWidth <= 0) {
    throw new LayoutError("INVALID_VIEWPORT", "Design width must be a positive finite number");
  }
  const locale = options?.locale !== undefined ? validateLocale(options.locale, "options.locale") : "en-US";
  const textScale = options?.textScale !== undefined ? validateTextScale(options.textScale, "options.textScale") : 1;
  const platform = options?.platform !== undefined ? validatePlatform(options.platform, "options.platform") : "android";
  const ctx = {
    theme,
    designWidth,
    palette: resolveRoles(theme),
    slotPalette: options?.palette,
    slotScopes: [],
    tokens: buildTokenSet(theme),
    tokenScopes: [],
    locale,
    textScale,
    platform,
    usedRefs: false,
    ops: [],
    tapRegions: [],
    tapRuns: [],
    semantics: [],
    absorbedText: 0,
    textFields: [],
    textFieldIds: new Set,
    textInput,
    componentCache: new Map,
    finish() {
      return {
        tenun: "display-list",
        version: 1,
        designWidth,
        contentHeight: 0,
        background: theme.colors?.surface ?? "#101014",
        ops: ctx.ops,
        taps: ctx.tapRegions,
        semantics: {
          semanticsVersion: 1,
          nodes: ctx.semantics
        }
      };
    }
  };
  const root = resolveNode(ctx, asNode(tree));
  const explicitRootWidth = root.kind === SizedBoxKind || (root.kind === ContainerKind || root.kind === Canvas) && typeof root.props.width === "number";
  const bounds = viewport ? tight({ w: viewport.width, h: viewport.height }) : { minW: explicitRootWidth ? 0 : designWidth, maxW: designWidth, minH: 0, maxH: Infinity };
  const frame = measure(ctx, root, bounds);
  place(ctx, root, 0, 0, frame);
  const scene = ctx.finish();
  scene.contentHeight = frame.h;
  let semanticScene;
  if (ctx.usedRefs) {
    semanticScene = { ...scene, ops: scene.ops.slice() };
    scene.ops = bakeRetainedRefs(scene.ops, ctx);
  }
  return { scene, ...semanticScene !== undefined ? { semanticScene } : {}, tapRuns: ctx.tapRuns, textFields: ctx.textFields };
}
function bakeRetainedRefs(ops, ctx) {
  return ops.map((op) => {
    if (op.op === "scroll-region") {
      return { ...op, ops: bakeRetainedRefs([...op.ops], ctx) };
    }
    let baked = op;
    for (const field of ["color", "colorTo", "track"]) {
      const value = op[field];
      if (isColorRefValue(value)) {
        if (baked === op)
          baked = { ...op };
        baked[field] = resolveSlotRef(ctx, value);
      }
    }
    return baked;
  });
}
// packages/widgets/src/app-runtime.ts
var APPLICATION_STATE_SCHEMA = 1;
var BACK_STACK_CAP = 64;

class ApplicationRuntimeError extends Error {
  code;
  constructor(code, message) {
    super(`[TENUN_APP_ERROR] ${message}`);
    this.name = "ApplicationRuntimeError";
    this.code = code;
  }
}
function isThenable(value) {
  return typeof value === "object" && value !== null && typeof value.then === "function";
}
function createAbortSource() {
  if (typeof AbortController === "function") {
    return new AbortController;
  }
  const listeners = new Set;
  const signal = {
    aborted: false,
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    }
  };
  return {
    signal,
    abort() {
      if (signal.aborted)
        return;
      signal.aborted = true;
      for (const listener of [...listeners])
        listener();
    }
  };
}

class ApplicationRuntime {
  screens;
  theme;
  slotPalette;
  locale;
  textScale;
  platform;
  services;
  designWidth;
  viewport;
  imeInset = 0;
  backStack = [];
  onAsyncActionError;
  abort = createAbortSource();
  sessions = new Map;
  stateChannels = new Map;
  current;
  lastTapRuns = [];
  textFields = new Map;
  activeTextInput;
  nextTextSessionId = 1;
  staleListeners = new Set;
  pendingTransition = null;
  disposedState = false;
  constructor(options) {
    if (!options || typeof options !== "object") {
      throw new ApplicationRuntimeError("INVALID_INITIAL_SCREEN", "runtime options are required");
    }
    if (!options.screens || typeof options.screens !== "object") {
      throw new ApplicationRuntimeError("INVALID_INITIAL_SCREEN", "runtime requires a screens registry");
    }
    if (!(options.initial in options.screens)) {
      throw new ApplicationRuntimeError("INVALID_INITIAL_SCREEN", `initial route "${options.initial}" is not a registered screen`);
    }
    if (options.viewport !== undefined && options.designWidth !== undefined) {
      throw new LayoutError("INVALID_VIEWPORT", "ApplicationRuntime requires either viewport or designWidth, not both");
    }
    const viewport = options.viewport === undefined ? undefined : validateLayoutViewport(options.viewport);
    this.screens = options.screens;
    this.theme = options.theme;
    this.slotPalette = options.palette;
    this.locale = options.locale !== undefined ? validateLocale(options.locale, "runtime options.locale") : "en-US";
    this.textScale = options.textScale !== undefined ? validateTextScale(options.textScale, "runtime options.textScale") : 1;
    this.platform = options.platform !== undefined ? validatePlatform(options.platform, "runtime options.platform") : "android";
    this.services = { ...options.services ?? {} };
    this.designWidth = options.designWidth;
    this.viewport = viewport;
    this.onAsyncActionError = options.onAsyncActionError;
    this.current = options.initial;
    this.sessions.set(options.initial, this.mount(options.initial));
  }
  route() {
    return this.current;
  }
  routes() {
    return Object.keys(this.screens);
  }
  get disposed() {
    return this.disposedState;
  }
  stateSchema() {
    return APPLICATION_STATE_SCHEMA;
  }
  setViewport(viewport) {
    this.assertLive();
    const next = validateLayoutViewport(viewport);
    if (this.viewport?.width === next.width && this.viewport.height === next.height)
      return;
    this.viewport = next;
    this.lastTapRuns = [];
    this.notifyStale();
  }
  setImeInset(inset2) {
    this.assertLive();
    if (typeof inset2 !== "number" || !Number.isFinite(inset2) || inset2 < 0) {
      throw new ApplicationRuntimeError("INVALID_INSET", "IME inset must be a finite nonnegative number");
    }
    if (this.imeInset === inset2)
      return;
    this.imeInset = inset2;
    this.lastTapRuns = [];
    this.notifyStale();
  }
  setTheme(theme) {
    this.assertLive();
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
      throw new ApplicationRuntimeError("INVALID_THEME", "theme must be an object");
    }
    if (theme.colors !== undefined && (typeof theme.colors !== "object" || Array.isArray(theme.colors))) {
      throw new ApplicationRuntimeError("INVALID_THEME", "theme.colors must be an object");
    }
    this.theme = theme;
    this.notifyStale();
  }
  setPalette(palette) {
    this.assertLive();
    if (!palette || typeof palette !== "object" || Array.isArray(palette)) {
      throw new ApplicationRuntimeError("INVALID_THEME", "palette must be an object");
    }
    this.slotPalette = palette;
    this.notifyStale();
  }
  getLocale() {
    return this.locale;
  }
  setLocale(locale) {
    this.assertLive();
    this.locale = validateLocale(locale, "setLocale");
    this.notifyStale();
  }
  getTextScale() {
    return this.textScale;
  }
  setTextScale(scale) {
    this.assertLive();
    this.textScale = validateTextScale(scale, "setTextScale");
    this.notifyStale();
  }
  getPlatform() {
    return this.platform;
  }
  setPlatform(platform) {
    this.assertLive();
    this.platform = validatePlatform(platform, "setPlatform");
    this.notifyStale();
  }
  getWidgetContext() {
    return Object.freeze({
      theme: this.theme,
      tokens: buildTokenSet(this.theme),
      palette: resolveRoles(this.theme),
      slotPalette: this.slotPalette,
      locale: this.locale,
      textScale: this.textScale,
      platform: this.platform
    });
  }
  setEnvironment(environment) {
    this.assertLive();
    if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
      throw new ApplicationRuntimeError("INVALID_THEME", "environment must be an object");
    }
    const locale = environment.locale !== undefined ? validateLocale(environment.locale, "environment.locale") : this.locale;
    const textScale = environment.textScale !== undefined ? validateTextScale(environment.textScale, "environment.textScale") : this.textScale;
    const platform = environment.platform !== undefined ? validatePlatform(environment.platform, "environment.platform") : this.platform;
    const changed = locale !== this.locale || textScale !== this.textScale || platform !== this.platform;
    this.locale = locale;
    this.textScale = textScale;
    this.platform = platform;
    if (changed)
      this.notifyStale();
  }
  endTransitionBurst() {
    this.pendingTransition = null;
  }
  navigate(name, options) {
    this.assertLive();
    if (!(name in this.screens)) {
      throw new ApplicationRuntimeError("UNKNOWN_SCREEN", `unknown screen "${name}"`);
    }
    this.pendingTransition = options?.transition === undefined ? null : normalizeSceneTransition(options.transition);
    if (this.current !== name) {
      this.endTextInput();
      this.backStack.push(this.current);
      if (this.backStack.length > BACK_STACK_CAP)
        this.backStack.shift();
    }
    this.current = name;
    this.activateRoute(name);
  }
  activateRoute(name) {
    if (!this.sessions.has(name))
      this.sessions.set(name, this.mount(name));
    this.lastTapRuns = [];
    this.textFields.clear();
    if (this.stateChannels.size > 0) {
      const session = this.sessions.get(name);
      let delivered = false;
      for (const [channel, input] of this.stateChannels) {
        const action = session.actions[channel];
        if (typeof action === "function") {
          action(input);
          delivered = true;
        }
      }
      if (delivered)
        this.notifyStale();
    }
  }
  canGoBack() {
    this.assertLive();
    return this.backStack.length > 0;
  }
  goBack() {
    this.assertLive();
    const origin = this.backStack.pop();
    if (origin === undefined)
      return false;
    this.pendingTransition = null;
    if (this.current !== origin)
      this.endTextInput();
    this.current = origin;
    this.activateRoute(origin);
    this.notifyStale();
    return true;
  }
  render() {
    this.assertLive();
    const session = this.sessions.get(this.current) ?? this.mount(this.current);
    this.sessions.set(this.current, session);
    const rootCtx = this.getWidgetContext();
    const tree = withWidgetContext(rootCtx, () => this.screens[session.name].view({
      state: session.state,
      actions: session.actions
    }, rootCtx));
    if (tree === null || tree === undefined) {
      throw new ApplicationRuntimeError("INVALID_VIEW", `screen "${session.name}" produced a null view`);
    }
    const base = this.viewport ?? this.designWidth;
    const effective = this.imeInset > 0 && typeof base === "object" ? { width: base.width, height: Math.max(1, base.height - this.imeInset) } : base;
    const { scene, semanticScene, tapRuns, textFields } = layoutScreen(this.theme, tree, effective, {
      active: this.activeTextInput,
      focus: (id) => this.focusTextInput(id)
    }, {
      palette: this.slotPalette,
      locale: this.locale,
      textScale: this.textScale,
      platform: this.platform
    });
    this.textFields = new Map(textFields.map((binding) => [binding.props.id, binding]));
    const focused = textFields.find((binding) => binding.descriptor.focused)?.descriptor;
    this.activeTextInput = focused ? {
      id: focused.id,
      sessionId: focused.sessionId,
      revision: focused.revision,
      text: focused.text,
      selection: focused.selection,
      composing: focused.composing
    } : undefined;
    this.lastTapRuns = tapRuns;
    if (this.pendingTransition !== null) {
      scene.transition = this.pendingTransition;
    }
    return semanticScene !== undefined ? { scene, semanticScene, tapRuns } : { scene, tapRuns };
  }
  dispatch(action, payload) {
    this.assertLive();
    const normalized = action.toUpperCase();
    if (normalized === "__TENUN_EXPORT")
      return;
    if (normalized === "TENUN_RESTORE") {
      this.restore(payload);
      return;
    }
    if (normalized === "TEXT_EDIT") {
      const edit = validateTextEditEvent(payload);
      this.render();
      const field = this.requireTextInput(edit);
      const contentError = numericDraftError(field.props.keyboardType, edit.text);
      if (contentError !== null)
        throw new TextInputError("INVALID_TEXT_CONTENT", contentError);
      const previous = this.activeTextInput;
      const next = {
        id: edit.id,
        sessionId: edit.sessionId,
        revision: nextTextRevision(previous.revision),
        text: edit.text,
        selection: edit.selection,
        composing: edit.composing
      };
      this.activeTextInput = next;
      if (edit.text !== previous.text) {
        try {
          field.props.onChanged(edit.text);
        } catch (error) {
          if (this.activeTextInput === next)
            this.activeTextInput = previous;
          throw error;
        }
      }
      return;
    }
    if (normalized === "TEXT_BLUR" || normalized === "TEXT_SUBMIT") {
      const identity = validateTextInputIdentity(payload);
      this.render();
      const field = this.requireTextInput(identity);
      this.endTextInput();
      if (normalized === "TEXT_SUBMIT") {
        const originRoute = this.current;
        field.props.onSubmitted?.();
        if (field.props.inputAction === "next" && this.current === originRoute) {
          this.render();
          this.transferTextInputFocus(field.props.id);
        }
      }
      return;
    }
    if (normalized === "TAP" || normalized === "LONG-PRESS") {
      const id = typeof payload === "number" ? payload : typeof payload?.id === "number" ? payload.id : NaN;
      if (!Number.isInteger(id) || id < 0 || id >= this.lastTapRuns.length) {
        throw new ApplicationRuntimeError("TAP_TARGET_UNKNOWN", `tap payload ${JSON.stringify(payload ?? null)} does not name a run in the current scene (${this.lastTapRuns.length} runs)`);
      }
      this.lastTapRuns[id]();
      return;
    }
    throw new ApplicationRuntimeError("UNKNOWN_ACTION", `unknown dispatch verb "${action}"`);
  }
  focusTextInput(id) {
    this.assertLive();
    const field = this.textFields.get(id);
    if (!field || field.props.readOnly) {
      throw new TextInputError("STALE_TEXT_SESSION", `TextField "${id}" is not editable in the current scene`);
    }
    if (this.activeTextInput?.id === id)
      return;
    const sessionId = this.nextTextSessionId;
    if (!Number.isSafeInteger(sessionId)) {
      throw new TextInputError("INVALID_TEXT_EDIT", "Text input session identities are exhausted");
    }
    this.nextTextSessionId++;
    const text = field.props.value;
    this.activeTextInput = {
      id,
      sessionId,
      revision: 0,
      text,
      selection: { base: text.length, extent: text.length },
      composing: null
    };
    this.notifyStale();
  }
  focusTextField(id) {
    this.assertLive();
    const field = this.textFields.get(id);
    if (!field || field.props.readOnly)
      return;
    this.focusTextInput(id);
  }
  transferTextInputFocus(fromId) {
    this.assertLive();
    const ids = [...this.textFields.keys()];
    const origin = ids.indexOf(fromId);
    if (origin < 0)
      return;
    for (let cursor = origin + 1;cursor < ids.length; cursor++) {
      const candidate = this.textFields.get(ids[cursor]);
      if (candidate && !candidate.props.readOnly) {
        this.focusTextInput(ids[cursor]);
        return;
      }
    }
  }
  requireTextInput(identity) {
    const active = this.activeTextInput;
    const field = this.textFields.get(identity.id);
    if (!active || active.id !== identity.id || active.sessionId !== identity.sessionId || !field || field.props.readOnly) {
      throw new TextInputError("STALE_TEXT_SESSION", "Text input callback belongs to an ended or different session");
    }
    if (active.revision !== identity.baseRevision) {
      throw new TextInputError("STALE_TEXT_REVISION", "Text input callback does not match the authoritative revision");
    }
    return field;
  }
  endTextInput() {
    this.activeTextInput = undefined;
  }
  push(channel, input) {
    this.assertLive();
    this.deliverTo(this.current, channel, input);
  }
  pushState(channel, input) {
    this.assertLive();
    this.stateChannels.set(channel, input);
    this.deliverTo(this.current, channel, input);
  }
  pushTo(screen, channel, input) {
    this.assertLive();
    this.deliverTo(screen, channel, input);
  }
  deliverTo(target, channel, input) {
    const session = this.sessions.get(target);
    if (!session)
      return;
    const action = session.actions[channel];
    if (typeof action !== "function")
      return;
    action(input);
    this.notifyStale();
  }
  exportState() {
    this.assertLive();
    const states = {};
    for (const [name, session] of this.sessions)
      states[name] = session.state;
    return { route: this.current, states, stateSchema: APPLICATION_STATE_SCHEMA };
  }
  restore(snapshot, options = {}) {
    this.assertLive();
    if (!snapshot || typeof snapshot !== "object") {
      throw new ApplicationRuntimeError("SNAPSHOT_INVALID", "snapshot must be an object");
    }
    if (snapshot.stateSchema === undefined) {
      throw new ApplicationRuntimeError("SNAPSHOT_INVALID", "snapshot is missing stateSchema — export via exportState() before restoring");
    }
    if (snapshot.stateSchema !== APPLICATION_STATE_SCHEMA) {
      throw new ApplicationRuntimeError("SNAPSHOT_SCHEMA_MISMATCH", `snapshot stateSchema ${String(snapshot.stateSchema)} does not match runtime schema ${APPLICATION_STATE_SCHEMA}`);
    }
    if (snapshot.route !== undefined && typeof snapshot.route !== "string") {
      throw new ApplicationRuntimeError("SNAPSHOT_INVALID", "snapshot.route must be a string");
    }
    const ignoreUnknown = options.ignoreUnknownScreens === true;
    const states = snapshot.states;
    if (states !== undefined && (!states || typeof states !== "object")) {
      throw new ApplicationRuntimeError("SNAPSHOT_INVALID", "snapshot.states must be an object");
    }
    if (states !== undefined) {
      for (const name of Object.keys(states)) {
        if (!(name in this.screens) && !ignoreUnknown) {
          throw new ApplicationRuntimeError("UNKNOWN_SCREEN", `snapshot references unknown screen "${name}"`);
        }
      }
    }
    if (typeof snapshot.route === "string" && !(snapshot.route in this.screens) && !ignoreUnknown) {
      throw new ApplicationRuntimeError("UNKNOWN_SCREEN", `snapshot route "${snapshot.route}" is not a registered screen`);
    }
    if (states !== undefined) {
      for (const name of Object.keys(states)) {
        if (name in this.screens) {
          this.sessions.set(name, this.mount(name, states[name]));
        }
      }
    }
    if (typeof snapshot.route === "string" && snapshot.route in this.screens) {
      this.current = snapshot.route;
    }
    this.lastTapRuns = [];
    this.textFields.clear();
    this.endTextInput();
  }
  onStateInvalidation(listener) {
    this.staleListeners.add(listener);
    return () => {
      this.staleListeners.delete(listener);
    };
  }
  dispose() {
    if (this.disposedState)
      return;
    this.endTextInput();
    this.textFields.clear();
    this.lastTapRuns = [];
    this.abort.abort();
    this.disposedState = true;
  }
  assertLive() {
    if (this.disposedState) {
      throw new ApplicationRuntimeError("RUNTIME_DISPOSED", "runtime has been disposed");
    }
  }
  notifyStale() {
    if (this.disposedState)
      return;
    for (const listener of [...this.staleListeners])
      listener();
  }
  mount(name, restoredState) {
    const screen = this.screens[name];
    const controller = "controller" in screen ? screen.controller : screen;
    const state = restoredState !== undefined ? restoredState : controller.initialState();
    const actions = {};
    for (const key of Object.keys(controller.actions)) {
      actions[key] = (input) => {
        if (this.disposedState) {
          throw new ApplicationRuntimeError("RUNTIME_DISPOSED", `action "${key}" ran against a disposed runtime`);
        }
        const handler = controller.actions[key];
        const context = {
          input,
          state,
          services: this.services,
          signal: this.abort.signal
        };
        const result = typeof handler === "function" ? handler(context) : handler.run(context);
        if (isThenable(result)) {
          result.then(() => {
            this.notifyStale();
          }, (error) => {
            this.notifyStale();
            if (this.onAsyncActionError) {
              this.onAsyncActionError({ screen: name, action: key, error });
            } else {
              throw error;
            }
          });
        }
      };
    }
    if (restoredState === undefined) {
      const load = controller.load;
      if (typeof load === "function") {
        const loaded = load({
          state,
          services: this.services,
          signal: this.abort.signal
        });
        if (isThenable(loaded)) {
          loaded.then(() => {
            this.notifyStale();
          }, (error) => {
            this.notifyStale();
            if (this.onAsyncActionError) {
              this.onAsyncActionError({ screen: name, action: "load", error });
            } else {
              throw error;
            }
          });
        }
      }
    }
    return { name, state, actions };
  }
}
// packages/widgets/src/host-handoff.ts
function withoutTransition(sceneJson) {
  const parsed = JSON.parse(sceneJson);
  if (parsed.transition === undefined)
    return sceneJson;
  const { transition: _omit, ...rest } = parsed;
  return JSON.stringify(rest);
}
function installHostHandoff(options) {
  const { app } = options;
  let last = null;
  const commit = () => {
    const json = JSON.stringify(app.render().scene);
    last = json;
    if (typeof options.commit === "function") {
      options.commit(json);
    }
  };
  const dispatch = (action, payloadJson) => {
    let payload = {};
    try {
      payload = JSON.parse(payloadJson || "{}");
    } catch {
      payload = {};
    }
    const normalized = action.toUpperCase();
    try {
      return dispatchInBurst(normalized, payload);
    } finally {
      app.endTransitionBurst?.();
    }
  };
  const dispatchInBurst = (normalized, payload) => {
    if (normalized === "__TENUN_EXPORT") {
      return JSON.stringify(app.exportState());
    }
    if (normalized === "__TENUN_STATE_SCHEMA") {
      return JSON.stringify({ stateSchema: app.stateSchema() });
    }
    if (normalized === "VIEWPORT") {
      if (typeof app.setViewport === "function") {
        app.setViewport(payload);
      } else {
        app.dispatch(normalized, payload);
      }
      return JSON.stringify({ route: app.route() });
    }
    if (normalized === "ENVIRONMENT") {
      if (typeof app.setEnvironment === "function") {
        app.setEnvironment(payload);
      } else {
        app.dispatch(normalized, payload);
      }
      return JSON.stringify({ route: app.route() });
    }
    if (normalized === "INSET") {
      const inset2 = typeof payload?.ime === "number" ? payload.ime : Number.NaN;
      const beforeCommit = last;
      if (typeof app.setImeInset === "function") {
        app.setImeInset(inset2);
        if (last === beforeCommit)
          commit();
      } else {
        app.dispatch(normalized, payload);
        if (last === beforeCommit)
          commit();
      }
      return JSON.stringify({ route: app.route() });
    }
    if (normalized === "BACK") {
      if (typeof app.goBack === "function") {
        const handled = app.goBack();
        if (handled)
          commit();
        return JSON.stringify({ handled, route: app.route() });
      }
      app.dispatch(normalized, payload);
      return JSON.stringify({ route: app.route() });
    }
    const textInput = normalized === "TEXT_EDIT" || normalized === "TEXT_BLUR" || normalized === "TEXT_SUBMIT";
    try {
      app.dispatch(normalized, payload);
    } catch (error) {
      if (textInput && error instanceof TextInputError && (error.code === "STALE_TEXT_SESSION" || error.code === "STALE_TEXT_REVISION" || error.code === "INVALID_TEXT_CONTENT")) {
        const fresh = JSON.stringify(app.render().scene);
        const emit = last !== null && withoutTransition(fresh) === withoutTransition(last) ? last : fresh;
        last = emit;
        if (typeof options.commit === "function")
          options.commit(emit);
      }
      throw error;
    }
    if (normalized === "TAP" || normalized === "LONG-PRESS" || normalized === "TENUN_RESTORE" || textInput)
      commit();
    return JSON.stringify({ route: app.route() });
  };
  const unsubscribe = app.onStateInvalidation?.(() => {
    commit();
  });
  commit();
  return {
    dispatch,
    lastScene: () => last,
    dispose() {
      unsubscribe?.();
    }
  };
}
// packages/widgets/src/theme-slots.ts
var SEMANTIC_COLOR_SLOTS = Object.freeze([
  "background",
  "onBackground",
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondaryContainer",
  "onSecondaryContainer",
  "surface",
  "surfaceContainer",
  "surfaceContainerHigh",
  "onSurface",
  "onSurfaceVariant",
  "outline",
  "outlineVariant",
  "error",
  "onError",
  "success",
  "onSuccess",
  "warning",
  "onWarning",
  "inverseSurface",
  "onInverseSurface",
  "onPrimaryFixed"
]);
var slots = new Set(SEMANTIC_COLOR_SLOTS);

// packages/widgets/src/index.ts
function defineTheme(theme) {
  return Object.freeze(JSON.parse(JSON.stringify(theme)));
}
function Scaffold(props) {
  const children = [];
  if (props.appBar)
    children.push(props.appBar);
  if (props.children)
    children.push(props.children);
  return jsx(HostWidgetKind.SCAFFOLD, { children });
}
function Column(props) {
  return jsx(HostWidgetKind.COLUMN, props);
}
function Row(props) {
  return jsx(HostWidgetKind.ROW, props);
}
function Text(props) {
  return jsx(HostWidgetKind.TEXT, props);
}
function Button(props) {
  return jsx(HostWidgetKind.BUTTON, props);
}

// packages/platform/src/capability.ts
var unsupportedFailure = (capability, reason) => ({
  kind: "unsupported",
  message: reason ?? `${capability}: this host does not implement the capability`
});
// packages/platform/src/storage.ts
var STORAGE_PERMISSIONS = [];
// packages/platform/src/media.ts
var fail2 = (failure) => Promise.resolve({ ok: false, failure });
function unsupportedMedia(reason) {
  return {
    contractVersion: 1,
    prepare: () => fail2(unsupportedFailure("media", reason)),
    play: () => fail2(unsupportedFailure("media", reason)),
    pause: () => fail2(unsupportedFailure("media", reason)),
    stop: () => fail2(unsupportedFailure("media", reason)),
    setRect: () => fail2(unsupportedFailure("media", reason)),
    status: () => fail2(unsupportedFailure("media", reason)),
    fetchText: () => fail2(unsupportedFailure("media", reason))
  };
}
// packages/platform/src/host.ts
var fail3 = (failure) => Promise.resolve({ ok: false, failure });
function unsupportedStorage(reason) {
  return {
    contractVersion: 1,
    availability: () => ({ status: "unsupported", reason }),
    permissionPrerequisites: () => STORAGE_PERMISSIONS,
    get: () => fail3(unsupportedFailure("storage", reason)),
    set: () => fail3(unsupportedFailure("storage", reason)),
    remove: () => fail3(unsupportedFailure("storage", reason)),
    keys: () => fail3(unsupportedFailure("storage", reason))
  };
}
// examples/tvplayer/src/theme.ts
var tvTheme = defineTheme({
  colors: {
    background: "#0B0B0F",
    surface: "#111116",
    surfaceRaised: "#16161D",
    accent: "#1E6FEB",
    primaryContainer: "#1E6FEB",
    onPrimaryContainer: "#FFFFFF",
    secondaryContainer: "#1A2333",
    onSecondaryContainer: "#8FB8F5",
    outline: "#232330",
    outlineVariant: "#1B1B24",
    text: "#F4F5F7",
    textDim: "#8A8D98",
    danger: "#E5484D",
    success: "#46A758",
    warning: "#CCA700"
  },
  spacing: { sm: 8, md: 16, lg: 24, xl: 40 },
  typography: {
    display: { size: 64, lineHeight: 72, weight: 700 },
    headline: { size: 40, lineHeight: 48, weight: 700 },
    title: { size: 30, lineHeight: 38, weight: 700 },
    body: { size: 22, lineHeight: 30, weight: 400 },
    label: { size: 24, lineHeight: 32, weight: 600 },
    caption: { size: 18, lineHeight: 24, weight: 400 }
  }
});
var GROUP_COLORS = {
  Indonesia: "#C62828",
  Daerah: "#00695C",
  TVRI: "#1E6FEB",
  Internasional: "#E4572E",
  Film: "#5E35B1",
  Dokumenter: "#004D40",
  Religius: "#2E7D32",
  Musik: "#8E24AA",
  Olahraga: "#6BCB77",
  Sains: "#4D96FF",
  Lifestyle: "#8D6E63",
  Test: "#CCA700"
};
var GROUP_FALLBACK = "#4E5A6C";
function groupColor(group) {
  return GROUP_COLORS[group] ?? GROUP_FALLBACK;
}

// examples/tvplayer/src/layout.ts
var DESIGN_WIDTH2 = 960;
var GAP_SM = 8;
var DESIGN_HEIGHT = 540;
var RAIL_W = 72;
var PAD_SM = 16;
var SIDEBAR_W = 240;
var HEADER_H = 36;
var ROW_H = 40;
var SIDEBAR_VISIBLE = 6;
var HERO_X = RAIL_W + PAD_SM + SIDEBAR_W + GAP_SM;
var HERO_W = DESIGN_WIDTH2 - HERO_X - PAD_SM;
var HERO_H = 300;
var VIDEO_RECT = {
  x: HERO_X,
  y: PAD_SM,
  w: HERO_W,
  h: HERO_H
};
var DESIGN_WIDTH_PHONE = 390;
var VIDEO_RECT_PHONE = {
  x: 0,
  y: 0,
  w: DESIGN_WIDTH_PHONE,
  h: Math.round(DESIGN_WIDTH_PHONE * 9 / 16)
};
var FULLSCREEN_RECT = { x: 0, y: 0, w: DESIGN_WIDTH2, h: DESIGN_HEIGHT };
var KEY_DPAD_UP = 19;
var KEY_DPAD_DOWN = 20;
var KEY_DPAD_LEFT = 21;
var KEY_DPAD_RIGHT = 22;
var KEY_DPAD_CENTER = 23;
var KEYCODE_ENTER = 66;
var KEYCODE_CHANNEL_UP = 166;
var KEYCODE_CHANNEL_DOWN = 167;
var FAVORITES_GROUP = "★ Favorit";
function buildSidebarRows(channels, expanded, favorites) {
  const rows = [];
  if (favorites && favorites.size > 0) {
    rows.push({ type: "header", group: FAVORITES_GROUP });
    if (expanded.has(FAVORITES_GROUP)) {
      channels.forEach((channel, index) => {
        if (favorites.has(channel.url)) {
          rows.push({ type: "channel", group: FAVORITES_GROUP, channel, index });
        }
      });
    }
  }
  const byGroup = new Map;
  channels.forEach((channel, index) => {
    const g = channel.group || "";
    if (!byGroup.has(g))
      byGroup.set(g, []);
    byGroup.get(g).push(index);
  });
  for (const [group, indexes] of byGroup) {
    rows.push({ type: "header", group });
    if (!expanded.has(group))
      continue;
    for (const index of indexes) {
      rows.push({ type: "channel", group, channel: channels[index], index });
    }
  }
  return rows;
}

// packages/core/src/index.ts
function defineAction(config) {
  if (typeof config.run !== "function") {
    throw new TypeError("defineAction requires a run function");
  }
  return Object.freeze({ ...config });
}
function defineScreen(config) {
  if ("controller" in config) {
    if (!config.controller || typeof config.controller.initialState !== "function") {
      throw new TypeError("Split screen requires a valid controller definition");
    }
    if (typeof config.view !== "function") {
      throw new TypeError("Split screen requires a view function");
    }
    return Object.freeze({ ...config });
  }
  if (typeof config.initialState !== "function") {
    throw new TypeError("Single-file screen requires an initialState function");
  }
  if (typeof config.view !== "function") {
    throw new TypeError("Single-file screen requires a view function");
  }
  return Object.freeze({ ...config });
}

// examples/tvplayer/src/screens/player.screen.tsx
function onAir(media) {
  return media !== null && (media.state === "playing" || media.state === "buffering" || media.state === "paused");
}
function stateLabel(media) {
  switch (media?.state) {
    case "playing":
      return { text: "● LIVE", color: "success" };
    case "buffering":
      return { text: "BUFFERING", color: "warning" };
    case "paused":
      return { text: "PAUSED", color: "textDim" };
    case "error":
      return { text: "ERROR", color: "danger" };
    default:
      return { text: "IDLE", color: "textDim" };
  }
}
function channelNo(index) {
  return String(index + 1).padStart(2, "0");
}
var PHONE_ROWS = 8;
function Rail(props) {
  const items = [
    { glyph: "▶", label: "Live" },
    { glyph: "≡", label: "Set" },
    { glyph: "⌕", label: "Cari" }
  ];
  return /* @__PURE__ */ jsxDEV(Container, {
    width: RAIL_W,
    height: DESIGN_HEIGHT,
    color: "surface",
    children: /* @__PURE__ */ jsxDEV(Column, {
      align: "center",
      padding: "sm",
      gap: "md",
      children: [
        /* @__PURE__ */ jsxDEV(Container, {
          color: "accent",
          radius: 10,
          width: 44,
          height: 44,
          children: /* @__PURE__ */ jsxDEV(Column, {
            align: "center",
            justify: "center",
            children: /* @__PURE__ */ jsxDEV(Text, {
              variant: "label",
              color: "onPrimaryContainer",
              children: "NT"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV(Text, {
          variant: "caption",
          color: "textDim",
          children: "NUSA TV"
        }, undefined, false, undefined, this),
        items.map((item, i) => {
          const focused = props.focusedItem === i;
          return /* @__PURE__ */ jsxDEV(Column, {
            align: "center",
            gap: "sm",
            children: [
              /* @__PURE__ */ jsxDEV(Container, {
                color: focused ? "accent" : "surfaceRaised",
                radius: 10,
                width: 44,
                height: 44,
                children: /* @__PURE__ */ jsxDEV(Column, {
                  align: "center",
                  justify: "center",
                  children: /* @__PURE__ */ jsxDEV(Text, {
                    variant: "label",
                    color: focused ? "onPrimaryContainer" : "textDim",
                    children: item.glyph
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(Text, {
                variant: "caption",
                color: focused ? "text" : "textDim",
                children: item.label
              }, undefined, false, undefined, this)
            ]
          }, item.label, true, undefined, this);
        })
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function ChipRail(props) {
  const { groups, activeGroup, favoriteOnly, onFavorites, onPick } = props;
  const chips = [FAVORITES_GROUP, null, ...groups];
  const activeIdx = favoriteOnly ? 0 : Math.max(1, chips.findIndex((g) => g !== null && g !== FAVORITES_GROUP && (g ?? null) === activeGroup));
  const VISIBLE = 4;
  const start = Math.max(0, Math.min(activeIdx - 1, chips.length - VISIBLE));
  const window = chips.slice(start, start + VISIBLE);
  return /* @__PURE__ */ jsxDEV(Row, {
    gap: 6,
    children: window.map((group, k) => {
      const isFav = group === FAVORITES_GROUP;
      const active = isFav ? favoriteOnly : !favoriteOnly && (group ?? null) === activeGroup;
      return /* @__PURE__ */ jsxDEV(GestureDetector, {
        onTap: () => isFav ? onFavorites() : onPick(group ?? null),
        children: /* @__PURE__ */ jsxDEV(Container, {
          color: active ? "secondaryContainer" : "surface",
          radius: 14,
          padding: 7,
          borderColor: active ? "accent" : undefined,
          borderWidth: active ? 2 : 0,
          children: /* @__PURE__ */ jsxDEV(Text, {
            variant: "caption",
            color: active ? "onSecondaryContainer" : "textDim",
            children: group ?? "Semua"
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, group ?? `__all__${k}`, false, undefined, this);
    })
  }, undefined, false, undefined, this);
}
function ChannelRow(props) {
  const { channel, index, focused, live, favorite, onSelect, onToggleFavorite } = props;
  return /* @__PURE__ */ jsxDEV(Container, {
    color: focused ? "accent" : "surface",
    radius: 10,
    padding: 6,
    borderColor: live && !focused ? "accent" : undefined,
    borderWidth: live && !focused ? 2 : 0,
    children: /* @__PURE__ */ jsxDEV(Row, {
      gap: 6,
      children: [
        /* @__PURE__ */ jsxDEV(Expanded, {
          children: /* @__PURE__ */ jsxDEV(GestureDetector, {
            onTap: onSelect,
            children: /* @__PURE__ */ jsxDEV(Row, {
              gap: 10,
              align: "center",
              children: [
                /* @__PURE__ */ jsxDEV(Container, {
                  color: groupColor(channel.group),
                  radius: 8,
                  width: 30,
                  height: 30,
                  children: /* @__PURE__ */ jsxDEV(Column, {
                    align: "center",
                    justify: "center",
                    children: /* @__PURE__ */ jsxDEV(Text, {
                      variant: "caption",
                      color: "#FFFFFF",
                      children: channelNo(index)
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV(Text, {
                  variant: focused ? "label" : "body",
                  color: focused ? "onPrimaryContainer" : live ? "accent" : "text",
                  maxLines: 1,
                  ellipsis: true,
                  children: channel.title
                }, undefined, false, undefined, this),
                live && /* @__PURE__ */ jsxDEV(Text, {
                  variant: "caption",
                  color: focused ? "onPrimaryContainer" : "success",
                  children: "●"
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV(GestureDetector, {
          onTap: onToggleFavorite,
          children: /* @__PURE__ */ jsxDEV(Container, {
            color: "transparent",
            radius: 8,
            width: 36,
            height: 30,
            children: /* @__PURE__ */ jsxDEV(Column, {
              align: "center",
              justify: "center",
              children: /* @__PURE__ */ jsxDEV(Text, {
                variant: "label",
                color: favorite ? "accent" : "outline",
                children: favorite ? "★" : "☆"
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function Sidebar(props) {
  const { channels, expanded, listIndex, focused, liveUrl, liveGroup, favorites } = props;
  const favSet = new Set(favorites);
  const rows = buildSidebarRows(channels, new Set(expanded), favSet);
  const winStart = Math.max(0, Math.min(listIndex - 2, rows.length - SIDEBAR_VISIBLE));
  const window = rows.slice(winStart, winStart + SIDEBAR_VISIBLE);
  return /* @__PURE__ */ jsxDEV(Container, {
    width: SIDEBAR_W,
    height: DESIGN_HEIGHT,
    color: "surface",
    children: /* @__PURE__ */ jsxDEV(Column, {
      padding: "sm",
      gap: "sm",
      children: window.map((row, k) => {
        const i = winStart + k;
        const isFocused = focused && i === listIndex;
        if (row.type === "header") {
          const isOpen = expanded.includes(row.group);
          const count = row.group === FAVORITES_GROUP ? favSet.size : channels.filter((c) => (c.group || "") === row.group).length;
          return /* @__PURE__ */ jsxDEV(Container, {
            color: isFocused ? "accent" : "surfaceRaised",
            radius: 10,
            width: SIDEBAR_W - 16,
            height: HEADER_H,
            children: /* @__PURE__ */ jsxDEV(Row, {
              gap: "sm",
              align: "center",
              padding: "sm",
              children: [
                /* @__PURE__ */ jsxDEV(Text, {
                  variant: "caption",
                  color: isFocused ? "onPrimaryContainer" : "textDim",
                  children: isOpen ? "▾" : "▸"
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV(Text, {
                  variant: "caption",
                  color: isFocused ? "onPrimaryContainer" : "text",
                  maxLines: 1,
                  ellipsis: true,
                  children: row.group === "" ? "Lainnya" : row.group
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV(Text, {
                  variant: "caption",
                  color: isFocused ? "onPrimaryContainer" : "textDim",
                  children: `${count}`
                }, undefined, false, undefined, this),
                liveGroup === row.group && /* @__PURE__ */ jsxDEV(Text, {
                  variant: "caption",
                  color: isFocused ? "onPrimaryContainer" : "accent",
                  children: "●"
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, `h:${row.group}`, false, undefined, this);
        }
        const live = liveUrl !== null && row.channel.url === liveUrl;
        return /* @__PURE__ */ jsxDEV(Container, {
          color: isFocused ? "accent" : "background",
          radius: 10,
          width: SIDEBAR_W - 16,
          height: ROW_H,
          borderColor: live && !isFocused ? "accent" : undefined,
          borderWidth: live && !isFocused ? 2 : 0,
          children: /* @__PURE__ */ jsxDEV(Row, {
            gap: "sm",
            align: "center",
            padding: "sm",
            children: [
              /* @__PURE__ */ jsxDEV(Container, {
                color: groupColor(row.group),
                radius: 8,
                width: 28,
                height: 28,
                children: /* @__PURE__ */ jsxDEV(Column, {
                  align: "center",
                  justify: "center",
                  children: /* @__PURE__ */ jsxDEV(Text, {
                    variant: "caption",
                    color: "#FFFFFF",
                    children: channelNo(row.index)
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(Text, {
                variant: "caption",
                color: isFocused ? "onPrimaryContainer" : live ? "accent" : "text",
                maxLines: 1,
                ellipsis: true,
                children: row.channel.title
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        }, row.channel.url, false, undefined, this);
      })
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
function SearchOverlay(props) {
  const { query, channels, compact, onQuery, onClose, onSelect } = props;
  const q = query.trim().toLowerCase();
  const results = q === "" ? [] : channels.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 8);
  const width = compact ? 358 : 620;
  const screenW = compact ? 390 : 960;
  const cardLeft = Math.round((screenW - width) / 2);
  const cardTop = compact ? 56 : 48;
  return /* @__PURE__ */ jsxDEV(Positioned, {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    children: /* @__PURE__ */ jsxDEV(Stack, {
      children: [
        /* @__PURE__ */ jsxDEV(GestureDetector, {
          onTap: onClose,
          children: /* @__PURE__ */ jsxDEV(Container, {
            color: "#B3000000",
            width: screenW,
            height: 540
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV(Positioned, {
          top: cardTop,
          left: cardLeft,
          children: /* @__PURE__ */ jsxDEV(Container, {
            color: "surfaceContainerHigh",
            radius: 16,
            padding: "md",
            width,
            borderColor: "outlineVariant",
            borderWidth: 1,
            children: /* @__PURE__ */ jsxDEV(Column, {
              gap: "sm",
              children: [
                /* @__PURE__ */ jsxDEV(Text, {
                  variant: "label",
                  color: "text",
                  children: "Cari channel"
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV(TextField, {
                  id: "search",
                  value: query,
                  onChanged: onQuery,
                  placeholder: "nama channel…",
                  label: "Cari"
                }, undefined, false, undefined, this),
                q === "" ? /* @__PURE__ */ jsxDEV(Text, {
                  variant: "caption",
                  color: "textDim",
                  children: "Ketik untuk mencari — hasil muncul di sini."
                }, undefined, false, undefined, this) : results.length === 0 ? /* @__PURE__ */ jsxDEV(Text, {
                  variant: "caption",
                  color: "textDim",
                  children: [
                    "Tidak ada hasil untuk “",
                    query.trim(),
                    "”."
                  ]
                }, undefined, true, undefined, this) : /* @__PURE__ */ jsxDEV(Column, {
                  gap: 4,
                  children: results.map((c) => {
                    const i = channels.indexOf(c);
                    return /* @__PURE__ */ jsxDEV(GestureDetector, {
                      onTap: () => onSelect(c.url),
                      children: /* @__PURE__ */ jsxDEV(Container, {
                        color: "surface",
                        radius: 10,
                        padding: 6,
                        children: /* @__PURE__ */ jsxDEV(Row, {
                          gap: 10,
                          align: "center",
                          children: [
                            /* @__PURE__ */ jsxDEV(Container, {
                              color: groupColor(c.group),
                              radius: 8,
                              width: 30,
                              height: 30,
                              children: /* @__PURE__ */ jsxDEV(Column, {
                                align: "center",
                                justify: "center",
                                children: /* @__PURE__ */ jsxDEV(Text, {
                                  variant: "caption",
                                  color: "#FFFFFF",
                                  children: channelNo(i)
                                }, undefined, false, undefined, this)
                              }, undefined, false, undefined, this)
                            }, undefined, false, undefined, this),
                            /* @__PURE__ */ jsxDEV(Text, {
                              variant: "body",
                              color: "text",
                              maxLines: 1,
                              ellipsis: true,
                              children: c.title
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this)
                      }, undefined, false, undefined, this)
                    }, c.url, false, undefined, this);
                  })
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function VideoPlaceholder(props) {
  const { media, now, h, channel, no, compact } = props;
  if (media?.state === "playing" || media?.state === "paused") {
    return /* @__PURE__ */ jsxDEV(SizedBox, {
      height: h
    }, undefined, false, undefined, this);
  }
  const isErr = media?.state === "error";
  const buffering = media?.state === "buffering";
  const tileColor = isErr ? "danger" : channel ? groupColor(channel.group) : "outline";
  const tileText = isErr ? "✕" : buffering ? "…" : no ?? "–";
  const title = isErr ? "No signal" : channel ? channel.title : now?.title ?? "No channel";
  const caption = isErr ? media.message ?? "playback failed" : buffering ? "Buffering…" : channel ? compact ? "Tap to play" : "OK to watch" : compact ? "Pick a channel below" : "OK opens the channel list";
  const tile = compact ? 48 : 72;
  return /* @__PURE__ */ jsxDEV(Container, {
    color: "surfaceRaised",
    radius: 16,
    height: h,
    children: /* @__PURE__ */ jsxDEV(Column, {
      align: "center",
      justify: "center",
      gap: "md",
      children: /* @__PURE__ */ jsxDEV(Row, {
        gap: "md",
        align: "center",
        children: [
          /* @__PURE__ */ jsxDEV(Container, {
            color: tileColor,
            radius: compact ? 12 : 16,
            width: tile,
            height: tile,
            children: /* @__PURE__ */ jsxDEV(Column, {
              align: "center",
              justify: "center",
              children: /* @__PURE__ */ jsxDEV(Text, {
                variant: compact ? "label" : "title",
                color: "#FFFFFF",
                children: tileText
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV(Column, {
            gap: "sm",
            align: "start",
            children: [
              /* @__PURE__ */ jsxDEV(Text, {
                variant: isErr ? "title" : compact ? "label" : "headline",
                color: isErr ? "danger" : "text",
                maxLines: 1,
                ellipsis: true,
                children: title
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(Text, {
                variant: "caption",
                color: "textDim",
                maxLines: 1,
                ellipsis: true,
                children: caption
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
var PlayerScreen = defineScreen({
  name: "Player",
  initialState: () => ({
    form: "tv",
    channels: [],
    groups: [],
    activeGroup: null,
    expanded: [],
    index: 0,
    now: null,
    focus: { index: 0, listIndex: 0, zone: "list", fullscreen: false },
    media: null,
    clock: "",
    favorites: [],
    favoriteOnly: false,
    recents: [],
    searchOpen: false,
    query: "",
    zapEntry: null
  }),
  actions: {
    form: defineAction({
      run({ input, state }) {
        state.form = input;
      }
    }),
    channels: defineAction({
      run({ input, state }) {
        state.channels = input.channels;
        state.groups = input.groups;
        state.activeGroup = input.activeGroup;
        state.expanded = input.expanded;
        state.favorites = input.favorites;
        state.favoriteOnly = input.favoriteOnly;
        state.recents = input.recents;
      }
    }),
    channel: defineAction({
      run({ input, state }) {
        state.now = input;
        state.index = input.index;
      }
    }),
    focus: defineAction({
      run({ input, state }) {
        state.focus = input;
      }
    }),
    media: defineAction({
      run({ input, state }) {
        state.media = input;
      }
    }),
    clock: defineAction({
      run({ input, state }) {
        state.clock = input;
      }
    }),
    select: defineAction({
      run({ input, services }) {
        services.select?.(input);
      }
    }),
    setGroup: defineAction({
      run({ input, services }) {
        services.setGroup?.(input);
      }
    }),
    toggleFavorite: defineAction({
      run({ input, services }) {
        services.toggleFavorite?.(input);
      }
    }),
    setFavoriteFilter: defineAction({
      run({ input, services }) {
        services.setFavoriteFilter?.(input);
      }
    }),
    selectUrl: defineAction({
      run({ input, services }) {
        services.selectUrl?.(input);
        services.setSearchOpen?.(false);
      }
    }),
    playToggle: defineAction({
      run({ services }) {
        services.playToggle?.();
      }
    }),
    searchOpen: defineAction({
      run({ services }) {
        services.setSearchOpen?.(true);
      }
    }),
    searchClose: defineAction({
      run({ services }) {
        services.setSearchOpen?.(false);
      }
    }),
    search: defineAction({
      run({ input, state }) {
        state.searchOpen = input;
        if (!input)
          state.query = "";
      }
    }),
    searchQuery: defineAction({
      run({ input, state }) {
        state.query = input;
      }
    }),
    zapEntry: defineAction({
      run({ input, state }) {
        state.zapEntry = input;
      }
    })
  },
  view({ state, actions }) {
    const liveVisible = state.media !== null && onAir(state.media) ? state.channels.find((c) => c.url === state.now?.url) : null;
    const pill = stateLabel(state.media);
    const count = state.channels.length;
    const zone = state.focus.zone;
    const listIdx = state.focus.listIndex;
    const phoneWinStart = Math.max(0, Math.min(listIdx - 2, count - PHONE_ROWS));
    const phoneWindow = state.channels.slice(phoneWinStart, phoneWinStart + PHONE_ROWS);
    const hints = {
      rail: "↑↓ rail · OK open · → list",
      list: "↑↓ channels · OK watch · ← rail · MENU fav"
    };
    const favorites = new Set(state.favorites);
    const tvRows = buildSidebarRows(state.channels, new Set(state.expanded), favorites);
    const focusedRow = tvRows[listIdx];
    const previewChannel = focusedRow === undefined ? null : focusedRow.type === "channel" ? focusedRow.channel : state.channels.find((c) => (c.group || "") === focusedRow.group) ?? null;
    const previewNo = focusedRow !== undefined && focusedRow.type === "channel" ? channelNo(focusedRow.index) : previewChannel ? channelNo(state.channels.indexOf(previewChannel)) : null;
    if (state.form === "tv" && state.focus.fullscreen) {
      if (onAir(state.media))
        return /* @__PURE__ */ jsxDEV(Scaffold, {}, undefined, false, undefined, this);
      return /* @__PURE__ */ jsxDEV(Scaffold, {
        children: /* @__PURE__ */ jsxDEV(SizedBox, {
          width: FULLSCREEN_RECT.w,
          height: FULLSCREEN_RECT.h,
          children: /* @__PURE__ */ jsxDEV(VideoPlaceholder, {
            media: state.media,
            now: state.now,
            h: FULLSCREEN_RECT.h,
            channel: previewChannel ?? null,
            no: previewNo
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
    }
    if (state.form === "phone") {
      const focusedPhone = count > 0 ? state.channels[listIdx] : undefined;
      const main2 = /* @__PURE__ */ jsxDEV(Scaffold, {
        children: /* @__PURE__ */ jsxDEV(Column, {
          gap: 10,
          children: [
            /* @__PURE__ */ jsxDEV(GestureDetector, {
              onTap: () => actions.playToggle(),
              children: /* @__PURE__ */ jsxDEV(SizedBox, {
                width: VIDEO_RECT_PHONE.w,
                height: VIDEO_RECT_PHONE.h,
                children: /* @__PURE__ */ jsxDEV(VideoPlaceholder, {
                  media: state.media,
                  now: state.now,
                  h: VIDEO_RECT_PHONE.h,
                  channel: focusedPhone ?? null,
                  no: count > 0 ? channelNo(listIdx) : null,
                  compact: true
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV(Column, {
              padding: 12,
              gap: 10,
              children: [
                /* @__PURE__ */ jsxDEV(Row, {
                  align: "center",
                  justify: "between",
                  children: [
                    /* @__PURE__ */ jsxDEV(Text, {
                      variant: "label",
                      color: "text",
                      children: "NusaTV"
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV(Row, {
                      gap: 10,
                      align: "center",
                      children: [
                        /* @__PURE__ */ jsxDEV(GestureDetector, {
                          onTap: () => actions.searchOpen(),
                          children: /* @__PURE__ */ jsxDEV(Text, {
                            variant: "label",
                            color: "textDim",
                            children: "⌕"
                          }, undefined, false, undefined, this)
                        }, undefined, false, undefined, this),
                        /* @__PURE__ */ jsxDEV(Text, {
                          variant: "caption",
                          color: "textDim",
                          children: `${count} · ${state.favoriteOnly ? FAVORITES_GROUP : state.activeGroup ?? "Semua"}`
                        }, undefined, false, undefined, this)
                      ]
                    }, undefined, true, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ jsxDEV(ChipRail, {
                  groups: state.groups,
                  activeGroup: state.activeGroup,
                  favoriteOnly: state.favoriteOnly,
                  onFavorites: () => actions.setFavoriteFilter(true),
                  onPick: (g) => actions.setGroup(g)
                }, undefined, false, undefined, this),
                !state.favoriteOnly && state.recents.length > 0 && /* @__PURE__ */ jsxDEV(Column, {
                  gap: 4,
                  children: [
                    /* @__PURE__ */ jsxDEV(Text, {
                      variant: "caption",
                      color: "textDim",
                      children: "Lanjut Nonton"
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV(Row, {
                      gap: 6,
                      children: state.recents.slice(0, 3).map((url) => {
                        const ch = state.channels.find((c) => c.url === url);
                        if (!ch)
                          return null;
                        return /* @__PURE__ */ jsxDEV(GestureDetector, {
                          onTap: () => actions.selectUrl(url),
                          children: /* @__PURE__ */ jsxDEV(Container, {
                            color: "surfaceRaised",
                            radius: 12,
                            padding: 8,
                            children: /* @__PURE__ */ jsxDEV(Text, {
                              variant: "caption",
                              color: "text",
                              maxLines: 1,
                              ellipsis: true,
                              children: ch.title
                            }, undefined, false, undefined, this)
                          }, undefined, false, undefined, this)
                        }, url, false, undefined, this);
                      })
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                count === 0 && /* @__PURE__ */ jsxDEV(Text, {
                  variant: "body",
                  color: "textDim",
                  children: "Playlist empty — open Settings to load one"
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV(Column, {
                  gap: 6,
                  children: phoneWindow.map((channel, k) => {
                    const i = phoneWinStart + k;
                    return /* @__PURE__ */ jsxDEV(ChannelRow, {
                      channel,
                      index: i,
                      focused: i === listIdx,
                      live: liveVisible !== null && liveVisible !== undefined && channel.url === liveVisible.url,
                      favorite: favorites.has(channel.url),
                      onSelect: () => actions.select(i),
                      onToggleFavorite: () => actions.toggleFavorite(channel.url)
                    }, channel.url, false, undefined, this);
                  })
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV(SizedBox, {
                  height: 16
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this);
      return /* @__PURE__ */ jsxDEV(Stack, {
        children: [
          main2,
          state.searchOpen && /* @__PURE__ */ jsxDEV(SearchOverlay, {
            query: state.query,
            channels: state.channels,
            compact: true,
            onQuery: (q) => actions.searchQuery(q),
            onClose: () => actions.searchClose(),
            onSelect: (url) => actions.selectUrl(url)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this);
    }
    const main = /* @__PURE__ */ jsxDEV(Scaffold, {
      children: /* @__PURE__ */ jsxDEV(Row, {
        children: [
          /* @__PURE__ */ jsxDEV(Rail, {
            focusedItem: zone === "rail" ? state.focus.index : null
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV(Sidebar, {
            channels: state.channels,
            expanded: state.expanded,
            listIndex: listIdx,
            focused: zone === "list",
            liveUrl: liveVisible?.url ?? null,
            liveGroup: liveVisible ? liveVisible.group || "" : null,
            favorites: state.favorites
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV(Column, {
            padding: "md",
            gap: "sm",
            children: [
              state.clock !== "" && /* @__PURE__ */ jsxDEV(Row, {
                justify: "end",
                children: /* @__PURE__ */ jsxDEV(Text, {
                  variant: "label",
                  color: "text",
                  children: state.clock
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(GestureDetector, {
                onTap: () => actions.playToggle(),
                children: /* @__PURE__ */ jsxDEV(SizedBox, {
                  width: VIDEO_RECT.w,
                  height: VIDEO_RECT.h,
                  children: /* @__PURE__ */ jsxDEV(VideoPlaceholder, {
                    media: state.media,
                    now: state.now,
                    h: VIDEO_RECT.h,
                    channel: previewChannel ?? null,
                    no: previewNo
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(Column, {
                gap: "sm",
                children: [
                  /* @__PURE__ */ jsxDEV(Row, {
                    justify: "between",
                    children: [
                      /* @__PURE__ */ jsxDEV(Text, {
                        variant: "caption",
                        color: pill.color,
                        maxLines: 1,
                        ellipsis: true,
                        children: state.now ? `${pill.text} · ${channelNo(state.now.index)} · ${state.now.title}` : `NusaTV · ${pill.text}`
                      }, undefined, false, undefined, this),
                      count > 0 && /* @__PURE__ */ jsxDEV(Text, {
                        variant: "caption",
                        color: "textDim",
                        children: `${count} CH`
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this),
                  /* @__PURE__ */ jsxDEV(Text, {
                    variant: "caption",
                    color: "textDim",
                    maxLines: 1,
                    ellipsis: true,
                    children: count === 0 ? "Playlist empty — rail → Set to load one" : hints[zone]
                  }, undefined, false, undefined, this)
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
    return /* @__PURE__ */ jsxDEV(Stack, {
      children: [
        main,
        state.searchOpen && /* @__PURE__ */ jsxDEV(SearchOverlay, {
          query: state.query,
          channels: state.channels,
          compact: false,
          onQuery: (q) => actions.searchQuery(q),
          onClose: () => actions.searchClose(),
          onSelect: (url) => actions.selectUrl(url)
        }, undefined, false, undefined, this),
        state.zapEntry !== null && /* @__PURE__ */ jsxDEV(Positioned, {
          bottom: 12,
          right: 16,
          children: /* @__PURE__ */ jsxDEV(Container, {
            color: "inverseSurface",
            radius: 12,
            padding: 10,
            children: /* @__PURE__ */ jsxDEV(Text, {
              variant: "headline",
              color: "onInverseSurface",
              children: state.zapEntry
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  }
});

// examples/tvplayer/src/screens/settings.screen.tsx
var SettingsScreen = defineScreen({
  name: "Settings",
  initialState: () => ({ url: "", result: null }),
  actions: {
    url: defineAction({
      run({ input, state }) {
        state.url = input;
      }
    }),
    loadResult: defineAction({
      run({ input, state }) {
        state.result = input;
      }
    }),
    load: defineAction({
      run({ state, services }) {
        const url = state.url.trim();
        if (url === "") {
          state.result = { ok: false, message: "enter a playlist URL first" };
          return;
        }
        state.result = { ok: true, message: "loading…" };
        services.loadPlaylist?.(url);
      }
    }),
    back: defineAction({
      run({ services }) {
        services.navigate?.("player");
      }
    })
  },
  view({ state, actions }) {
    return /* @__PURE__ */ jsxDEV(Scaffold, {
      children: /* @__PURE__ */ jsxDEV(Column, {
        padding: "lg",
        gap: "lg",
        children: [
          /* @__PURE__ */ jsxDEV(Text, {
            variant: "title",
            color: "accent",
            children: "Settings"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV(Text, {
            variant: "body",
            color: "textDim",
            children: "Playlist URL (m3u/m3u8) — fetched through the media host's bounded fetchText (GET only, 10 s timeout, 2 MB cap). Official free streams only; where you point the player is your choice."
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV(TextField, {
            id: "playlist-url",
            label: "Playlist URL",
            placeholder: "https://example.com/playlist.m3u",
            value: state.url,
            onChanged: actions.url
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV(Row, {
            gap: "md",
            children: [
              /* @__PURE__ */ jsxDEV(Button, {
                variant: "primary",
                onPress: actions.load,
                children: "Load playlist"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(Button, {
                variant: "secondary",
                onPress: actions.back,
                children: "Back to player"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          state.result && /* @__PURE__ */ jsxDEV(Text, {
            variant: "body",
            color: state.result.ok ? "success" : "danger",
            children: state.result.ok ? `Loaded: ${state.result.message}` : `Failed: ${state.result.message}`
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this);
  }
});

// examples/tvplayer/src/starter-playlist.ts
function chan(title, url, group) {
  return { title, url, group, tvgName: null, tvgLogo: null };
}
var STARTER_PLAYLIST = [
  chan("Metro TV HD", "https://edge.medcom.id/live-edge/smil:metro.smil/playlist.m3u8", "Indonesia"),
  chan("CNN Indonesia", "https://video.detik.com/livecnn/smil:cnntv/chunklist_w268557525_b384000_sleng.m3u8", "Indonesia"),
  chan("CNBC Indonesia", "https://video.detik.com/livecnbc/smil:cnbctv/chunklist_w1279679883_b384000_sleng.m3u8", "Indonesia"),
  chan("iNews (Irak)", "https://live.i-news.tv/hls/stream.m3u8", "Internasional"),
  chan("RTV", "https://rtvstream.rtv.co.id:4555/hls/rtv.m3u8", "Indonesia"),
  chan("Nusantara TV", "https://nusantaratv.siar.us/nusantaratv/live/playlist.m3u8", "Indonesia"),
  chan("DAAI TV", "https://pull.daaiplus.com/live-DAAIPLUS/live-DAAIPLUS_HD.m3u8", "Indonesia"),
  chan("MAGNA Channel", "https://edge.medcom.id/live-edge/smil:magna.smil/chunklist_w521170343_b1128000_sleng.m3u8", "Indonesia"),
  chan("BN Channel", "https://flv.intechmedia.net/live/ch112.m3u8", "Indonesia"),
  chan("TVRI World", "https://ott-balancer.tvri.go.id/live/eds/TVRIWorld/hls/TVRIWorld.m3u8", "Indonesia"),
  chan("TV9 Nusantara", "https://5bf7b725107e5.streamlock.net/tv9/tv9/playlist.m3u8", "Indonesia"),
  chan("Jawa Pos TV", "http://122.248.43.242:1935/JAWAPOSTVJKT/_definst_/myStream/playlist.m3u8", "Indonesia"),
  chan("Bandung TV", "http://202.150.153.254:65500/bandungtvWEBSITE.m3u8", "Indonesia"),
  chan("DW English", "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8", "Internasional"),
  chan("France 24 English", "https://static.france24.com/live/F24_EN_LO_HLS/live_web.m3u8", "Internasional"),
  chan("CGTN English", "https://news.cgtn.com/resource/live/english/cgtn-news.m3u8", "Internasional"),
  chan("DW Deutsch", "https://dwamdstream101.akamaized.net/hls/live/2015524/dwstream101/index.m3u8", "Internasional"),
  chan("France 24 Français", "https://static.france24.com/live/F24_FR_LO_HLS/live_web.m3u8", "Internasional"),
  chan("France 24 Español", "https://static.france24.com/live/F24_ES_LO_HLS/live_web.m3u8", "Internasional"),
  chan("NASA TV Public", "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8", "Sains"),
  chan("Red Bull TV", "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8", "Olahraga"),
  chan("TVRI Nasional", "https://ott-balancer.tvri.go.id/live/eds/Nasional/hls/Nasional.m3u8", "TVRI"),
  chan("TVRI DKI Jakarta", "https://ott-balancer.tvri.go.id/live/eds/DKI/hls/DKI.m3u8", "TVRI"),
  chan("TVRI Jawa Barat", "https://ott-balancer.tvri.go.id/live/eds/Jabar/hls/Jabar.m3u8", "TVRI"),
  chan("TVRI Jawa Tengah", "https://ott-balancer.tvri.go.id/live/eds/Jateng/hls/Jateng.m3u8", "TVRI"),
  chan("TVRI Jawa Timur", "https://ott-balancer.tvri.go.id/live/eds/Jatim/hls/Jatim.m3u8", "TVRI"),
  chan("TVRI Bali", "https://ott-balancer.tvri.go.id/live/eds/Bali/hls/Bali.m3u8", "TVRI"),
  chan("TVRI Sumatera Utara", "https://ott-balancer.tvri.go.id/live/eds/Sumut/hls/Sumut.m3u8", "TVRI"),
  chan("TVRI Sumatera Selatan", "https://ott-balancer.tvri.go.id/live/eds/Sumsel/hls/Sumsel.m3u8", "TVRI"),
  chan("TVRI Sulawesi Selatan", "https://ott-balancer.tvri.go.id/live/eds/Sulsel/hls/Sulsel.m3u8", "TVRI"),
  chan("TVRI Sulawesi Utara", "https://ott-balancer.tvri.go.id/live/eds/Sulut/hls/Sulut.m3u8", "TVRI"),
  chan("TVRI Sulawesi Tengah", "https://ott-balancer.tvri.go.id/live/eds/Sulteng/hls/Sulteng.m3u8", "TVRI"),
  chan("TVRI Sulawesi Tenggara", "https://ott-balancer.tvri.go.id/live/eds/Sultra/hls/Sultra.m3u8", "TVRI"),
  chan("TVRI Kalimantan Timur", "https://ott-balancer.tvri.go.id/live/eds/Kaltim/hls/Kaltim.m3u8", "TVRI"),
  chan("TVRI Kalimantan Barat", "https://ott-balancer.tvri.go.id/live/eds/Kalbar/hls/Kalbar.m3u8", "TVRI"),
  chan("TVRI Aceh", "https://ott-balancer.tvri.go.id/live/eds/Aceh/hls/Aceh.m3u8", "TVRI"),
  chan("TVRI Riau", "https://ott-balancer.tvri.go.id/live/eds/Riau/hls/Riau.m3u8", "TVRI"),
  chan("TVRI Bengkulu", "https://ott-balancer.tvri.go.id/live/eds/Bengkulu/hls/Bengkulu.m3u8", "TVRI"),
  chan("TVRI Lampung", "https://ott-balancer.tvri.go.id/live/eds/Lampung/hls/Lampung.m3u8", "TVRI"),
  chan("TVRI Kep. Bangka Belitung", "https://ott-balancer.tvri.go.id/live/eds/Babel/hls/Babel.m3u8", "TVRI"),
  chan("TVRI Nusa Tenggara Barat", "https://ott-balancer.tvri.go.id/live/eds/NTB/hls/NTB.m3u8", "TVRI"),
  chan("TVRI Nusa Tenggara Timur", "https://ott-balancer.tvri.go.id/live/eds/NTT/hls/NTT.m3u8", "TVRI"),
  chan("TVRI Gorontalo", "https://ott-balancer.tvri.go.id/live/eds/Gorontalo/hls/Gorontalo.m3u8", "TVRI"),
  chan("TVRI Papua", "https://ott-balancer.tvri.go.id/live/eds/Papua/hls/Papua.m3u8", "TVRI"),
  chan("BTV", "https://lnd0t3b922.tenbytecdn.com/ta-sg1/90369cf5-6ac2-411d-b3d0-15fae10a2e2c/master.m3u8", "Indonesia"),
  chan("Garuda TV", "https://hgmtv.com:19360/garudatvlivestreaming/garudatvlivestreaming.m3u8", "Indonesia"),
  chan("Metro Globe Network", "https://edge.medcom.id/live-edge/smil:mgnch.smil/playlist.m3u8", "Indonesia"),
  chan("Indonesiana TV", "https://tvstreamcast.com/indonesiana.m3u8", "Indonesia"),
  chan("The Indonesia Channel", "https://restreamer.indonusa.id:8443/d5f4ad43-1b5a-4b0f-8bef-5b37224ed221.m3u8", "Indonesia"),
  chan("U Channel", "https://srs.u-channel.tv/live/uchannel-tv.m3u8", "Indonesia"),
  chan("Salira TV", "https://live.salira.tv/p/3870/hybrid/play.m3u8", "Indonesia"),
  chan("MBG TV", "https://stream.convergen.co/mbg_stream/smil:mbStream.smil/playlist.m3u8", "Indonesia"),
  chan("VTV", "https://flv.intechmedia.net/live/ch107.m3u8", "Indonesia"),
  chan("Rinjani TV", "https://rinjanitv.cloud/hls/tvkabel.m3u8", "Indonesia"),
  chan("Lingkar TV", "https://lingkartv.my.id/hls/lingkartv.m3u8", "Indonesia"),
  chan("Caruban TV", "https://stream.carubantv.id/hls/0/stream.m3u8", "Indonesia"),
  chan("Jambi TV", "https://jambitv.globaldigitalcore.com/hls/sah5tu7Eiveepohyieyie3OoteL2anga.m3u8", "Indonesia"),
  chan("Efarina TV", "https://live.efarinatv.com/hls/bgtaufikganteng.m3u8", "Indonesia"),
  chan("USM TV", "https://play.fsa-stream.my.id/hls/siaran.m3u8", "Indonesia"),
  chan("PKTV", "https://streaming.id18.tunnel.my.id/hls/stream.m3u8", "Indonesia"),
  chan("Sangaji TV", "https://cdn.adyadigitalteknologi.com:8090/vod/relay.m3u8", "Indonesia"),
  chan("Kilisuci TV", "https://5bf7b725107e5.streamlock.net/kstv/kstv/playlist.m3u8", "Indonesia"),
  chan("BRTV", "https://5bf7b725107e5.streamlock.net/brtv/brtv/playlist.m3u8", "Indonesia"),
  chan("BMS TV", "https://5bf7b725107e5.streamlock.net/bmstv/bmstv/playlist.m3u8", "Indonesia"),
  chan("Angel TV", "https://janya-digimix.akamaized.net/vglive-sk-234616/indonesia/ngrp:angelindonesia_all/playlist.m3u8", "Indonesia"),
  chan("Dens Food Channel", "https://op-flashcon-digdayahd-1.dens.tv/h/h221/02.m3u8", "Lifestyle"),
  chan("Balikpapan TV", "http://122.248.43.242:1935/BALIKPAPANTV/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("Batam TV", "http://122.248.43.242:1935/BATAMTV/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("Banten TV", "https://5bf7b725107e5.streamlock.net/bantentv/bantentv/playlist.m3u8", "Daerah"),
  chan("Bungo TV", "https://5bf7b725107e5.streamlock.net/bungotv/bungotv/playlist.m3u8", "Daerah"),
  chan("Duta TV", "https://dutatv.siar.us/dutatv/live/playlist.m3u8", "Daerah"),
  chan("Fajar TV", "http://122.248.43.242:1935/FAJARTV/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("Jek TV", "http://27.124.81.245:1935/jektv/myStream/playlist.m3u8", "Daerah"),
  chan("Jogja Istimewa TV", "http://103.255.15.222:1935/tv/jitv_720p/playlist.m3u8", "Daerah"),
  chan("Jogja TV", "https://stream.jogjatv.co.id/jtvlive/stream/index.m3u8", "Daerah"),
  chan("JTV Surabaya", "http://122.248.43.242:1935/JTVSURABAYA/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("JTV Kediri", "http://122.248.43.242:1935/JTVKEDIRI/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("JTV Madiun", "http://122.248.43.242:1935/JTVMADIUN/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("JTV Malang", "http://122.248.43.242:1935/JTVMALANG/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("Kawanua TV", "http://122.248.43.242:1935/KAWANUATV/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("Madu TV", "https://re1.siar.us/madutv/hd720/playlist.m3u8", "Daerah"),
  chan("Padang TV", "http://122.248.43.242:1935/PADANGTV/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("PONTV", "http://122.248.43.242:1935/PONTV/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("Radar Tasikmalaya TV", "https://v2.siar.us/radartasikmalaya/live/playlist.m3u8", "Daerah"),
  chan("RCTV", "https://v10.siar.us/rctv/live/playlist.m3u8", "Daerah"),
  chan("Riau TV", "http://122.248.43.242:1935/RIAUTV/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("Samarinda TV", "http://122.248.43.242:1935/SAMARINDATV/_definst_/myStream/playlist.m3u8", "Daerah"),
  chan("TATV Semarang", "https://v2.siar.us/tatv/live.sdp/playlist.m3u8", "Daerah"),
  chan("TV Tabalong", "https://5bf7b725107e5.streamlock.net/tvtabalong/tvtabalong/playlist.m3u8", "Daerah"),
  chan("Dhoho TV", "https://dhohotv.siar.us/dhohotv/live/playlist.m3u8", "Daerah"),
  chan("Banjar TV", "https://banjartv.siar.us/banjartv/live/playlist.m3u8", "Daerah"),
  chan("AKTV Kaltim", "https://akativi.siar.us/live/akativi.m3u8", "Daerah"),
  chan("Stara TV", "https://stream.staratv.id/hls/0/stream.m3u8", "Daerah"),
  chan("Stara TV Jakarta", "https://jakarta.staratv.id/hls/0/stream.m3u8", "Daerah"),
  chan("Stara TV Bandung", "https://bandung.staratv.id/hls/0/stream.m3u8", "Daerah"),
  chan("Stara TV Malang", "https://malang.staratv.id/hls/0/stream.m3u8", "Daerah"),
  chan("Stara TV Bojonegoro", "https://bojonegoro.staratv.id/hls/stream.m3u8", "Daerah"),
  chan("Stara TV Cianjur", "https://cianjur.staratv.id/hls/0/stream.m3u8", "Daerah"),
  chan("Stara TV Parahyangan", "https://parahyangan.staratv.id/hls/0/stream.m3u8", "Daerah"),
  chan("Ahsan TV", "https://5bf7b725107e5.streamlock.net/ahsantv/ahsantv/playlist.m3u8", "Religius"),
  chan("Al Wafa Tarim", "https://ammedia.siar.us/ammedia/live/playlist.m3u8", "Religius"),
  chan("Ashiil TV", "https://wahyu1ptv.pages.dev/AshiilTV-HD.m3u8", "Religius"),
  chan("Astha TV", "https://hgmtv.com:2020/hls/asthalive/asthalive.m3u8", "Religius"),
  chan("Dhamma TV", "https://b.webcache.maxindo.net.id/dhamma/dhamma.m3u8", "Religius"),
  chan("Madani TV", "https://stream.asianastream.com/madani/madanitv.smil/playlist.m3u8", "Religius"),
  chan("MQTV", "https://5bf7b725107e5.streamlock.net/mqtv/mqtv/playlist.m3u8", "Religius"),
  chan("Salam TV", "https://live.salamtelevisi.com/hls/0/stream.m3u8", "Religius"),
  chan("DMI TV", "https://tvstreamcast.com/tawaftv.m3u8", "Religius"),
  chan("Music Information Channel", "https://mic.siar.us/mic/live/mic.m3u8", "Musik"),
  chan("Suara Surabaya (Visual)", "https://ssfm.siar.us/ssfm/live/playlist.m3u8", "Musik"),
  chan("Now 80's", "https://lightning-now80s-samsungnz.amagi.tv/playlist.m3u8", "Musik"),
  chan("TRT Müzik", "https://tv-trtmuzik.medya.trt.com.tr/master.m3u8", "Musik"),
  chan("70s Cinema", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/5f4d878d3d19b30007d2e782/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=96&deviceId=5f4d878d3d19b30007d2e782&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("80s Rewind", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/5ca525b650be2571e3943c63/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=95&deviceId=5ca525b650be2571e3943c63&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("90s Throwback", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/5f4d86f519358a00072b978e/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=94&deviceId=5f4d86f519358a00072b978e&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("Classic Movies", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/561c5b0dada51f8004c4d855/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=106&deviceId=561c5b0dada51f8004c4d855&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("Paramount Movies", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/5cb0cae7a461406ffe3f5213/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=100&deviceId=5cb0cae7a461406ffe3f5213&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("Action Hollywood", "https://cdn-apse1-prod.tsv2.amagi.tv/linear/amg01076-lightningintern-actionhollywood-samsungnz/playlist.m3u8", "Film"),
  chan("Pluto TV Action", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/561d7d484dc7c8770484914a/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=54&deviceId=561d7d484dc7c8770484914a&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("Pluto TV Comedy", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/5a4d3a00ad95e4718ae8d8db/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=57&deviceId=5a4d3a00ad95e4718ae8d8db&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("Pluto TV Drama", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/5b4e92e4694c027be6ecece1/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=60&deviceId=5b4e92e4694c027be6ecece1&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("Pluto TV Horror", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/569546031a619b8f07ce6e25/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=75&deviceId=569546031a619b8f07ce6e25&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("Pluto TV Westerns", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/5b4e94282d4ec87bdcbb87cd/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=103&deviceId=5b4e94282d4ec87bdcbb87cd&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("Pluto TV Cult Films", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/5c665db3e6c01b72c4977bc2/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=109&deviceId=5c665db3e6c01b72c4977bc2&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Film"),
  chan("Pluto TV Documentaries", "https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/5b85a7582921777994caea63/master.m3u8?terminate=false&deviceType=web&deviceMake=web&deviceModel=web&sid=91&deviceId=5b85a7582921777994caea63&deviceVersion=DNT&appVersion=DNT&deviceDNT=0&userId=&advertisingId=&deviceLat=&deviceLon=&app_name=&appName=web&buildVersion=&appStoreUrl=&architecture=&includeExtendedEvents=false&marketingRegion=US&serverSideAds=false", "Dokumenter"),
  chan("CGTN Documentary", "https://news.cgtn.com/resource/live/document/cgtn-doc.m3u8", "Dokumenter"),
  chan("Al Jazeera English", "https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8", "Internasional"),
  chan("Al Jazeera Arabic", "https://live-hls-web-aja.getaj.net/AJA/index.m3u8", "Internasional"),
  chan("Al Jazeera Mubasher", "https://live-hls-web-ajm.getaj.net/AJM/index.m3u8", "Internasional"),
  chan("Al Arabiya", "https://live.alarabiya.net/alarabiapublish/alarabiya.smil/playlist.m3u8", "Internasional"),
  chan("Al Hadath", "https://live.alarabiya.net/alarabiapublish/alhadath.smil/alarabiapublish/alhadath_1080p/chunks.m3u8", "Internasional"),
  chan("ABC News (US)", "https://abcnews-streams.akamaized.net/hls/live/2023560/abcnewshudson1/master.m3u8", "Internasional"),
  chan("ABC News (AU)", "https://c.mjh.nz/abc-news.m3u8", "Internasional"),
  chan("CBS News", "https://cbsnews.akamaized.net/hls/live/2020607/cbsnlineup_8/master.m3u8", "Internasional"),
  chan("NBC News NOW", "https://d1si3n1st4nkgb.cloudfront.net/10502/88896001/hls/master.m3u8?ads.xumo_channelId=88896001", "Internasional"),
  chan("Bloomberg TV", "https://bloomberg.com/media-manifest/streams/us.m3u8", "Internasional"),
  chan("Sky News Arabia", "https://stream.skynewsarabia.com/hls/sna.m3u8", "Internasional"),
  chan("TRT World", "https://tv-trtworld.medya.trt.com.tr/master.m3u8", "Internasional"),
  chan("NHK World Japan", "https://master.nhkworld.jp/nhkworld-tv/playlist/live.m3u8", "Internasional"),
  chan("DW Español", "https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/stream04/streamPlaylist.m3u8", "Internasional"),
  chan("CGTN Español", "https://news.cgtn.com/resource/live/espanol/cgtn-e.m3u8", "Internasional"),
  chan("CGTN Français", "https://news.cgtn.com/resource/live/french/cgtn-f.m3u8", "Internasional"),
  chan("Arirang TV", "https://amdlive.ctnd.com.edgesuite.net/arirang_1ch/smil:arirang_1ch.smil/playlist.m3u8", "Internasional"),
  chan("India Today", "https://indiatodaylive.akamaized.net/hls/live/2014320/indiatoday/indiatodaylive/playlist.m3u8", "Internasional"),
  chan("Record News", "https://rnw-rn.otteravision.com/rnw/rn/rnw_rn.m3u8", "Internasional"),
  chan("SABC News", "https://sabconetanw.cdn.mangomolo.com/news/smil:news.stream.smil/chunklist_b250000_t64MjQwcA==.m3u8", "Internasional"),
  chan("Scripps News", "https://content.uplynk.com/channel/4bb4901b934c4e029fd4c1abfc766c37.m3u8", "Internasional"),
  chan("Court TV", "https://content.uplynk.com/channel/6c0bd0f94b1d4526a98676e9699a10ef.m3u8", "Internasional"),
  chan("Global News", "https://live.corusdigitaldev.com/groupd/live/49a91e7f-1023-430f-8d66-561055f3d0f7/live.isml/.m3u8", "Internasional"),
  chan("USA Today", "https://cdn-ue1-prod.tsv2.amagi.tv/linear/amg00731-gannettcoinc-usatodaynews-plex/playlist.m3u8", "Internasional"),
  chan("Reuters Now", "https://amg00453-reuters-amg00453c1-rakuten-uk-2110.playouts.now.amagi.tv/playlist/amg00453-reuters-reuters-rakutenuk/playlist.m3u8", "Internasional"),
  chan("TV5Monde Info", "https://ott.tv5monde.com/Content/HLS/Live/channel(info)/index.m3u8", "Internasional"),
  chan("RTVE 24H", "https://ztnr.rtve.es/ztnr/1694255.m3u8", "Internasional"),
  chan("TVRI Sport", "https://ott-balancer.tvri.go.id/live/eds/SportHD/hls/SportHD.m3u8", "Olahraga"),
  chan("Pluto TV Sport", "https://service-stitcher.clusters.pluto.tv/v1/stitch/embed/hls/channel/608030eff4b6f70007e1684c/master.m3u8?deviceId=channel&deviceModel=web&deviceVersion=1.0&appVersion=1.0&deviceType=rokuChannel&deviceMake=rokuChannel&deviceDNT=1&advertisingId=channel&embedPartner=rokuChannel&appName=rokuchannel&is_lat=1&bmodel=bm1&content=channel&platform=web&tags=ROKU_CONTENT_TAGS&coppa=false&content_type=livefeed&rdid=channel&genre=ROKU_ADS_CONTENT_GENRE&content_rating=ROKU_ADS_CONTENT_RATING&studio_id=viacom&channel_id=channel", "Olahraga"),
  chan("TVRI Kalimantan Tengah", "https://ott-balancer.tvri.go.id/live/eds/Kalteng/hls/Kalteng.m3u8", "TVRI"),
  chan("TVRI Jambi", "https://ott-balancer.tvri.go.id/live/eds/Jambi/hls/Jambi.m3u8", "TVRI"),
  chan("TVRI Maluku", "https://ott-balancer.tvri.go.id/live/eds/Ambon/hls/Ambon.m3u8", "TVRI"),
  chan("TVRI Kalimantan Selatan", "https://ott-balancer.tvri.go.id/live/eds/Kalsel/hls/Kalsel.m3u8", "TVRI"),
  chan("TVRI Papua Barat", "https://ott-balancer.tvri.go.id/live/eds/Pabar/hls/Pabar.m3u8", "TVRI"),
  chan("TVRI Sulawesi Barat", "https://ott-balancer.tvri.go.id/live/eds/Sulbar/hls/Sulbar.m3u8", "TVRI"),
  chan("TVRI Sumatera Barat", "https://ott-balancer.tvri.go.id/live/eds/Sumbar/hls/Sumbar.m3u8", "TVRI"),
  chan("TVRI Yogyakarta", "https://ott-balancer.tvri.go.id/live/eds/Jogjakarta/hls/Jogjakarta.m3u8", "TVRI"),
  chan("Mux Test", "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", "Test")
];

// examples/tvplayer/src/playlist.ts
var ATTR_RE = /([A-Za-z][\w-]*)="([^"]*)"/g;
function attrs(block) {
  const out = {};
  for (const match of block.matchAll(ATTR_RE)) {
    out[match[1].toLowerCase()] = match[2];
  }
  return out;
}
function splitExtinf(line) {
  const rest = line.slice("#EXTINF:".length);
  let inQuote = false;
  for (let i = 0;i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '"')
      inQuote = !inQuote;
    else if (ch === "," && !inQuote) {
      return { attrBlock: rest.slice(0, i), title: rest.slice(i + 1).trim() };
    }
  }
  return { attrBlock: rest, title: "" };
}
function parsePlaylist(text) {
  const entries = [];
  let pending = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#EXTM3U") || line.startsWith("#EXT-X-")) {
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      const { attrBlock, title } = splitExtinf(line);
      const attr = attrs(attrBlock);
      pending = {
        title: title || attr["tvg-name"] || null,
        tvgName: attr["tvg-name"] ?? null,
        tvgLogo: attr["tvg-logo"] ?? null,
        group: attr["group-title"] ?? null
      };
      continue;
    }
    if (line.startsWith("#EXTGRP:")) {
      const group = line.slice("#EXTGRP:".length).trim();
      if (pending && pending.group === null)
        pending.group = group || null;
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    if (pending) {
      entries.push({
        title: pending.title ?? "(unnamed)",
        url: line,
        group: pending.group ?? "",
        tvgName: pending.tvgName,
        tvgLogo: pending.tvgLogo
      });
      pending = null;
    }
  }
  return entries;
}

// examples/tvplayer/src/feed.ts
var FEED_URL = "https://duktetek.id/?device=bittv";
var CONTAINER_KEYS = ["channels", "data", "list", "result", "items", "streams"];
var TITLE_KEYS = ["name", "title", "channel_name", "channel", "tv_name"];
var URL_KEYS = ["source", "url", "stream", "link", "stream_url"];
var GROUP_KEYS = ["group", "country", "menu_name", "group_title", "category", "genre"];
var MAX_CHANNELS = 2000;
function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim())
      return v.trim();
  }
  return "";
}
function isTruthy(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}
function parseFeedText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  let arr = [];
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === "object") {
    const obj = data;
    for (const key of CONTAINER_KEYS) {
      if (Array.isArray(obj[key])) {
        arr = obj[key];
        break;
      }
    }
  }
  if (arr.length === 0)
    return null;
  const out = [];
  const seen = new Set;
  for (const item of arr) {
    if (!item || typeof item !== "object")
      continue;
    const o = item;
    if (isTruthy(o.is_movie))
      continue;
    const title = firstString(o, TITLE_KEYS);
    const url = firstString(o, URL_KEYS);
    if (!title || !url)
      continue;
    const key = title.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (key && seen.has(key))
      continue;
    if (key)
      seen.add(key);
    const group = firstString(o, GROUP_KEYS) || "BitTV";
    out.push({ title, url, group, tvgName: null, tvgLogo: null });
    if (out.length >= MAX_CHANNELS)
      break;
  }
  return out.length > 0 ? out : null;
}

// examples/tvplayer/src/runtime.ts
function feedLog(message) {
  const c = globalThis.console;
  if (c && typeof c.info === "function")
    c.info(message);
}
var FAVORITES_KEY = "favorites.v1";
var RECENTS_KEY = "recents.v1";
var RECENTS_MAX = 10;
var KEYCODE_0 = 7;
var KEYCODE_9 = 16;
var KEYCODE_MENU = 82;
var screens = {
  player: PlayerScreen,
  settings: SettingsScreen
};

class TvplayerRuntime {
  app;
  media;
  storage;
  form;
  videoRect;
  channels = STARTER_PLAYLIST;
  favorites = new Set;
  favoriteOnly = false;
  recents = [];
  zapDigits = "";
  zapFlushTimer = null;
  searchOpenFlag = false;
  feedLive = false;
  feedUrl;
  activeGroup = null;
  currentUrl = null;
  focusIndex = 0;
  listIndex = 0;
  expandedGroups;
  focusZone = "list";
  fullscreen = false;
  status = { state: "idle" };
  get vis() {
    if (this.favoriteOnly) {
      return this.channels.filter((c) => this.favorites.has(c.url));
    }
    return this.activeGroup === null ? this.channels : this.channels.filter((c) => c.group === this.activeGroup);
  }
  groups() {
    return [...new Set(this.channels.map((c) => c.group).filter((g) => g !== ""))];
  }
  allGroups() {
    return [...new Set(this.channels.map((c) => c.group))];
  }
  get currentIndex() {
    if (this.currentUrl === null)
      return -1;
    return this.vis.findIndex((c) => c.url === this.currentUrl);
  }
  flatRows() {
    return buildSidebarRows(this.channels, this.expandedGroups, this.favorites);
  }
  flatIndexOf(url) {
    return this.flatRows().findIndex((r) => r.type === "channel" && r.channel.url === url);
  }
  constructor(host = {}) {
    const { media, storage, designWidth, formFactor, feedUrl } = host;
    this.media = media ?? unsupportedMedia("tvplayer: no media host bound");
    this.storage = storage ?? unsupportedStorage("tvplayer: no storage host bound");
    this.form = formFactor ?? "tv";
    this.videoRect = this.form === "phone" ? VIDEO_RECT_PHONE : VIDEO_RECT;
    this.expandedGroups = new Set([...this.allGroups(), FAVORITES_GROUP]);
    this.feedUrl = feedUrl ?? FEED_URL;
    const services = {
      media: this.media,
      navigate: (route) => this.navigate(route),
      loadPlaylist: (url) => void this.loadPlaylist(url),
      select: (index) => this.select(index),
      setGroup: (group) => this.setGroup(group),
      toggleFavorite: (url) => this.toggleFavorite(url),
      setFavoriteFilter: (on) => this.setFavoriteFilter(on),
      selectUrl: (url) => this.selectUrl(url),
      playToggle: () => this.playToggle(),
      setSearchOpen: (on) => this.setSearchOpen(on)
    };
    this.app = new ApplicationRuntime({
      screens,
      initial: "player",
      theme: tvTheme,
      services,
      designWidth: designWidth ?? (this.form === "phone" ? DESIGN_WIDTH_PHONE : DESIGN_WIDTH2)
    });
    this.app.pushState("form", this.form);
    this.pushChannels();
    this.pushFocus();
    this.pushNowPlaying();
    this.pushMedia();
    this.ensureVideoRect();
    this.startClock();
    this.hydratePersisted();
    this.startFeed();
  }
  hydratePersisted() {
    this.storage.get(FAVORITES_KEY).then((r) => {
      if (!r.ok || typeof r.value !== "string")
        return;
      try {
        const urls = JSON.parse(r.value);
        if (Array.isArray(urls)) {
          this.favorites = new Set(urls.filter((u) => typeof u === "string"));
          this.pruneAdopted();
          this.pushChannels();
        }
      } catch {}
    });
    this.storage.get(RECENTS_KEY).then((r) => {
      if (!r.ok || typeof r.value !== "string")
        return;
      try {
        const urls = JSON.parse(r.value);
        if (Array.isArray(urls)) {
          this.recents = urls.filter((u) => typeof u === "string");
          this.pruneAdopted();
          this.pushChannels();
        }
      } catch {}
    });
  }
  persistFavorites() {
    this.storage.set(FAVORITES_KEY, JSON.stringify([...this.favorites])).then(() => {
      return;
    }, () => {
      return;
    });
  }
  persistRecents() {
    this.storage.set(RECENTS_KEY, JSON.stringify(this.recents)).then(() => {
      return;
    }, () => {
      return;
    });
  }
  pruneAdopted() {
    const urls = new Set(this.channels.map((c) => c.url));
    for (const url of [...this.favorites]) {
      if (!urls.has(url))
        this.favorites.delete(url);
    }
    this.recents = this.recents.filter((url) => urls.has(url));
  }
  favoriteChannels() {
    return this.channels.filter((c) => this.favorites.has(c.url));
  }
  isFavorite(url) {
    return this.favorites.has(url);
  }
  toggleFavorite(url) {
    if (this.favorites.has(url))
      this.favorites.delete(url);
    else
      this.favorites.add(url);
    this.persistFavorites();
    if (this.favoriteOnly && this.favoriteChannels().length === 0)
      this.favoriteOnly = false;
    this.pushChannels();
    this.pushFocus();
  }
  setFavoriteFilter(on) {
    if (on && this.favoriteChannels().length === 0)
      return;
    this.favoriteOnly = on;
    this.listIndex = 0;
    this.pushChannels();
    this.pushFocus();
  }
  selectUrl(url) {
    this.activeGroup = null;
    this.favoriteOnly = false;
    const index = this.vis.findIndex((c) => c.url === url);
    if (index < 0)
      return;
    if (this.form === "phone") {
      this.listIndex = index;
    } else {
      this.expandedGroups.add(this.channels[index].group || "");
      const flat = this.flatIndexOf(url);
      if (flat >= 0)
        this.listIndex = flat;
    }
    this.zapTo(index);
    this.pushFocus();
  }
  playToggle() {
    if (this.status.state === "playing") {
      this.media.pause().then((r) => {
        if (r.ok)
          this.mediaPush(r.value);
      });
      return;
    }
    if (this.status.state === "paused") {
      this.media.play().then((r) => {
        if (r.ok)
          this.mediaPush(r.value);
      });
      return;
    }
    this.select(this.currentIndex >= 0 ? this.currentIndex : this.listIndex);
  }
  setSearchOpen(on) {
    this.searchOpenFlag = on;
    this.app.pushState("search", on);
    if (!on)
      return;
    setTimeout(() => {
      try {
        this.app.focusTextField("search");
      } catch {}
    }, 0);
  }
  startFeed() {
    this.media.fetchText(this.feedUrl).then((fetched) => {
      if (!fetched.ok) {
        feedLog(`[tvplayer] feed not adopted (${fetched.failure.message ?? fetched.failure.kind}); using built-in lineup`);
        return;
      }
      const entries = parseFeedText(fetched.value);
      if (entries === null) {
        feedLog("[tvplayer] feed had no live channels; using built-in lineup");
        return;
      }
      this.channels = entries;
      this.feedLive = true;
      this.activeGroup = null;
      this.currentUrl = null;
      this.listIndex = 0;
      this.expandedGroups = new Set([...this.allGroups(), FAVORITES_GROUP]);
      this.pruneAdopted();
      this.persistFavorites();
      this.persistRecents();
      this.pushChannels();
      this.pushFocus();
      this.zapTo(0);
      this.focusZone = "list";
      this.pushFocus();
    });
  }
  startClock() {
    const push = () => {
      const d = new Date;
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      this.app.pushState("clock", `${hh}.${mm}`);
    };
    push();
    const rearm = () => {
      setTimeout(() => {
        push();
        rearm();
      }, 60000 - Date.now() % 60000 + 50);
    };
    rearm();
  }
  route() {
    return this.app.route();
  }
  feedSource() {
    return this.feedLive ? "feed" : "builtin";
  }
  feedSourceUrl() {
    return this.feedUrl;
  }
  routes() {
    return this.app.routes();
  }
  stateSchema() {
    return this.app.stateSchema();
  }
  exportState() {
    return this.app.exportState();
  }
  onStateInvalidation(listener) {
    return this.app.onStateInvalidation(listener);
  }
  render() {
    return this.app.render();
  }
  navigate(route) {
    this.app.navigate(route);
  }
  goBack() {
    if (this.fullscreen) {
      this.exitFullscreen();
      return true;
    }
    if (this.searchOpenFlag) {
      this.setSearchOpen(false);
      return true;
    }
    if (this.app.route() === "settings") {
      this.navigate("player");
      return true;
    }
    return false;
  }
  dispatch(action, payload = {}) {
    const norm = action.toUpperCase();
    if (norm === "KEY") {
      const p = payload ?? {};
      this.keyPress(Number(p.keyCode ?? -1), String(p.phase ?? "down"));
      return;
    }
    if (norm === "MEDIA_STATE") {
      const p = payload ?? {};
      this.mediaPush({
        state: p.state ?? "idle",
        url: p.url,
        message: p.message
      });
      return;
    }
    this.app.dispatch(action, payload);
  }
  keyPress(keyCode, phase) {
    if (phase !== "down")
      return false;
    const route = this.app.route();
    if (route === "player")
      return this.playerKey(keyCode);
    if (route === "settings") {
      if (keyCode === KEY_DPAD_LEFT) {
        this.navigate("player");
        return true;
      }
      return false;
    }
    return false;
  }
  playerKey(keyCode) {
    if (this.searchOpenFlag)
      return false;
    if (keyCode === KEYCODE_MENU) {
      const target = this.currentUrl ?? this.vis[this.listIndex]?.url;
      if (target)
        this.toggleFavorite(target);
      return true;
    }
    if (keyCode >= KEYCODE_0 && keyCode <= KEYCODE_9 && this.form === "tv") {
      const digit = keyCode - KEYCODE_0;
      this.zapDigits = (this.zapDigits + String(digit)).slice(-2);
      this.app.pushState("zapEntry", this.zapDigits);
      if (this.zapFlushTimer !== null)
        clearTimeout(this.zapFlushTimer);
      const digits = this.zapDigits;
      if (digits.length >= 2) {
        this.flushZapEntry(digits);
      } else {
        this.zapFlushTimer = setTimeout(() => this.flushZapEntry(digits), 1200);
      }
      return true;
    }
    if (this.fullscreen) {
      if (keyCode === KEY_DPAD_DOWN || keyCode === KEYCODE_CHANNEL_UP) {
        this.zapStep(1);
        return true;
      }
      if (keyCode === KEY_DPAD_UP || keyCode === KEYCODE_CHANNEL_DOWN) {
        this.zapStep(-1);
        return true;
      }
      this.exitFullscreen();
      return true;
    }
    if (this.form === "phone") {
      const count = this.vis.length;
      if (keyCode === KEY_DPAD_RIGHT) {
        this.navigate("settings");
        return true;
      }
      if (keyCode === KEY_DPAD_DOWN && count > 0) {
        this.setListIndex((this.listIndex + 1) % count);
        return true;
      }
      if (keyCode === KEY_DPAD_UP && count > 0) {
        this.setListIndex((this.listIndex - 1 + count) % count);
        return true;
      }
      if (keyCode === KEY_DPAD_CENTER || keyCode === KEYCODE_ENTER) {
        if (count === 0)
          return false;
        this.select(this.listIndex);
        return true;
      }
      return false;
    }
    if (keyCode === KEYCODE_CHANNEL_UP || keyCode === KEYCODE_CHANNEL_DOWN) {
      this.zapStep(keyCode === KEYCODE_CHANNEL_UP ? 1 : -1);
      return true;
    }
    if (this.focusZone === "rail") {
      if (keyCode === KEY_DPAD_UP) {
        this.focusIndex = Math.max(0, this.focusIndex - 1);
        this.pushFocus();
        return true;
      }
      if (keyCode === KEY_DPAD_DOWN) {
        this.focusIndex = Math.min(2, this.focusIndex + 1);
        this.pushFocus();
        return true;
      }
      if (keyCode === KEY_DPAD_CENTER || keyCode === KEYCODE_ENTER) {
        if (this.focusIndex === 1)
          this.navigate("settings");
        if (this.focusIndex === 2)
          this.setSearchOpen(true);
        return true;
      }
      if (keyCode === KEY_DPAD_RIGHT) {
        this.toZone("list");
        return true;
      }
      return false;
    }
    const rows = this.flatRows();
    if (rows.length === 0) {
      if (keyCode === KEY_DPAD_UP) {
        this.toZone("rail");
        return true;
      }
      return false;
    }
    if (keyCode === KEY_DPAD_DOWN) {
      this.setListIndex(Math.min(rows.length - 1, this.listIndex + 1));
      return true;
    }
    if (keyCode === KEY_DPAD_UP) {
      if (this.listIndex === 0)
        this.toZone("rail");
      else
        this.setListIndex(this.listIndex - 1);
      return true;
    }
    if (keyCode === KEY_DPAD_LEFT) {
      this.toZone("rail");
      return true;
    }
    if (keyCode === KEY_DPAD_CENTER || keyCode === KEYCODE_ENTER) {
      const row = rows[this.listIndex];
      if (!row)
        return false;
      if (row.type === "header") {
        this.toggleGroup(row.group);
        return true;
      }
      if (row.index !== this.currentIndex)
        this.zapTo(row.index);
      this.enterFullscreen();
      return true;
    }
    return false;
  }
  toZone(zone) {
    if (zone === "list") {
      this.listIndex = Math.min(this.listIndex, Math.max(0, this.flatRows().length - 1));
    } else {
      this.focusIndex = 0;
    }
    this.focusZone = zone;
    this.pushFocus();
  }
  setListIndex(index) {
    this.listIndex = index;
    this.pushFocus();
  }
  toggleGroup(group) {
    if (this.expandedGroups.has(group))
      this.expandedGroups.delete(group);
    else
      this.expandedGroups.add(group);
    this.listIndex = Math.min(this.listIndex, Math.max(0, this.flatRows().length - 1));
    this.pushChannels();
    this.pushFocus();
  }
  enterFullscreen() {
    if (this.form !== "tv")
      return;
    this.fullscreen = true;
    this.focusZone = "list";
    this.ensureVideoRect();
    this.pushFocus();
  }
  exitFullscreen() {
    if (!this.fullscreen)
      return;
    this.fullscreen = false;
    this.focusZone = "list";
    if (this.form === "phone") {
      this.setListIndex(Math.max(0, this.currentIndex));
    } else {
      const flat = this.currentUrl === null ? -1 : this.flatIndexOf(this.currentUrl);
      this.setListIndex(Math.max(0, flat));
    }
    this.ensureVideoRect();
  }
  zapStep(dir) {
    const count = this.vis.length;
    if (count === 0)
      return;
    if (this.currentIndex < 0) {
      this.zapTo(0);
      return;
    }
    const next = (this.currentIndex + dir + count) % count;
    if (next !== this.currentIndex)
      this.zapTo(next);
  }
  flushZapEntry(digits) {
    this.zapDigits = "";
    this.zapFlushTimer = null;
    this.app.pushState("zapEntry", null);
    const n = Number.parseInt(digits, 10);
    if (!Number.isFinite(n) || n < 1 || n > this.channels.length)
      return;
    const target = this.channels[n - 1];
    if (target)
      this.selectUrl(target.url);
  }
  setGroup(group) {
    this.activeGroup = group === null || group === "" ? null : group;
    this.favoriteOnly = false;
    this.listIndex = 0;
    this.focusZone = "list";
    this.pushChannels();
    this.pushFocus();
  }
  zapTo(index) {
    const channel = this.vis[index];
    if (!channel)
      return;
    this.currentUrl = channel.url;
    this.recordRecent(channel.url);
    if (this.form === "phone") {
      this.listIndex = index;
    } else {
      this.expandedGroups.add(channel.group || "");
      const flat = this.flatIndexOf(channel.url);
      if (flat >= 0)
        this.listIndex = flat;
    }
    this.pushChannels();
    this.pushNowPlaying();
    this.pushFocus();
    this.ensureVideoRect();
    this.media.prepare(channel.url).then((prepared) => {
      if (!prepared.ok) {
        this.mediaPush({
          state: "error",
          message: prepared.failure.message ?? prepared.failure.kind
        });
        return;
      }
      return this.media.play().then((played) => {
        if (!played.ok) {
          this.mediaPush({
            state: "error",
            message: played.failure.message ?? played.failure.kind
          });
          return;
        }
        this.mediaPush(played.value);
      });
    });
  }
  ensureVideoRect() {
    const r = this.fullscreen && this.form === "tv" ? FULLSCREEN_RECT : this.videoRect;
    this.media.setRect(r.x, r.y, r.w, r.h);
  }
  select(index) {
    if (index < 0 || index >= this.vis.length)
      return;
    if (index !== this.currentIndex)
      this.zapTo(index);
    else
      this.pushFocus();
  }
  async loadPlaylist(url) {
    const fetched = await this.media.fetchText(url);
    if (!fetched.ok) {
      this.app.pushTo("settings", "loadResult", {
        ok: false,
        message: fetched.failure.message ?? fetched.failure.kind
      });
      return;
    }
    const entries = parsePlaylist(fetched.value);
    if (entries.length === 0) {
      this.app.pushTo("settings", "loadResult", {
        ok: false,
        message: "playlist parsed to zero channels"
      });
      return;
    }
    this.channels = entries;
    this.activeGroup = null;
    this.favoriteOnly = false;
    this.currentUrl = null;
    this.expandedGroups = new Set([...this.allGroups(), FAVORITES_GROUP]);
    this.pruneAdopted();
    this.persistFavorites();
    this.persistRecents();
    this.pushChannels();
    this.zapTo(0);
    this.focusZone = "list";
    this.pushFocus();
    this.navigate("player");
    this.app.pushTo("settings", "loadResult", {
      ok: true,
      message: `${entries.length} channels`
    });
  }
  mediaPush(status) {
    this.status = status;
    this.pushMedia();
  }
  recordRecent(url) {
    this.recents = [url, ...this.recents.filter((u) => u !== url)].slice(0, RECENTS_MAX);
    this.persistRecents();
    this.pushChannels();
  }
  pushChannels() {
    this.app.pushState("channels", {
      channels: this.vis,
      groups: this.groups(),
      activeGroup: this.activeGroup,
      expanded: [...this.expandedGroups],
      favorites: [...this.favorites],
      favoriteOnly: this.favoriteOnly,
      recents: this.recents
    });
  }
  pushFocus() {
    const focus = {
      index: this.focusZone === "rail" ? this.focusIndex : this.listIndex,
      listIndex: this.listIndex,
      zone: this.focusZone,
      fullscreen: this.fullscreen
    };
    this.app.pushState("focus", focus);
  }
  pushNowPlaying() {
    const channel = this.channels.find((c) => c.url === this.currentUrl);
    if (!channel)
      return;
    const now = {
      index: Math.max(0, this.currentIndex),
      title: channel.title,
      url: channel.url
    };
    this.app.pushState("channel", now);
  }
  pushMedia() {
    this.app.pushState("media", this.status);
  }
}

// embedders/android/tools/gallery-bundle/tvplayer-entry.ts
var host = globalThis;
var nextTimerId = 1;
var activeTimers = new Map;
function drainTimers() {
  const now = Date.now();
  for (const [id, t] of Array.from(activeTimers.entries())) {
    if (now >= t.runAt) {
      activeTimers.delete(id);
      try {
        t.fn();
      } catch {}
    }
  }
}
if (typeof host.setTimeout !== "function") {
  host.setTimeout = (fn, ms = 0) => {
    const id = nextTimerId++;
    const delay = Math.max(0, ms);
    activeTimers.set(id, { id, runAt: Date.now() + delay, fn });
    if (typeof host.tenun_host_call === "function") {
      try {
        host.tenun_host_call("system", "scheduleTimer", JSON.stringify({ delayMs: delay }));
      } catch {}
    }
    return id;
  };
  host.clearTimeout = (id) => {
    activeTimers.delete(id);
  };
}
var hostCall = host.tenun_host_call;
var UNSUPPORTED = {
  ok: false,
  failure: { kind: "unsupported", message: "tvplayer: media host unavailable" }
};
var pendingFetch = new Map;
var nativeMediaBridge = {
  contractVersion: 1,
  prepare: (url) => invokeJson("prepare", { url }),
  play: () => invokeJson("play", {}),
  pause: () => invokeJson("pause", {}),
  stop: () => invokeJson("stop", {}),
  setRect: (x, y, w, h) => invokeJson("setRect", { x, y, w, h }),
  status: () => invokeJson("status", {}),
  fetchText: (url) => {
    if (typeof hostCall !== "function")
      return Promise.resolve(UNSUPPORTED);
    const parsed = parseReply(hostCall("media", "fetchText", JSON.stringify({ url })));
    if (parsed === null || !parsed.ok) {
      return Promise.resolve(parsed ?? UNSUPPORTED);
    }
    const ticket = parsed.value?.ticket;
    if (typeof ticket !== "number")
      return Promise.resolve(UNSUPPORTED);
    return new Promise((resolve) => {
      pendingFetch.set(ticket, resolve);
    });
  }
};
function invokeJson(method, payload) {
  if (typeof hostCall !== "function")
    return Promise.resolve(UNSUPPORTED);
  const parsed = parseReply(hostCall("media", method, JSON.stringify(payload)));
  return Promise.resolve(parsed ?? UNSUPPORTED);
}
function parseReply(reply) {
  if (reply === null || reply === undefined)
    return null;
  try {
    const parsed = JSON.parse(reply);
    if (parsed.ok === true)
      return { ok: true, value: parsed.value };
    if (parsed.ok === false && parsed.failure !== null && typeof parsed.failure === "object" && typeof parsed.failure.kind === "string") {
      return { ok: false, failure: parsed.failure };
    }
    return null;
  } catch {
    return null;
  }
}
function resolveTicket(payloadJson) {
  let ticket;
  let result = UNSUPPORTED;
  try {
    const parsed = JSON.parse(payloadJson);
    if (typeof parsed.ticket === "number")
      ticket = parsed.ticket;
    if (parsed.ok === true && typeof parsed.text === "string") {
      result = { ok: true, value: parsed.text };
    } else if (parsed.ok === false) {
      result = {
        ok: false,
        failure: {
          kind: "unavailable",
          message: typeof parsed.message === "string" ? parsed.message : "fetch failed"
        }
      };
    }
  } catch {
    return;
  }
  if (ticket !== undefined) {
    const resolve = pendingFetch.get(ticket);
    if (resolve) {
      pendingFetch.delete(ticket);
      resolve(result);
    }
  }
}
var form = host.__TVPLAYER_FORM__ === "phone" ? "phone" : "tv";
var nativeStorageBridge = {
  contractVersion: 1,
  availability: () => ({ status: "supported" }),
  permissionPrerequisites: () => [],
  get: (key) => storageJson("get", { key }),
  set: (key, value) => storageJson("set", { key, value }),
  remove: (key) => storageJson("remove", { key }),
  keys: () => storageJson("keys", {})
};
function storageJson(method, payload) {
  if (typeof hostCall !== "function")
    return Promise.resolve(UNSUPPORTED);
  const parsed = parseReply(hostCall("storage", method, JSON.stringify(payload)));
  return Promise.resolve(parsed ?? UNSUPPORTED);
}
var app = new TvplayerRuntime({
  media: nativeMediaBridge,
  storage: nativeStorageBridge,
  formFactor: form
});
var handoff = installHostHandoff({
  app: {
    route: () => app.route(),
    stateSchema: () => app.stateSchema(),
    exportState: () => app.exportState(),
    onStateInvalidation: (listener) => app.onStateInvalidation(listener),
    dispatch: (action, payload) => app.dispatch(action, payload),
    render: () => app.render(),
    goBack: () => app.goBack()
  },
  commit: (json) => {
    const sink = host["tenun_commit"];
    if (typeof sink === "function") {
      sink(json);
    } else {
      host["__tenun_last_scene"] = json;
    }
  }
});
host["__tenun_dispatch_action"] = (action, payloadJson) => {
  drainTimers();
  const norm = action.toUpperCase();
  if (norm === "KEY") {
    let keyCode = -1;
    let phase = "down";
    try {
      const parsed = JSON.parse(payloadJson || "{}");
      if (typeof parsed.keyCode === "number")
        keyCode = parsed.keyCode;
      if (typeof parsed.phase === "string")
        phase = parsed.phase;
    } catch {}
    const handled = keyCode >= 0 && app.keyPress(keyCode, phase);
    return JSON.stringify({ handled });
  }
  if (norm === "MEDIA_STATE") {
    app.dispatch("MEDIA_STATE", safeParse(payloadJson));
    return JSON.stringify({ route: app.route() });
  }
  if (norm === "MEDIA_TEXT") {
    resolveTicket(payloadJson);
    return JSON.stringify({ route: app.route() });
  }
  return handoff.dispatch(action, payloadJson);
};
function safeParse(payloadJson) {
  try {
    return JSON.parse(payloadJson || "{}");
  } catch {
    return {};
  }
}
if (typeof host["tenun_commit"] !== "function") {
  host["__tenun_device_test"] = {
    route: () => app.route(),
    dispatch: host["__tenun_dispatch_action"],
    lastScene: () => host["__tenun_last_scene"]
  };
}

})();
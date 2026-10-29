(() => {
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
    text: { variant: { type: "string" }, color: { type: "string" } },
    button: { variant: { type: "string" }, onPress: { type: "function" } },
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
      background: { type: "string" },
      elevation: { type: "boolean" },
      semantics: { type: "object" }
    },
    "app-bar": { title: { type: "string", required: true }, onMenu: { type: "function" } },
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
      const rawProps = fragmentProps;
      const children = rawProps.children;
      delete rawProps.children;
      const fragmentKey = extractKey(key, rawProps);
      return {
        kind: Fragment,
        key: fragmentKey,
        props: fragmentProps,
        children: normalizeChildren(children)
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
  var CenterKind = Symbol.for("tenun.widgets.center");
  var StackKind = Symbol.for("tenun.widgets.stack");
  var PositionedKind = Symbol.for("tenun.widgets.positioned");
  var ExpandedKind = Symbol.for("tenun.widgets.expanded");
  function Expanded(props) {
    return virtual(ExpandedKind, props);
  }
  var GestureDetectorKind = Symbol.for("tenun.widgets.gesture-detector");
  var ContainerKind = Symbol.for("tenun.widgets.container");
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
    const { id, value: text, onChanged, label = "", placeholder = "", readOnly = false, onSubmitted } = value;
    const fieldId = identifier(id, "INVALID_TEXT_FIELD");
    if (typeof text !== "string" || typeof label !== "string" || typeof placeholder !== "string" || typeof readOnly !== "boolean" || typeof onChanged !== "function" || onSubmitted !== undefined && typeof onSubmitted !== "function") {
      fail("INVALID_TEXT_FIELD", "TextField requires string value/labels, boolean readOnly, and typed callbacks");
    }
    if (/[\r\n]/.test(text))
      fail("INVALID_TEXT_FIELD", "Single-line TextField value must not contain CR or LF");
    return Object.freeze({
      id: fieldId,
      value: text,
      label,
      placeholder,
      readOnly,
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
    if (op !== "text-input" || typeof focused !== "boolean" || typeof readOnly !== "boolean" || typeof label !== "string" || keyboardType !== "text" || returnAction !== "done") {
      fail(code, "invalid text-input descriptor flags, label, or keyboard intent");
    }
    for (const [name, dimension] of Object.entries({ x, y, w, h })) {
      if (typeof dimension !== "number" || !Number.isFinite(dimension) || (name === "w" || name === "h") && dimension < 0)
        fail(code, `${name} must be valid finite geometry`);
    }
    const sid = integer(sessionId, 0, code, "sessionId");
    const rev = integer(revision, 0, code, "revision");
    const state = editingValue(copy, code);
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
      keyboardType: "text",
      returnAction: "done",
      readOnly: props.readOnly,
      label: props.label
    });
  }

  // packages/widgets/src/display-list.ts
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
  function spacing(value, fallback) {
    if (typeof value === "number")
      return value;
    if (typeof value === "string" && value in SPACING)
      return SPACING[value];
    return fallback;
  }
  function radius(value, fallback) {
    if (typeof value === "number")
      return value;
    if (typeof value === "string" && value in RADIUS)
      return RADIUS[value];
    return fallback;
  }
  function typography(variant) {
    if (typeof variant === "string" && variant in TYPOGRAPHY)
      return TYPOGRAPHY[variant];
    return TYPOGRAPHY.body;
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
  function callComponent(node) {
    const fn = node.kind;
    return asNode(fn({ ...node.props, children: node.children }));
  }
  function resolveOnce(ctx, node) {
    let resolved = ctx.componentCache.get(node);
    if (!resolved) {
      resolved = callComponent(node);
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
  function gapOf(props) {
    return nonnegative(spacing(props.gap, 0), "gap");
  }
  function paddingOf(props, fallback) {
    return nonnegative(spacing(props.padding, fallback), "padding");
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
    const pad = paddingOf(node.props, 0);
    const gap = gapOf(node.props);
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
      const natural = frames.reduce((sum, frame) => sum + frame.w, 0);
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
    const fixedMain = nonnegative(frames.reduce((sum, frame) => sum + (horizontal ? frame.w : frame.h), 0), "combined child size");
    const free = Number.isFinite(mainMax) ? Math.max(mainMax - gaps - fixedMain, 0) : 0;
    flexes.forEach((flex, index) => {
      if (flex > 0)
        frames[index] = measure(ctx, kids[index], childBounds(free * (flex / flexSum)));
    });
    if (horizontal && align === "stretch" && !Number.isFinite(crossMax)) {
      const height = Math.max(...frames.map((frame) => frame.h), 0);
      frames.forEach((frame, index) => {
        if (!frame.bounds)
          throw new LayoutError("INVALID_CONSTRAINT", "Missing measured child constraints");
        frames[index] = measure(ctx, kids[index], { ...frame.bounds, minH: height, maxH: height });
      });
    }
    const naturalMain = nonnegative(frames.reduce((sum, frame) => sum + (horizontal ? frame.w : frame.h), 0) + gaps, "combined child size");
    const naturalCross = Math.max(...frames.map((frame) => horizontal ? frame.h : frame.w), 0);
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
    const pad = paddingOf(node.props, 0);
    const gap = gapOf(node.props);
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
    const naturalMain = nonnegative(frames.reduce((sum, frame) => sum + frame.h, 0) + gaps, "content height");
    const naturalCross = Math.max(...frames.map((frame) => frame.w), 0);
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
    if (kind === ThemeScope)
      return decorationLayout(ctx, node, bounds).frame;
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
      return decorationLayout(ctx, node, own, paddingOf(props, 0)).frame;
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
        const ty = typography(props.variant);
        const lines = wrapText(textContent(node), ty.size, Math.max(bounds.maxW, 1));
        const widest = Math.max(...lines.map((line) => textWidth(line, ty.size)));
        return constrain({ w: Math.min(widest, bounds.maxW), h: lines.length * ty.lineHeight }, bounds);
      }
      case "button": {
        const label = textContent(node) || "Button";
        return constrain({ w: Math.max(96, textWidth(label, TYPOGRAPHY.body.size) + 48), h: 64 }, bounds);
      }
      case "card":
        return decorationLayout(ctx, node, bounds, paddingOf(props, 16), spacing("sm", 8)).frame;
      case "column":
        return flexLayout(ctx, node, bounds, "column").frame;
      case "row":
        return flexLayout(ctx, node, bounds, "row").frame;
      case "app-bar":
        return constrain({ w: bounds.maxW, h: 96 }, bounds);
      case "spacer":
        return constrain({ w: 0, h: nonnegative(spacing(props.size, 16), "spacer size") }, bounds);
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
  function fieldTextWindow(text, size, width, offset = 0) {
    let cursor = 0;
    let start = 0;
    let visible = "";
    for (const character of text) {
      const advance = textWidth(character, size);
      if (cursor >= offset && cursor + advance <= offset + width) {
        if (visible.length === 0)
          start = cursor - offset;
        visible += character;
      }
      cursor += advance;
      if (cursor > offset + width)
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
    const inset = Math.min(12, w / 2);
    const innerWidth = Math.max(0, w - inset * 2);
    const verticalInset = Math.min(2, h / 2);
    const clip = { x: x + inset, y: y + verticalInset, w: innerWidth, h: Math.max(0, h - verticalInset * 2) };
    const size = Math.min(17, h / 3);
    const baseline = y + Math.min(h, props.label ? h * 0.72 : h / 2 + size * 0.36);
    const textTop = Math.max(y, baseline - size);
    const radius = Math.min(8, w / 2, h / 2);
    ctx.ops.push({ op: "rect", x, y, w, h, r: radius, color: surface });
    ctx.ops.push({
      op: "outline",
      x,
      y,
      w,
      h,
      r: radius,
      color: descriptor.focused ? C.primary : C.outline,
      width: descriptor.focused ? 2 : 1
    });
    if (props.label && innerWidth > 0 && h > 0) {
      const labelSize = Math.min(12, size);
      ctx.ops.push({
        op: "text",
        x: x + inset,
        y: y + Math.min(h, 17),
        text: fieldTextWindow(props.label, labelSize, innerWidth).text,
        size: labelSize,
        weight: 500,
        color: descriptor.focused ? C.primary : foreground,
        clip
      });
    }
    const extentX = textWidth(descriptor.text.slice(0, descriptor.selection.extent), size);
    const offset = descriptor.focused ? Math.max(0, extentX - innerWidth + 1) : 0;
    const position = (index) => x + inset + Math.max(0, Math.min(innerWidth, textWidth(descriptor.text.slice(0, index), size) - offset));
    let selected;
    if (descriptor.focused && descriptor.selection.base !== descriptor.selection.extent) {
      const left = position(Math.min(descriptor.selection.base, descriptor.selection.extent));
      const right = position(Math.max(descriptor.selection.base, descriptor.selection.extent));
      selected = { x: left, y: textTop, w: right - left, h: Math.max(0, Math.min(h, size * 1.2)) };
      ctx.ops.push({ op: "rect", ...selected, r: 0, color: C.primaryContainer });
    }
    const shown = descriptor.text || props.placeholder;
    const window = fieldTextWindow(shown, size, innerWidth, descriptor.text ? offset : 0);
    if (window.text && h > 0) {
      const text = {
        op: "text",
        x: x + inset + window.x,
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
    if (!props.readOnly) {
      addTap(ctx, x, y, w, h, () => {
        if (!ctx.textInput) {
          throw new TextInputError("TEXT_INPUT_RUNTIME_REQUIRED", "Editable TextField focus requires ApplicationRuntime");
        }
        ctx.textInput.focus(props.id);
      });
    }
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
      const scoped = {
        ...ctx,
        palette: merged,
        theme: { ...ctx.theme, colors: { ...ctx.theme.colors, ...scopeThemeColors(merged) } }
      };
      placeChildren(scoped, decorationLayout(scoped, node, bounds), x, y);
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
      ctx.ops = [];
      ctx.tapRegions = [];
      let nestedOps = [];
      let nestedTaps = [];
      try {
        placeChildren(ctx, layout, 0, 0);
        nestedOps = ctx.ops;
        nestedTaps = ctx.tapRegions;
      } finally {
        ctx.ops = outerOps;
        ctx.tapRegions = outerTaps;
      }
      const contentHeight = layout.children.length > 0 ? Math.max(...layout.children.map((child) => child.y + child.frame.h)) + paddingOf(props, 0) : 0;
      for (const tap of nestedTaps)
        outerTaps.push({ ...tap, scroll: regionId });
      outerOps.push({ op: "scroll-region", id: regionId, x, y, w, h, contentHeight, ops: nestedOps });
      return h;
    }
    if (kind === ExpandedKind || kind === PositionedKind) {
      placeChildren(ctx, decorationLayout(ctx, node, bounds), x, y);
      return h;
    }
    if (kind === GestureDetectorKind) {
      placeChildren(ctx, decorationLayout(ctx, node, bounds), x, y);
      if (typeof props.onTap === "function")
        addTap(ctx, x, y, w, h, props.onTap);
      if (typeof props.onLongPress === "function") {
        addTap(ctx, x, y, w, h, props.onLongPress, "long-press");
      }
      return h;
    }
    if (kind === ContainerKind) {
      const pad = paddingOf(props, 0);
      const radius = dimension(props, "radius") ?? 0;
      const fill = roleColor(ctx, props.color);
      if (fill !== undefined) {
        const shadow = typeof props.shadow === "number" ? props.shadow : undefined;
        ctx.ops.push({ op: "rect", x, y, w, h, r: radius, color: fill, ...shadow ? { shadow } : {} });
      }
      const stroke = roleColor(ctx, props.borderColor);
      if (stroke !== undefined) {
        const width = dimension(props, "borderWidth") ?? 3;
        ctx.ops.push({ op: "outline", x, y, w, h, r: radius, color: stroke, width });
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
        const ty = typography(props.variant);
        const lines = wrapText(textContent(node), ty.size, Math.max(w, 1));
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
        return h;
      }
      case "button": {
        const ty = TYPOGRAPHY.body;
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
          addTap(ctx, x, y, w, h, props.onPress);
        }
        return h;
      }
      case "card": {
        const pad = paddingOf(props, 16);
        const elevated = props.background === "surface" || props.elevation === true;
        ctx.ops.push({
          op: "rect",
          x,
          y,
          w,
          h,
          r: radius(props.radius, 14),
          color: roleColor(ctx, props.background) ?? ctx.theme.colors?.surfaceRaised ?? "#1C1C24",
          ...elevated ? { shadow: 12 } : {}
        });
        placeChildren(ctx, decorationLayout(ctx, node, bounds, pad, spacing("sm", 8)), x, y);
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
        if (hasMenu) {
          ctx.ops.push({ op: "text", x: x + 36, y: y + 62, text: "☰", size: 34, weight: 600, color: ctx.theme.colors?.text ?? "#F2F2F7" });
          addTap(ctx, x + 12, y + 12, 72, 72, props.onMenu);
        }
        const title = typeof props.title === "string" ? props.title : "";
        ctx.ops.push({
          op: "text",
          x: x + titleX,
          y: y + 62,
          text: title,
          size: 32,
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
    const spacingValue = spacing(node.props.spacing, 8);
    const runSpacing = spacing(node.props.runSpacing, 8);
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
  }
  function layoutScreen(theme, tree, viewportOrWidth = DESIGN_WIDTH, textInput) {
    const viewport = typeof viewportOrWidth === "number" ? undefined : validateLayoutViewport(viewportOrWidth);
    const designWidth = typeof viewportOrWidth === "number" ? viewportOrWidth : viewport.width;
    if (!Number.isFinite(designWidth) || designWidth <= 0) {
      throw new LayoutError("INVALID_VIEWPORT", "Design width must be a positive finite number");
    }
    const ctx = {
      theme,
      designWidth,
      palette: resolveRoles(theme),
      ops: [],
      tapRegions: [],
      tapRuns: [],
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
          taps: ctx.tapRegions
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
    return { scene, tapRuns: ctx.tapRuns, textFields: ctx.textFields };
  }
  // packages/widgets/src/app-runtime.ts
  var APPLICATION_STATE_SCHEMA = 1;

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
    services;
    designWidth;
    viewport;
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
    navigate(name, options) {
      this.assertLive();
      if (!(name in this.screens)) {
        throw new ApplicationRuntimeError("UNKNOWN_SCREEN", `unknown screen "${name}"`);
      }
      this.pendingTransition = options?.transition === undefined ? null : normalizeSceneTransition(options.transition);
      if (this.current !== name)
        this.endTextInput();
      this.current = name;
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
    render() {
      this.assertLive();
      const session = this.sessions.get(this.current) ?? this.mount(this.current);
      this.sessions.set(this.current, session);
      const tree = this.screens[session.name].view({
        state: session.state,
        actions: session.actions
      });
      if (tree === null || tree === undefined) {
        throw new ApplicationRuntimeError("INVALID_VIEW", `screen "${session.name}" produced a null view`);
      }
      const { scene, tapRuns, textFields } = layoutScreen(this.theme, tree, this.viewport ?? this.designWidth, {
        active: this.activeTextInput,
        focus: (id) => this.focusTextInput(id)
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
        this.pendingTransition = null;
      }
      return { scene, tapRuns };
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
        if (normalized === "TEXT_SUBMIT")
          field.props.onSubmitted?.();
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
  function installHostHandoff(options) {
    const { app } = options;
    let last = null;
    const commit = () => {
      const json = JSON.stringify(app.render().scene);
      if (typeof options.commit === "function") {
        options.commit(json);
      } else {
        last = json;
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
      const textInput = normalized === "TEXT_EDIT" || normalized === "TEXT_BLUR" || normalized === "TEXT_SUBMIT";
      try {
        app.dispatch(normalized, payload);
      } catch (error) {
        if (textInput && error instanceof TextInputError && (error.code === "STALE_TEXT_SESSION" || error.code === "STALE_TEXT_REVISION"))
          commit();
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

  class ThemeContractError extends Error {
    code;
    constructor(code, message) {
      super(`[TENUN_THEME_CONTRACT] ${message}`);
      this.code = code;
      this.name = "ThemeContractError";
    }
  }
  var slots = new Set(SEMANTIC_COLOR_SLOTS);
  var own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  function isSlot(value) {
    return typeof value === "string" && (slots.has(value) || /^app\.[A-Za-z][A-Za-z0-9_]*$/.test(value));
  }
  function paletteTheme(palette) {
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
        onPrimaryFixed: p.onPrimaryFixed
      }
    };
  }
  function defineColorPalette(palette) {
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
  function AppBar(props) {
    const node = jsx(HostWidgetKind.APP_BAR, {
      title: props.title,
      ...props.onMenu ? { onMenu: props.onMenu } : {}
    });
    return node;
  }
  function Column(props) {
    return jsx(HostWidgetKind.COLUMN, props);
  }
  function Row(props) {
    return jsx(HostWidgetKind.ROW, props);
  }
  function ScrollView(props) {
    const { children, ...rest } = props;
    return {
      kind: ScrollViewKind,
      key: null,
      props: rest,
      children: flattenScrollChildren(children)
    };
  }
  function flattenScrollChildren(children) {
    if (children === undefined || children === null)
      return [];
    if (!Array.isArray(children))
      return [children];
    const flattened = [];
    const walk = (items) => {
      for (const item of items) {
        if (item === undefined || item === null)
          continue;
        if (Array.isArray(item))
          walk(item);
        else
          flattened.push(item);
      }
    };
    walk(children);
    return flattened;
  }
  function Text(props) {
    return jsx(HostWidgetKind.TEXT, props);
  }
  function Button(props) {
    return jsx(HostWidgetKind.BUTTON, props);
  }
  function Card(props) {
    return jsx(HostWidgetKind.CARD, props);
  }

  // examples/framework-feel/src/plan.ts
  var PLAN_TASKS = Object.freeze([
    "Review layout",
    "Check interactions",
    "Record a demo"
  ]);
  var defaultPlanTitle = "Release day";
  function checkedCompleted(value) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > PLAN_TASKS.length) {
      throw new TypeError("Day Plan completion must be an integer between 0 and 3");
    }
    return value;
  }
  function checkedPlanTitle(value) {
    if (typeof value !== "string")
      throw new TypeError("Day Plan title must be a string");
    return value;
  }
  function checkedPlanProgress(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Day Plan progress must contain a completion count and title");
    }
    const progress = value;
    return { completed: checkedCompleted(progress.completed), planTitle: checkedPlanTitle(progress.planTitle) };
  }
  function navigatePlan(services, route, progress) {
    const navigate = services.navigate;
    if (typeof navigate !== "function")
      throw new TypeError("Day Plan requires a navigation service");
    navigate(route, progress);
  }
  // packages/core/src/index.ts
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
  // examples/ui-kit/src/components.tsx
  var KIT = {
    surface: "#101014",
    surfaceRaised: "#1C1C24",
    surfaceContainer: "#16161D",
    surfaceContainerHigh: "#232330",
    text: "#F2F2F7",
    textMuted: "#9AA3B2",
    primary: "#4C8DFF",
    onPrimary: "#FFFFFF",
    primaryContainer: "#223354",
    onPrimaryContainer: "#D6E4FF",
    secondaryContainer: "#30354A",
    onSecondaryContainer: "#DCE4FF",
    outline: "#474B5A",
    outlineVariant: "#26262F",
    track: "#2A2A35",
    success: "#3DD68C",
    warning: "#F5A623",
    danger: "#FF5A5F",
    white: "#FFFFFF"
  };
  var C = {
    primary: KIT.primary,
    onPrimary: KIT.onPrimary,
    primaryContainer: KIT.primaryContainer,
    onPrimaryContainer: KIT.onPrimaryContainer,
    secondaryContainer: KIT.secondaryContainer,
    onSecondaryContainer: KIT.onSecondaryContainer,
    surface: KIT.surface,
    surfaceContainer: KIT.surfaceContainer,
    surfaceContainerHigh: KIT.surfaceContainerHigh,
    onSurface: KIT.text,
    onSurfaceVariant: KIT.textMuted,
    outline: KIT.outline,
    outlineVariant: KIT.outlineVariant,
    error: KIT.danger,
    success: KIT.success,
    warning: KIT.warning,
    white: KIT.white
  };
  function canvasBox(props) {
    return { kind: Canvas, key: null, props, children: [] };
  }
  function CanvasBox(props) {
    return canvasBox(props);
  }
  // examples/framework-feel/src/screens/progress.screen.tsx
  var ProgressScreen = defineScreen({
    name: "Progress",
    initialState: () => ({ completed: 0, planTitle: defaultPlanTitle, detailsVisible: false }),
    actions: {
      receiveProgress({ state, input }) {
        const progress = checkedPlanProgress(input);
        state.completed = progress.completed;
        state.planTitle = progress.planTitle;
      },
      toggleDetails({ state }) {
        state.detailsVisible = !state.detailsVisible;
      },
      backToToday({ services }) {
        navigatePlan(services, "today");
      }
    },
    view({ state, actions }) {
      const progress = state.completed / PLAN_TASKS.length;
      const planTitle = state.planTitle === undefined ? defaultPlanTitle : state.planTitle;
      return /* @__PURE__ */ jsxDEV(Scaffold, {
        appBar: /* @__PURE__ */ jsxDEV(AppBar, {
          title: "Progress"
        }, undefined, false, undefined, this),
        children: /* @__PURE__ */ jsxDEV(Column, {
          padding: "lg",
          gap: "md",
          align: "stretch",
          children: [
            /* @__PURE__ */ jsxDEV(Card, {
              padding: "md",
              radius: "md",
              background: "surfaceRaised",
              children: /* @__PURE__ */ jsxDEV(Column, {
                gap: "xs",
                children: [
                  /* @__PURE__ */ jsxDEV(Text, {
                    variant: "caption",
                    children: planTitle || "Untitled plan"
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV(Text, {
                    variant: "title",
                    children: [
                      state.completed,
                      " of ",
                      PLAN_TASKS.length,
                      " complete"
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV(Expanded, {
              children: /* @__PURE__ */ jsxDEV(Card, {
                padding: "md",
                radius: "lg",
                background: "surfaceRaised",
                children: /* @__PURE__ */ jsxDEV(Column, {
                  gap: "md",
                  align: "stretch",
                  justify: "center",
                  children: [
                    /* @__PURE__ */ jsxDEV(CanvasBox, {
                      height: 200,
                      paint: ({ w }, put, _tap, palette) => {
                        put({
                          op: "ring",
                          cx: w / 2,
                          cy: 100,
                          r: 76,
                          width: 16,
                          progress,
                          color: palette.primary,
                          track: palette.surfaceContainer
                        });
                        put({
                          op: "text",
                          x: 0,
                          y: 112,
                          width: w,
                          align: "center",
                          text: `${Math.round(progress * 100)}%`,
                          size: 36,
                          weight: 700,
                          color: palette.onSurface
                        });
                      }
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV(Text, {
                      variant: "title",
                      children: "Small steps add up."
                    }, undefined, false, undefined, this),
                    state.detailsVisible ? /* @__PURE__ */ jsxDEV(Text, {
                      children: "Review layout, check interactions, and record a demo."
                    }, undefined, false, undefined, this) : null
                  ]
                }, undefined, true, undefined, this)
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV(Row, {
              gap: "md",
              align: "stretch",
              children: [
                /* @__PURE__ */ jsxDEV(Expanded, {
                  children: /* @__PURE__ */ jsxDEV(Button, {
                    variant: "tonal",
                    onPress: actions.backToToday,
                    children: "Back to today"
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV(Expanded, {
                  children: /* @__PURE__ */ jsxDEV(Button, {
                    onPress: actions.toggleDetails,
                    children: state.detailsVisible ? "Hide details" : "Show details"
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this);
    }
  });

  // examples/framework-feel/src/screens/today.screen.tsx
  var TodayScreen = defineScreen({
    name: "Today",
    initialState: () => ({ completed: 0, planTitle: defaultPlanTitle }),
    actions: {
      changePlanTitle({ state, input }) {
        state.planTitle = checkedPlanTitle(input);
      },
      completeTask({ state }) {
        state.completed = Math.min(PLAN_TASKS.length, state.completed + 1);
      },
      viewProgress({ state, services }) {
        navigatePlan(services, "progress", {
          completed: state.completed,
          planTitle: state.planTitle === undefined ? defaultPlanTitle : state.planTitle
        });
      },
      toggleTheme({ services }) {
        if (typeof services.toggleTheme !== "function") {
          throw new Error("Missing fixture theme toggle service");
        }
        services.toggleTheme();
      }
    },
    view({ state, actions }) {
      return /* @__PURE__ */ jsxDEV(Scaffold, {
        appBar: /* @__PURE__ */ jsxDEV(AppBar, {
          title: "Day Plan"
        }, undefined, false, undefined, this),
        children: /* @__PURE__ */ jsxDEV(Column, {
          padding: "lg",
          gap: "md",
          align: "stretch",
          children: [
            /* @__PURE__ */ jsxDEV(Row, {
              gap: "sm",
              align: "stretch",
              children: /* @__PURE__ */ jsxDEV(Expanded, {
                children: /* @__PURE__ */ jsxDEV(Button, {
                  variant: "text",
                  onPress: actions.toggleTheme,
                  children: "Toggle theme"
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV(Card, {
              padding: "md",
              radius: "md",
              background: "surfaceRaised",
              children: /* @__PURE__ */ jsxDEV(Column, {
                gap: "sm",
                align: "stretch",
                children: [
                  /* @__PURE__ */ jsxDEV(TextField, {
                    id: "plan-title",
                    label: "Plan title",
                    placeholder: "Name this plan",
                    value: state.planTitle === undefined ? defaultPlanTitle : state.planTitle,
                    onChanged: actions.changePlanTitle
                  }, undefined, false, undefined, this),
                  /* @__PURE__ */ jsxDEV(Row, {
                    gap: "sm",
                    children: [
                      /* @__PURE__ */ jsxDEV(Text, {
                        variant: "caption",
                        children: "Completed"
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV(Text, {
                        variant: "caption",
                        children: [
                          state.completed,
                          " / ",
                          PLAN_TASKS.length
                        ]
                      }, undefined, true, undefined, this)
                    ]
                  }, undefined, true, undefined, this)
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV(Expanded, {
              children: /* @__PURE__ */ jsxDEV(Card, {
                padding: "md",
                radius: "lg",
                background: "surfaceRaised",
                children: /* @__PURE__ */ jsxDEV(Column, {
                  gap: "md",
                  align: "stretch",
                  children: [
                    /* @__PURE__ */ jsxDEV(Text, {
                      variant: "title",
                      children: "Today's checklist"
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV(Expanded, {
                      children: /* @__PURE__ */ jsxDEV(ScrollView, {
                        id: "today-checklist",
                        children: /* @__PURE__ */ jsxDEV(Row, {
                          gap: "md",
                          align: "stretch",
                          children: [
                            /* @__PURE__ */ jsxDEV(Expanded, {
                              flex: 2,
                              children: /* @__PURE__ */ jsxDEV(Column, {
                                gap: "sm",
                                align: "stretch",
                                children: PLAN_TASKS.map((task, index) => /* @__PURE__ */ jsxDEV(Card, {
                                  padding: "sm",
                                  radius: "sm",
                                  background: "surface",
                                  children: /* @__PURE__ */ jsxDEV(Column, {
                                    gap: "xs",
                                    children: [
                                      /* @__PURE__ */ jsxDEV(Text, {
                                        children: task
                                      }, undefined, false, undefined, this),
                                      /* @__PURE__ */ jsxDEV(Text, {
                                        variant: "caption",
                                        children: index < state.completed ? "Done" : "Ready"
                                      }, undefined, false, undefined, this)
                                    ]
                                  }, undefined, true, undefined, this)
                                }, task, false, undefined, this))
                              }, undefined, false, undefined, this)
                            }, undefined, false, undefined, this),
                            /* @__PURE__ */ jsxDEV(Expanded, {
                              children: /* @__PURE__ */ jsxDEV(Card, {
                                padding: "sm",
                                radius: "sm",
                                background: "surface",
                                children: /* @__PURE__ */ jsxDEV(Column, {
                                  gap: "sm",
                                  children: [
                                    /* @__PURE__ */ jsxDEV(Text, {
                                      variant: "title",
                                      children: "Next"
                                    }, undefined, false, undefined, this),
                                    /* @__PURE__ */ jsxDEV(Text, {
                                      children: state.completed === PLAN_TASKS.length ? "The checklist is complete. Inspect your progress." : "Finish one task, then inspect your progress."
                                    }, undefined, false, undefined, this)
                                  ]
                                }, undefined, true, undefined, this)
                              }, undefined, false, undefined, this)
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this)
                      }, undefined, false, undefined, this)
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this)
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV(Row, {
              gap: "md",
              align: "stretch",
              children: [
                /* @__PURE__ */ jsxDEV(Expanded, {
                  children: /* @__PURE__ */ jsxDEV(Button, {
                    onPress: actions.completeTask,
                    children: "Complete task"
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV(Expanded, {
                  children: /* @__PURE__ */ jsxDEV(Button, {
                    variant: "tonal",
                    onPress: actions.viewProgress,
                    children: "View progress"
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this);
    }
  });

  // examples/framework-feel/src/theme.ts
  var dayPlanLight = {
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
    onPrimaryFixed: "#FFFFFF"
  };
  var dayPlanDark = {
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
    onPrimaryFixed: "#FFFFFF"
  };
  var dayPlanTheme = defineTheme(paletteTheme(dayPlanLight));
  var dayPlanDarkTheme = defineTheme(paletteTheme(dayPlanDark));

  // examples/framework-feel/src/runtime.ts
  var FRAMEWORK_FEEL_VIEWPORT = Object.freeze({ width: 720, height: 1000 });
  function createFrameworkFeelRuntime(viewport = FRAMEWORK_FEEL_VIEWPORT) {
    let dark = false;
    const app = new ApplicationRuntime({
      screens: { today: TodayScreen, progress: ProgressScreen },
      initial: "today",
      theme: dayPlanTheme,
      viewport,
      services: {
        navigate(route, progress) {
          if (route === "progress") {
            app.pushState("receiveProgress", checkedPlanProgress(progress));
          }
          app.navigate(route, {
            transition: { kind: "slide", direction: route === "progress" ? "forward" : "backward" }
          });
        },
        toggleTheme() {
          dark = !dark;
          app.setTheme(dark ? dayPlanDarkTheme : dayPlanTheme);
        }
      }
    });
    return app;
  }

  // examples/framework-feel/src/host-entry.ts
  var app = createFrameworkFeelRuntime();
  var host = globalThis;
  var handoff = installHostHandoff({
    app,
    commit(json) {
      const sink = host["tenun_commit"];
      if (typeof sink === "function")
        sink(json);
      else
        host["__tenun_last_scene"] = json;
    }
  });
  host["__tenun_dispatch_action"] = handoff.dispatch;
})();

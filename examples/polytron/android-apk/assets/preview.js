// ../../packages/protocol/src/index.ts
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

// ../../packages/jsx-runtime/src/prop-codecs.ts
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

// ../../packages/jsx-runtime/src/jsx-runtime.ts
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
var jsxs = jsx;
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
// ../../packages/widgets/src/structural.ts
var SizedBoxKind = Symbol.for("tenun.widgets.sized-box");
var CenterKind = Symbol.for("tenun.widgets.center");
var StackKind = Symbol.for("tenun.widgets.stack");
var PositionedKind = Symbol.for("tenun.widgets.positioned");
var ExpandedKind = Symbol.for("tenun.widgets.expanded");
var GestureDetectorKind = Symbol.for("tenun.widgets.gesture-detector");
var ContainerKind = Symbol.for("tenun.widgets.container");
var IconKind = Symbol.for("tenun.widgets.icon");
var WrapKind = Symbol.for("tenun.widgets.wrap");
// ../../packages/widgets/src/display-list.ts
var Canvas = Symbol.for("tenun.preview.canvas");
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
    onPrimary: "#FFFFFF",
    primaryContainer: c.primaryContainer ?? "#223354",
    onPrimaryContainer: c.onPrimaryContainer ?? "#D6E4FF",
    secondaryContainer: c.secondaryContainer ?? "#30354A",
    onSecondaryContainer: c.onSecondaryContainer ?? "#DCE4FF",
    surface: c.surface ?? "#101014",
    surfaceContainer: "#16161D",
    surfaceContainerHigh: "#232330",
    onSurface: c.text ?? "#F2F2F7",
    onSurfaceVariant: "#9AA3B2",
    outline: c.outline ?? "#474B5A",
    outlineVariant: c.outlineVariant ?? "#26262F",
    error: c.danger ?? "#FF5A5F",
    success: c.success ?? "#3DD68C",
    warning: c.warning ?? "#F5A623",
    inverseSurface: "#2E2E3C",
    onInverseSurface: "#F2F2F7",
    onPrimaryFixed: "#FFFFFF"
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
function gapOf(props) {
  return spacing(props.gap, 0);
}
function paddingOf(props, fallback) {
  return spacing(props.padding, fallback);
}
function measure(ctx, node, maxWidth) {
  const { kind, props } = node;
  if (typeof kind === "function") {
    return measure(ctx, resolveOnce(ctx, node), maxWidth);
  }
  if (kind === Canvas) {
    return { w: Math.min(typeof props.width === "number" ? props.width : maxWidth, maxWidth), h: Number(props.height ?? 0) };
  }
  if (kind === ThemeScope) {
    return measureStack(ctx, node, maxWidth, 0, 0);
  }
  if (kind === SizedBoxKind) {
    const width = typeof props.width === "number" ? props.width : undefined;
    const tight = width !== undefined ? Math.min(width, maxWidth) : maxWidth;
    let contentW = 0;
    let contentH = 0;
    for (const kid of childNodes(node)) {
      const frame = measure(ctx, kid, tight);
      contentW = Math.max(contentW, frame.w);
      contentH = Math.max(contentH, frame.h);
    }
    return {
      w: width !== undefined ? tight : Math.min(contentW, maxWidth),
      h: typeof props.height === "number" ? props.height : contentH
    };
  }
  if (kind === CenterKind) {
    let contentH = 0;
    for (const kid of childNodes(node))
      contentH = Math.max(contentH, measure(ctx, kid, maxWidth).h);
    return { w: maxWidth, h: contentH };
  }
  if (kind === StackKind) {
    let w = 0;
    let h = 0;
    for (const kid of childNodes(node).map((kid) => resolveNode(ctx, kid))) {
      if (kid.kind === PositionedKind)
        continue;
      const frame = measure(ctx, kid, maxWidth);
      w = Math.max(w, frame.w);
      h = Math.max(h, frame.h);
    }
    return { w: Math.min(w, maxWidth), h };
  }
  if (kind === WrapKind) {
    const flow = layoutWrapChildren(ctx, node, maxWidth);
    return { w: Math.min(flow.width, maxWidth), h: flow.height };
  }
  if (kind === ContainerKind) {
    const pad = paddingOf(props, 0);
    const width = typeof props.width === "number" ? props.width : undefined;
    const height = typeof props.height === "number" ? props.height : undefined;
    if (width !== undefined && height !== undefined) {
      return { w: Math.min(width, maxWidth), h: height };
    }
    if (childNodes(node).length === 0 && width === undefined) {
      return { w: maxWidth, h: height ?? 0 };
    }
    const inner = measureStack(ctx, node, Math.max((width ?? maxWidth) - pad * 2, 1), pad, 0);
    return {
      w: width !== undefined ? Math.min(width, maxWidth) : inner.w,
      h: height ?? inner.h
    };
  }
  if (kind === IconKind) {
    const size = typeof props.size === "number" ? props.size : 24;
    return {
      w: textWidth(typeof props.glyph === "string" ? props.glyph : "", size),
      h: Math.round(size * 1.2)
    };
  }
  if (kind === PositionedKind || kind === ExpandedKind || kind === GestureDetectorKind) {
    return measureStack(ctx, node, maxWidth, 0, 0);
  }
  if (typeof kind === "symbol") {
    return measureStack(ctx, node, maxWidth, 0, 0);
  }
  switch (kind) {
    case "text": {
      const ty = typography(props.variant);
      const lines = wrapText(textContent(node), ty.size, Math.max(maxWidth, 1));
      const widest = Math.max(...lines.map((line) => textWidth(line, ty.size)));
      return { w: Math.min(widest, maxWidth), h: lines.length * ty.lineHeight };
    }
    case "button": {
      const ty = TYPOGRAPHY.body;
      const label = textContent(node) || "Button";
      return { w: Math.min(maxWidth, Math.max(96, textWidth(label, ty.size) + 48)), h: 64 };
    }
    case "card": {
      const pad = paddingOf(props, 16);
      return measureStack(ctx, node, Math.max(maxWidth - pad * 2, 1), pad, spacing("sm", 8));
    }
    case "column": {
      const pad = paddingOf(props, 0);
      return measureStack(ctx, node, Math.max(maxWidth - pad * 2, 1), pad, gapOf(props));
    }
    case "row": {
      const pad = paddingOf(props, 0);
      const inner = Math.max(maxWidth - pad * 2, 1);
      const kids = childNodes(node).map((kid) => resolveNode(ctx, kid));
      if (kids.some((kid) => kid.kind === ExpandedKind)) {
        return { w: maxWidth, h: pad * 2 + layoutRowChildren(ctx, node, inner).rowHeight };
      }
      let h = 0;
      for (const kid of kids)
        h = Math.max(h, measure(ctx, kid, inner).h);
      return { w: maxWidth, h: pad * 2 + h };
    }
    case "app-bar":
      return { w: maxWidth, h: 96 };
    case "spacer":
      return { w: 0, h: spacing(props.size, 16) };
    case "scaffold": {
      const kids = widgetChildren(node).map((kid) => typeof kid.kind === "function" ? resolveOnce(ctx, kid) : kid);
      const appBar = kids.find((kid) => kid.kind === "app-bar");
      const body = kids.find((kid) => kid.kind !== "app-bar");
      const appBarH = appBar ? measure(ctx, appBar, maxWidth).h : 0;
      const bodyH = body ? measure(ctx, body, maxWidth).h : 0;
      return { w: maxWidth, h: appBarH + bodyH };
    }
    default:
      return { w: 0, h: 0 };
  }
}
function measureStack(ctx, node, innerWidth, pad, gap) {
  const kids = childNodes(node);
  let h = pad * 2;
  let widest = 0;
  for (let i = 0;i < kids.length; i++) {
    const frame = measure(ctx, kids[i], innerWidth);
    h += frame.h + (i > 0 ? gap : 0);
    widest = Math.max(widest, frame.w);
  }
  return { w: Math.min(pad * 2 + widest, Math.max(pad * 2 + innerWidth, 0)), h };
}
function place(ctx, node, x, y, w) {
  const { kind, props } = node;
  if (typeof kind === "function") {
    return place(ctx, resolveOnce(ctx, node), x, y, w);
  }
  if (kind === Canvas) {
    const fixedCanvas = props.fixed === true;
    const width = fixedCanvas ? ctx.designWidth : Math.min(typeof props.width === "number" ? props.width : w, w);
    const height = Number(props.height ?? 0);
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
    return placeStack(scoped, node, x, y, w, 0, 0);
  }
  if (kind === SizedBoxKind) {
    const tight = Math.min(typeof props.width === "number" ? props.width : w, w);
    let maxH = 0;
    for (const kid of childNodes(node)) {
      const frame = measure(ctx, kid, tight);
      maxH = Math.max(maxH, place(ctx, kid, x, y, frame.w));
    }
    return typeof props.height === "number" ? props.height : maxH;
  }
  if (kind === CenterKind) {
    const kids = childNodes(node);
    const frames = kids.map((kid) => measure(ctx, kid, w));
    const contentH = Math.max(...frames.map((frame) => frame.h), 0);
    kids.forEach((kid, index) => {
      const frame = frames[index];
      place(ctx, kid, x + Math.max((w - frame.w) / 2, 0), y + Math.max((contentH - frame.h) / 2, 0), frame.w);
    });
    return contentH;
  }
  if (kind === StackKind) {
    return placeStackWidget(ctx, node, x, y, w);
  }
  if (kind === ExpandedKind) {
    let h = 0;
    for (const kid of childNodes(node)) {
      h = Math.max(h, place(ctx, kid, x, y, w));
    }
    return h;
  }
  if (kind === PositionedKind) {
    return placeStack(ctx, node, x, y, w, 0, 0);
  }
  if (kind === GestureDetectorKind) {
    const h = placeStack(ctx, node, x, y, w, 0, 0);
    if (typeof props.onTap === "function") {
      addTap(ctx, x, y, w, h, props.onTap);
    }
    if (typeof props.onLongPress === "function") {
      addTap(ctx, x, y, w, h, props.onLongPress, "long-press");
    }
    return h;
  }
  if (kind === ContainerKind) {
    const pad = paddingOf(props, 0);
    const tight = Math.min(typeof props.width === "number" ? props.width : w, w);
    const height = typeof props.height === "number" ? props.height : undefined;
    const h = height ?? measureStack(ctx, node, Math.max(tight - pad * 2, 1), pad, 0).h;
    const radius = typeof props.radius === "number" ? props.radius : 0;
    const fill = roleColor(ctx, props.color);
    if (fill !== undefined) {
      const shadow = typeof props.shadow === "number" ? props.shadow : undefined;
      ctx.ops.push({ op: "rect", x, y, w: tight, h, r: radius, color: fill, ...shadow ? { shadow } : {} });
    }
    const stroke = roleColor(ctx, props.borderColor);
    if (stroke !== undefined) {
      const width = typeof props.borderWidth === "number" ? props.borderWidth : 3;
      ctx.ops.push({ op: "outline", x, y, w: tight, h, r: radius, color: stroke, width });
    }
    const stacked = placeStack(ctx, node, x, y, tight, pad, 0);
    return height !== undefined ? height : stacked;
  }
  if (kind === IconKind) {
    const size = typeof props.size === "number" ? props.size : 24;
    const glyph = typeof props.glyph === "string" ? props.glyph : "";
    const h = Math.round(size * 1.2);
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
    const flow = layoutWrapChildren(ctx, node, w);
    let cursorY = y;
    for (const line of flow.lines) {
      let cursorX = x;
      for (const entry of line.entries) {
        place(ctx, entry.kid, cursorX, cursorY, entry.frame.w);
        cursorX += entry.frame.w + flow.spacing;
      }
      cursorY += line.height + flow.runSpacing;
    }
    return flow.height;
  }
  if (typeof kind === "symbol") {
    return placeStack(ctx, node, x, y, w, 0, 0);
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
      return lines.length * ty.lineHeight;
    }
    case "button": {
      const ty = TYPOGRAPHY.body;
      const label = textContent(node) || "Button";
      const variant = typeof props.variant === "string" ? props.variant : "primary";
      const palette = ctx.theme.colors ?? {};
      const accent = palette.accent ?? "#4C8DFF";
      const danger = palette.danger ?? "#FF5A5F";
      const h = 64;
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
      const inner = Math.max(w - pad * 2, 1);
      const h = measureStack(ctx, node, inner, pad, spacing("sm", 8)).h;
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
      return placeStack(ctx, node, x, y, w, pad, spacing("sm", 8));
    }
    case "column": {
      const pad = paddingOf(props, 0);
      return placeStack(ctx, node, x, y, w, pad, gapOf(props), crossAlignOf(props, "start"));
    }
    case "row":
      return placeRow(ctx, node, x, y, w);
    case "app-bar": {
      ctx.ops.push({ op: "rect", x, y, w, h: 96, r: 0, color: ctx.theme.colors?.surface ?? "#101014" });
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
      return 96;
    }
    case "spacer":
      return spacing(props.size, 16);
    case "scaffold": {
      const frame = measure(ctx, node, w);
      ctx.ops.push({ op: "rect", x, y, w, h: frame.h, r: 0, color: ctx.theme.colors?.surface ?? "#101014" });
      const kids = widgetChildren(node);
      let consumed = 0;
      for (const kid of kids) {
        consumed += place(ctx, kid, x, y + consumed, w);
      }
      return consumed;
    }
    default:
      return 0;
  }
}
function offsetOp(op, dx, dy, defaults = {}) {
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
    case "text":
      return fixed ? { ...op, ...meta, x: op.x, y: op.y } : { ...op, x: op.x + dx, y: op.y + dy };
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
function placeStackWidget(ctx, node, x, y, w) {
  const kids = childNodes(node).map((kid) => resolveNode(ctx, kid));
  let frameH = 0;
  for (const kid of kids) {
    if (kid.kind === PositionedKind)
      continue;
    frameH = Math.max(frameH, measure(ctx, kid, w).h);
  }
  const rawAlign = typeof node.props.alignment === "string" ? node.props.alignment : "topLeft";
  const align = STACK_ALIGNMENT[rawAlign] ?? STACK_ALIGNMENT.topLeft;
  for (const kid of kids) {
    if (kid.kind === PositionedKind) {
      const { props } = kid;
      const left = typeof props.left === "number" ? props.left : undefined;
      const right = typeof props.right === "number" ? props.right : undefined;
      const top = typeof props.top === "number" ? props.top : undefined;
      const bottom = typeof props.bottom === "number" ? props.bottom : undefined;
      const inner = childNodes(kid);
      const tightW = left !== undefined && right !== undefined ? Math.max(w - left - right, 0) : undefined;
      const frames = inner.map((child) => measure(ctx, child, tightW ?? w));
      const useW = tightW ?? Math.max(...frames.map((frame) => frame.w), 0);
      const firstH = frames[0]?.h ?? 0;
      const cx = left !== undefined ? x + left : right !== undefined ? x + w - right - useW : x;
      const cy = top !== undefined ? y + top : bottom !== undefined ? y + frameH - bottom - firstH : y;
      inner.forEach((child, index) => {
        place(ctx, child, cx, cy, index === 0 ? useW : frames[index].w);
      });
    } else {
      const frame = measure(ctx, kid, w);
      place(ctx, kid, x + (w - frame.w) * align.ax, y + (frameH - frame.h) * align.ay, frame.w);
    }
  }
  return frameH;
}
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
function placeStack(ctx, node, x, y, w, pad, gap, align = "start") {
  const innerX = x + pad;
  const innerW = Math.max(w - pad * 2, 1);
  let cursor = y + pad;
  const kids = childNodes(node);
  for (let i = 0;i < kids.length; i++) {
    const kid = kids[i];
    const frame = measure(ctx, kid, innerW);
    const kidW = align === "stretch" ? innerW : frame.w;
    const kidX = align === "center" ? innerX + Math.max((innerW - frame.w) / 2, 0) : align === "end" ? innerX + Math.max(innerW - frame.w, 0) : innerX;
    cursor += place(ctx, kid, kidX, cursor, kidW) + (i < kids.length - 1 ? gap : 0);
  }
  return cursor + pad - y;
}
function layoutRowChildren(ctx, node, innerW) {
  const kids = childNodes(node).map((kid) => resolveNode(ctx, kid));
  const gap = gapOf(node.props);
  const frames = kids.map((kid) => measure(ctx, kid, innerW));
  if (!kids.some((kid) => kid.kind === ExpandedKind)) {
    const gapsTotal = kids.length > 1 ? gap * (kids.length - 1) : 0;
    const available = Math.max(innerW - gapsTotal, 1);
    let naturalW = frames.reduce((sum, frame) => sum + frame.w, 0);
    if (naturalW > available) {
      const SHRINK_MIN = 96;
      const shrinkable = kids.map((kid, index) => ({ kid, index, kind: kid.kind })).filter(({ kind }) => kind === "text" || kind === "column" || kind === "row");
      let excess = naturalW - available;
      if (shrinkable.length > 0) {
        const shrinkTotal = shrinkable.reduce((sum, entry) => sum + frames[entry.index].w, 0);
        for (const entry of shrinkable) {
          const frame = frames[entry.index];
          const share = shrinkTotal > 0 ? frame.w / shrinkTotal : 1 / shrinkable.length;
          const reduced = Math.max(frame.w - excess * share, Math.min(SHRINK_MIN, frame.w));
          const taken = frame.w - reduced;
          if (taken > 0) {
            frames[entry.index] = measure(ctx, entry.kid, reduced);
            excess -= taken;
          }
          if (excess <= 0)
            break;
        }
      }
    }
    return { kids, frames, rowHeight: frames.reduce((max, frame) => Math.max(max, frame.h), 0) };
  }
  const gapsTotal = kids.length > 1 ? gap * (kids.length - 1) : 0;
  let fixedW = 0;
  let flexSum = 0;
  const flexes = kids.map((kid) => {
    if (kid.kind !== ExpandedKind)
      return 0;
    const raw = kid.props.flex;
    return typeof raw === "number" && raw > 0 ? raw : 1;
  });
  flexes.forEach((flex, index) => {
    if (flex > 0)
      flexSum += flex;
    else
      fixedW += frames[index].w;
  });
  const free = Math.max(innerW - gapsTotal - fixedW, 0);
  const unit = flexSum > 0 ? free / flexSum : 0;
  flexes.forEach((flex, index) => {
    if (flex > 0) {
      const share = Math.max(unit * flex, 1);
      frames[index] = { w: share, h: measure(ctx, kids[index], share).h };
    }
  });
  return { kids, frames, rowHeight: frames.reduce((max, frame) => Math.max(max, frame.h), 0) };
}
function placeRow(ctx, node, x, y, w) {
  const pad = paddingOf(node.props, 0);
  const innerX = x + pad;
  const innerW = Math.max(w - pad * 2, 1);
  const justify = typeof node.props.justify === "string" ? node.props.justify : "start";
  const gap = gapOf(node.props);
  const align = crossAlignOf(node.props, "center");
  const { kids, frames, rowHeight } = layoutRowChildren(ctx, node, innerW);
  const naturalW = frames.reduce((sum, frame) => sum + frame.w, 0);
  const between = justify === "between" && kids.length > 1;
  const slack = Math.max(innerW - naturalW - (between ? 0 : gap * (kids.length - 1)), 0);
  const extra = between ? slack / Math.max(kids.length - 1, 1) : 0;
  const lead = !between && justify === "end" ? slack : !between && justify === "center" ? slack / 2 : 0;
  let cursor = innerX + lead;
  kids.forEach((kid, index) => {
    const frame = frames[index];
    const childY = align === "start" || align === "stretch" ? y + pad : align === "end" ? y + pad + rowHeight - frame.h : y + pad + (rowHeight - frame.h) / 2;
    place(ctx, kid, cursor, childY, frame.w);
    cursor += frame.w + (index < kids.length - 1 ? between ? extra : gap : 0);
  });
  return pad * 2 + rowHeight;
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
function layoutScreen(theme, tree, designWidth = DESIGN_WIDTH) {
  const ctx = {
    theme,
    designWidth,
    palette: resolveRoles(theme),
    ops: [],
    tapRegions: [],
    tapRuns: [],
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
  const frame = measure(ctx, asNode(tree), designWidth);
  place(ctx, asNode(tree), 0, 0, designWidth);
  const scene = ctx.finish();
  scene.contentHeight = frame.h;
  return { scene, tapRuns: ctx.tapRuns };
}
// ../../packages/widgets/src/app-runtime.ts
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
  onAsyncActionError;
  abort = createAbortSource();
  sessions = new Map;
  stateChannels = new Map;
  current;
  lastTapRuns = [];
  staleListeners = new Set;
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
    this.screens = options.screens;
    this.theme = options.theme;
    this.services = { ...options.services ?? {} };
    this.designWidth = options.designWidth;
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
  navigate(name) {
    this.assertLive();
    if (!(name in this.screens)) {
      throw new ApplicationRuntimeError("UNKNOWN_SCREEN", `unknown screen "${name}"`);
    }
    this.current = name;
    if (!this.sessions.has(name))
      this.sessions.set(name, this.mount(name));
    this.lastTapRuns = [];
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
    const { scene, tapRuns } = layoutScreen(this.theme, tree, this.designWidth);
    this.lastTapRuns = tapRuns;
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

// ../../packages/widgets/src/index.ts
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
function Text(props) {
  return jsx(HostWidgetKind.TEXT, props);
}

// src/theme.ts
var washerTheme = defineTheme({
  colors: {
    background: "#081110",
    surface: "#0C1720",
    surfaceRaised: "#101C26",
    accent: "#00B7FD",
    primaryContainer: "#0B2C4A",
    onPrimaryContainer: "#EAF3FC",
    secondaryContainer: "#2A2140",
    onSecondaryContainer: "#E4D9FF",
    outline: "#33475A",
    outlineVariant: "#24333F",
    text: "#EAF3FC",
    textDim: "#9DB2C7",
    danger: "#E8354A",
    success: "#00FF80",
    warning: "#FCB518"
  },
  spacing: { sm: 8, md: 14, lg: 20 },
  typography: {
    display: { size: 44, weight: "bold", color: "#EAF3FC" },
    headline: { size: 30, weight: "bold", color: "#EAF3FC" },
    title: { size: 17, weight: "bold", color: "#EAF3FC" },
    body: { size: 14, weight: "normal", color: "#D3DEE9" },
    label: { size: 11.5, weight: "bold", color: "#8FA6BC" },
    caption: { size: 11, weight: "normal", color: "#9DB2C7" }
  }
});
var MODE_COLORS = {
  WASH: "#00B7FD",
  DRAIN: "#00FFC8",
  FILL: "#00FF80",
  SPIN: "#BB86FC",
  WAIT: "#FCB518",
  STOP: "#FF3838",
  IDLE: "#9DB2C7"
};
function modeColor(mode) {
  return MODE_COLORS[mode] ?? "#EAF3FC";
}

// ../../packages/core/src/index.ts
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
// ../ui-kit/src/components.tsx
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
function softShadow(put, x, y, w, h, r, level = 2) {
  if (level === 2) {
    put({ op: "rect", x: x - 6, y: y + 4, w: w + 12, h: h + 12, r: r + 6, color: "#22000000" });
  }
  put({ op: "rect", x: x - 3, y: y + 2, w: w + 6, h: h + 7, r: r + 3, color: "#44000000" });
}
function SnackBar(props) {
  const h = 88;
  return canvasBox({
    height: h,
    paint: (origin, put, tap, pal) => {
      const C = pal;
      softShadow(put, 0, 0, origin.w, h, 16, 2);
      put({ op: "rect", x: 0, y: 0, w: origin.w, h, r: 16, color: C.inverseSurface });
      const actionW = props.actionLabel ? textWidth(props.actionLabel, 17) + 48 : 0;
      const messageW = origin.w - actionW - 64;
      const lines = wrapText(props.message, 16, messageW);
      const first = lines[0] ?? props.message;
      put({ op: "text", x: 32, y: h / 2 + 16 * 0.36, text: first, size: 16, weight: 400, color: C.onSurface });
      if (props.actionLabel) {
        put({
          op: "text",
          x: origin.w - actionW + 8,
          y: h / 2 + 17 * 0.36,
          text: props.actionLabel,
          size: 17,
          weight: 700,
          color: C.primary
        });
        if (props.onAction) {
          tap({ x: origin.w - actionW, y: 0, w: actionW, h }, props.onAction);
        }
      }
    }
  });
}
// src/widgets.tsx
var C2 = {
  card: "#101C26",
  cardOk: "#0E241C",
  cardWarn: "#231A0E",
  line: "#24333F",
  lineStrong: "#33475A",
  track: "#1A2833",
  txt: "#EAF3FC",
  dim: "#9DB2C7",
  faint: "#6E8496",
  off: "#586D7E",
  acc: "#00B7FD",
  accDeep: "#046FA4",
  red: "#E8354A",
  redDark: "#B32B3D",
  redFaint: "#8B6468",
  green: "#00FF80",
  amber: "#FCB518",
  orange: "#FF9F45",
  aqua: "#00FFC8",
  purple: "#BB86FC"
};
function drawIcon(kind, cx, cy, s, put, color) {
  const line = (x1, y1, x2, y2, width = 3) => put({ op: "line", x1, y1, x2, y2, color, width });
  const wave = (y, amp) => {
    line(cx - s, y + amp * 0.7, cx - s / 3, y - amp, 3);
    line(cx - s / 3, y - amp, cx + s / 3, y + amp * 0.7, 3);
    line(cx + s / 3, y + amp * 0.7, cx + s, y - amp, 3);
  };
  if (kind === "wash") {
    put({ op: "outline", x: cx - s, y: cy - s, w: s * 2, h: s * 2, r: s * 0.35, color, width: 3 });
    wave(cy + s * 0.15, s * 0.28);
  } else if (kind === "spin") {
    put({ op: "ring", cx, cy, r: s - 1, width: 3, color, progress: 0.72 });
    put({ op: "circle", cx, cy, r: s * 0.18 + 1, color });
    line(cx - s - 4, cy + s * 0.55, cx - s + 1, cy + s * 0.9, 3);
    line(cx + s - 1, cy - s * 0.9, cx + s + 4, cy - s * 0.55, 3);
  } else if (kind === "drain") {
    line(cx - s * 0.55, cy - s, cx, cy - s * 0.35, 3.5);
    line(cx, cy - s * 0.35, cx + s * 0.55, cy - s, 3.5);
    line(cx, cy - s, cx, cy + s * 0.25, 3.5);
    line(cx - s, cy + s * 0.7, cx + s, cy + s * 0.7, 3.5);
    line(cx - s, cy + s * 0.7, cx - s * 0.62, cy + s * 0.25, 3);
    line(cx + s, cy + s * 0.7, cx + s * 0.62, cy + s * 0.25, 3);
  } else if (kind === "droplet") {
    line(cx, cy - s, cx - s * 0.62, cy + s * 0.1, 3);
    line(cx, cy - s, cx + s * 0.62, cy + s * 0.1, 3);
    put({ op: "circle", cx, cy: cy + s * 0.25, r: s * 0.66, color });
    put({ op: "circle", cx: cx + s * 0.24, cy: cy + s * 0.12, r: s * 0.16, color: C2.card });
  } else if (kind === "waves" || kind === "wavesSlash") {
    wave(cy - s * 0.4, s * 0.3);
    wave(cy + s * 0.5, s * 0.3);
    if (kind === "wavesSlash")
      line(cx - s, cy + s, cx + s, cy - s, 3);
  } else if (kind === "stop") {
    put({ op: "rect", x: cx - s, y: cy - s, w: s * 2, h: s * 2, r: s * 0.3, color });
  } else if (kind === "lock") {
    line(cx - s * 0.5, cy - s * 0.15, cx - s * 0.5, cy - s * 0.75, 2.5);
    line(cx + s * 0.5, cy - s * 0.15, cx + s * 0.5, cy - s * 0.75, 2.5);
    line(cx - s * 0.5, cy - s * 0.75, cx + s * 0.5, cy - s * 0.75, 2.5);
    put({ op: "outline", x: cx - s, y: cy - s * 0.2, w: s * 2, h: s * 1.2, r: s * 0.35, color, width: 2.5 });
  } else if (kind === "chevL") {
    line(cx + s * 0.45, cy - s, cx - s * 0.45, cy, 3.5);
    line(cx - s * 0.45, cy, cx + s * 0.45, cy + s, 3.5);
  } else if (kind === "chevR") {
    line(cx - s * 0.45, cy - s, cx + s * 0.45, cy, 3.5);
    line(cx + s * 0.45, cy, cx - s * 0.45, cy + s, 3.5);
  } else if (kind === "power") {
    put({ op: "ring", cx, cy, r: s - 1, width: 3, color, progress: 0.72 });
    line(cx, cy - s + 3, cx, cy + s * 0.15, 3);
  } else if (kind === "clock") {
    put({ op: "ring", cx, cy, r: s - 1, width: 2.5, color, progress: 1 });
    line(cx, cy, cx, cy - s * 0.55, 2.5);
    line(cx, cy, cx + s * 0.5, cy + s * 0.15, 2.5);
  } else if (kind === "tub") {
    put({ op: "outline", x: cx - s, y: cy - s, w: s * 2, h: s * 2, r: s * 0.35, color, width: 3 });
    put({ op: "circle", cx: cx - s * 0.4, cy: cy - s * 0.35, r: s * 0.14 + 0.8, color });
    put({ op: "circle", cx: cx + s * 0.3, cy: cy - s * 0.15, r: s * 0.2 + 0.8, color });
    put({ op: "circle", cx: cx - s * 0.05, cy: cy - s * 0.55, r: s * 0.1 + 0.6, color });
    wave(cy + s * 0.45, s * 0.22);
  } else {
    put({ op: "ring", cx, cy, r: s - 1, width: 3, color, progress: 1 });
    put({
      op: "text",
      x: cx - s,
      y: cy + s * 0.38,
      text: kind === "motorB" ? "B" : "A",
      size: s * 1.05,
      weight: 800,
      color,
      align: "center",
      width: s * 2
    });
  }
}
function StatusStrip(props) {
  const h = 86;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C2.card });
      put({ op: "circle", cx: 20, cy: 25, r: 5, color: props.accent });
      const rightBudget = props.right ? textWidth(props.right, 15) + (props.onPress ? 42 : 26) : props.onPress ? 34 : 18;
      put({
        op: "text",
        x: 37,
        y: 30,
        text: truncate(props.status, 15, w - 37 - rightBudget - 12),
        size: 15,
        weight: 800,
        color: C2.txt
      });
      if (props.right) {
        const rx = props.onPress ? w - 30 - textWidth(props.right, 15) : w - 18 - textWidth(props.right, 15);
        put({
          op: "text",
          x: rx,
          y: 30,
          text: props.right,
          size: 15,
          weight: 800,
          color: props.accent
        });
      }
      if (props.onPress) {
        drawIcon("chevR", w - 16, 25, 7, put, C2.dim);
        tap({ x: 0, y: 0, w, h }, props.onPress);
      }
      const capY = props.pct === null ? 58 : 74;
      if (props.pct !== null) {
        const trackW = w - 36;
        put({ op: "rect", x: 18, y: 45, w: trackW, h: 6, r: 3, color: C2.track });
        const pct = Math.max(0, Math.min(1, props.pct));
        if (pct > 0)
          put({ op: "rect", x: 18, y: 45, w: Math.max(10, trackW * pct), h: 6, r: 3, color: props.accent });
      }
      if (props.caption) {
        put({ op: "text", x: 18, y: capY, text: props.caption, size: 11.5, weight: 400, color: C2.dim, width: w - 36 });
      }
    }
  });
}
function FunctionGrid(props) {
  const cols = 3;
  const gap = 10;
  const rows = Math.ceil(props.functions.length / cols);
  const tileH = 116;
  const h = rows * tileH + (rows - 1) * gap;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = (origin.w - (cols - 1) * gap) / cols;
      props.functions.forEach((item, i) => {
        const x = i % cols * (w + gap);
        const y = Math.floor(i / cols) * (tileH + gap);
        const enabled = !item.disabled;
        const border = !enabled ? C2.line : item.active || item.pending ? item.color : C2.lineStrong;
        put({
          op: "outline",
          x,
          y,
          w,
          h: tileH,
          r: 14,
          color: border,
          width: !enabled ? 1.5 : item.active || item.pending ? 2.5 : 2
        });
        drawIcon(item.icon, x + w / 2, y + 36, 15, put, enabled ? item.color : "#4E6272");
        put({
          op: "text",
          x: x + 4,
          y: y + 80,
          text: item.label,
          size: 13.5,
          weight: 800,
          color: enabled ? C2.txt : "#6E8496",
          align: "center",
          width: w - 8
        });
        put({
          op: "text",
          x: x + 4,
          y: y + 99,
          text: item.pending ? "MENGIRIM…" : item.active ? "BERJALAN" : item.sub ?? "sentuh",
          size: 10,
          weight: item.pending || item.active ? 800 : 500,
          color: item.pending || item.active ? item.color : item.disabled ? "#586D7E" : C2.dim,
          align: "center",
          width: w - 8
        });
        if (item.disabled)
          drawIcon("lock", x + w - 13, y + 13, 5, put, "#586D7E");
        if (enabled && item.onPress)
          tap({ x, y, w, h: tileH }, item.onPress);
      });
    }
  });
}
function StopBar(props) {
  const h = 52;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      if (props.disabled) {
        put({ op: "outline", x: 0, y: 0, w, h, r: 14, color: "#5A2A33", width: 1.5 });
        const tw = textWidth("STOP", 15);
        drawIcon("lock", w / 2 - tw / 2 - 22, h / 2, 6, put, C2.redFaint);
        put({
          op: "text",
          x: 0,
          y: h / 2 + 5,
          text: "STOP",
          size: 15,
          weight: 800,
          color: C2.redFaint,
          align: "center",
          width: w
        });
        return;
      }
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: props.pending ? C2.redDark : C2.red });
      const label = props.pending ? "MENGHENTIKAN…" : "STOP";
      const tw = textWidth(label, 17);
      if (!props.pending)
        drawIcon("stop", w / 2 - tw / 2 - 16, h / 2, 6, put, "#FFFFFF");
      put({
        op: "text",
        x: 0,
        y: h / 2 + 6,
        text: label,
        size: 17,
        weight: 800,
        color: "#FFFFFF",
        align: "center",
        width: w
      });
      if (props.onPress)
        tap({ x: 0, y: 0, w, h }, props.onPress);
    }
  });
}
function ListRow(props) {
  const h = 60;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C2.card });
      const x0 = props.icon ? 54 : 18;
      let rightEdge = w - 18;
      if (props.pill)
        rightEdge = w - 16 - (textWidth(props.pill.label, 11) + 30) - 10;
      else if (props.locked !== undefined)
        rightEdge = w - 34 - textWidth(props.locked, 10) - 8;
      else if (props.value !== undefined)
        rightEdge = w - 18 - textWidth(props.value, 16) - 8;
      if (props.icon)
        drawIcon(props.icon, 30, 30, 12, put, props.iconColor ?? C2.dim);
      put({
        op: "text",
        x: x0,
        y: 26,
        text: truncate(props.label, 13.5, rightEdge - x0),
        size: 13.5,
        weight: 700,
        color: C2.txt
      });
      if (props.sub) {
        put({ op: "text", x: x0, y: 45, text: truncate(props.sub, 10.5, rightEdge - x0), size: 10.5, weight: 400, color: C2.dim });
      }
      if (props.pill) {
        const tw = textWidth(props.pill.label, 11);
        const bw = tw + 30;
        const bx = w - 16 - bw;
        if (props.pill.busy) {
          put({ op: "outline", x: bx, y: 10, w: bw, h: 40, r: 20, color: C2.acc, width: 1.5 });
        } else {
          put({ op: "rect", x: bx, y: 10, w: bw, h: 40, r: 20, color: C2.accDeep });
        }
        put({
          op: "text",
          x: bx,
          y: 34,
          text: props.pill.label,
          size: 11,
          weight: 800,
          color: props.pill.busy ? C2.acc : "#FFFFFF",
          align: "center",
          width: bw
        });
        if (props.pill.onPress)
          tap({ x: bx, y: 8, w: bw, h: 44 }, props.pill.onPress);
      } else if (props.locked !== undefined) {
        drawIcon("lock", w - 18, 30, 6, put, C2.faint);
        put({
          op: "text",
          x: w - 34 - textWidth(props.locked, 10),
          y: 34,
          text: props.locked,
          size: 10,
          weight: 500,
          color: C2.faint
        });
      } else if (props.value !== undefined) {
        put({
          op: "text",
          x: w - 18 - textWidth(props.value, 16),
          y: 36,
          text: props.value,
          size: 16,
          weight: 800,
          color: props.valueColor ?? C2.acc
        });
      }
      if (props.onPress && !props.locked)
        tap({ x: 0, y: 0, w, h }, props.onPress);
    }
  });
}
function RelayRow(props) {
  const h = 56;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C2.card });
      drawIcon(props.icon, 30, 28, 12, put, props.on === true ? props.iconColor : "#4E6272");
      put({
        op: "text",
        x: 54,
        y: 33,
        text: props.label,
        size: 13.5,
        weight: 700,
        color: props.on === true ? C2.txt : "#9DB2C7"
      });
      const chipX = w - 16 - 56;
      if (props.on === null) {
        put({
          op: "text",
          x: chipX,
          y: 33,
          text: "—",
          size: 15,
          weight: 800,
          color: C2.faint,
          align: "center",
          width: 56
        });
      } else if (props.on) {
        put({ op: "rect", x: chipX, y: 14, w: 56, h: 28, r: 14, color: withAlpha(props.iconColor, 51) });
        put({
          op: "text",
          x: chipX,
          y: 32,
          text: "ON",
          size: 11.5,
          weight: 800,
          color: props.iconColor,
          align: "center",
          width: 56
        });
      } else {
        put({ op: "outline", x: chipX, y: 14, w: 56, h: 28, r: 14, color: C2.lineStrong, width: 1.5 });
        put({
          op: "text",
          x: chipX,
          y: 32,
          text: "OFF",
          size: 11.5,
          weight: 800,
          color: C2.dim,
          align: "center",
          width: 56
        });
      }
    }
  });
}
function SettingRow(props) {
  const h = 64;
  const sw = 152;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C2.card });
      put({
        op: "text",
        x: 18,
        y: 27,
        text: truncate(props.label, 13.5, w - sw - 44),
        size: 13.5,
        weight: 700,
        color: props.disabled ? "#9DB2C7" : C2.txt
      });
      if (props.sub) {
        put({ op: "text", x: 18, y: 46, text: props.sub, size: 10.5, weight: 400, color: C2.dim });
      }
      if (props.disabled || props.unloaded) {
        const note = props.disabled ? "tersimpan" : "belum dimuat";
        drawIcon("lock", w - 18, 32, 6, put, C2.faint);
        put({
          op: "text",
          x: w - 34 - textWidth(note, 10),
          y: 36,
          text: note,
          size: 10,
          weight: 500,
          color: C2.faint
        });
        return;
      }
      const sx = w - 16 - sw;
      put({ op: "outline", x: sx, y: 8, w: sw, h: 48, r: 24, color: C2.lineStrong, width: 1.5 });
      const third = sw / 3;
      put({
        op: "text",
        x: sx,
        y: 38,
        text: "−",
        size: 19,
        weight: 700,
        color: C2.dim,
        align: "center",
        width: third
      });
      put({
        op: "text",
        x: sx + third,
        y: 36,
        text: props.value ?? "—",
        size: 15,
        weight: 800,
        color: C2.acc,
        align: "center",
        width: third
      });
      put({
        op: "text",
        x: sx + third * 2,
        y: 38,
        text: "+",
        size: 19,
        weight: 700,
        color: C2.dim,
        align: "center",
        width: third
      });
      if (props.onStep) {
        tap({ x: sx, y: 8, w: sw / 2, h: 48 }, () => props.onStep?.(-1));
        tap({ x: sx + sw / 2, y: 8, w: sw / 2, h: 48 }, () => props.onStep?.(1));
      }
    }
  });
}
function ChoiceRow(props) {
  const h = 60;
  const pw = 56;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C2.card });
      const total = props.options.length * pw + (props.options.length - 1) * 8;
      put({
        op: "text",
        x: 18,
        y: 26,
        text: truncate(props.label, 13.5, w - 16 - total - 36),
        size: 13.5,
        weight: 700,
        color: C2.txt
      });
      if (props.sub) {
        put({
          op: "text",
          x: 18,
          y: 45,
          text: truncate(props.sub, 10.5, w - 16 - total - 36),
          size: 10.5,
          weight: 400,
          color: C2.dim
        });
      }
      let x = w - 16 - total;
      if (props.disabled)
        drawIcon("lock", x - 18, 30, 6, put, C2.faint);
      props.options.forEach((opt, i) => {
        const sel = i === props.selected;
        if (props.disabled) {
          put({ op: "outline", x, y: 10, w: pw, h: 40, r: 20, color: C2.line, width: 1.5 });
        } else if (sel) {
          put({ op: "rect", x, y: 10, w: pw, h: 40, r: 20, color: withAlpha(C2.acc, 46) });
          put({ op: "outline", x, y: 10, w: pw, h: 40, r: 20, color: C2.acc, width: 1.5 });
        } else {
          put({ op: "outline", x, y: 10, w: pw, h: 40, r: 20, color: C2.lineStrong, width: 1.5 });
        }
        put({
          op: "text",
          x,
          y: 34,
          text: opt,
          size: 11.5,
          weight: 800,
          color: props.disabled ? C2.faint : sel ? C2.acc : C2.dim,
          align: "center",
          width: pw
        });
        if (!props.disabled && props.onSelect) {
          tap({ x, y: 10, w: pw, h: 40 }, () => props.onSelect?.(i));
        }
        x += pw + 8;
      });
    }
  });
}
function ProgramCard(props) {
  const h = 92;
  return CanvasBox({
    height: h,
    paint: (origin, put, tap) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 16, color: C2.card });
      put({ op: "rect", x: 12, y: 14, w: 5, h: h - 28, r: 3, color: props.color });
      const nameX = props.icon ? 58 : 30;
      if (props.icon)
        drawIcon(props.icon, 38, 36, 13, put, props.color);
      put({ op: "text", x: nameX, y: 34, text: props.name, size: 16, weight: 800, color: C2.txt });
      put({
        op: "text",
        x: nameX,
        y: 76,
        text: truncate(props.line, 11, w - nameX - 16),
        size: 11,
        weight: 400,
        color: C2.dim
      });
      if (props.state === "locked") {
        drawIcon("lock", w - 24, 34, 6, put, C2.faint);
        put({
          op: "text",
          x: w - 40 - textWidth("tersimpan di mesin", 10),
          y: 38,
          text: "tersimpan di mesin",
          size: 10,
          weight: 500,
          color: C2.faint
        });
        return;
      }
      const label = props.state === "pending" ? "MEMULAI…" : "MULAI";
      const tw = textWidth(label, 11.5);
      const bw = tw + 32;
      const bx = w - 16 - bw;
      if (props.state === "busy") {
        put({ op: "outline", x: bx, y: 18, w: bw, h: 44, r: 22, color: C2.line, width: 1.5 });
        put({
          op: "text",
          x: bx,
          y: 43,
          text: label,
          size: 11.5,
          weight: 800,
          color: C2.faint,
          align: "center",
          width: bw
        });
        return;
      }
      if (props.state === "pending") {
        put({ op: "outline", x: bx, y: 18, w: bw, h: 44, r: 22, color: C2.acc, width: 1.5 });
      } else {
        put({ op: "rect", x: bx, y: 18, w: bw, h: 44, r: 22, color: C2.accDeep });
      }
      put({
        op: "text",
        x: bx,
        y: 43,
        text: label,
        size: 11.5,
        weight: 800,
        color: props.state === "pending" ? C2.acc : "#FFFFFF",
        align: "center",
        width: bw
      });
      if (props.state === "idle" && props.onStart)
        tap({ x: bx, y: 16, w: bw, h: 48 }, props.onStart);
      if (props.onEdit) {
        const ew = textWidth("edit", 11);
        put({
          op: "text",
          x: bx - 16 - ew,
          y: 43,
          text: "edit",
          size: 11,
          weight: 700,
          color: C2.acc
        });
        tap({ x: bx - 16 - ew - 14, y: 18, w: ew + 28, h: 44 }, props.onEdit);
      }
    }
  });
}
function SensorRow(props) {
  const h = 62;
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      const w = origin.w;
      put({ op: "rect", x: 0, y: 0, w, h, r: 14, color: C2.card });
      const meterW = Math.min(150, Math.max(112, w * 0.44));
      const mx = w - 18 - meterW - 6;
      const labelEdge = mx - 10;
      drawIcon("droplet", 30, 31, 13, put, props.pct !== null ? C2.aqua : "#4E6272");
      put({ op: "text", x: 54, y: 28, text: truncate("SENSOR AIR", 13.5, labelEdge - 54), size: 13.5, weight: 700, color: C2.txt });
      put({
        op: "text",
        x: 54,
        y: 47,
        text: truncate(props.caption, 10.5, labelEdge - 54),
        size: 10.5,
        weight: 400,
        color: C2.dim
      });
      put({ op: "outline", x: mx, y: 16, w: meterW, h: 28, r: 9, color: C2.lineStrong, width: 2 });
      put({ op: "rect", x: mx + meterW + 2, y: 24, w: 4, h: 12, r: 2, color: C2.lineStrong });
      put({ op: "rect", x: mx + 3.5, y: 19.5, w: meterW - 7, h: 21, r: 6, color: C2.track });
      if (props.pct !== null) {
        const pct = Math.max(0, Math.min(100, props.pct));
        const fw = Math.max(6, (meterW - 7) * (pct / 100));
        put({ op: "rect", x: mx + 3.5, y: 19.5, w: fw, h: 21, r: 6, color: pct < 20 ? C2.amber : C2.aqua });
      }
      const label = props.pct === null ? "?" : `${props.pct}%`;
      const tw = Math.min(textWidth(label, 12), meterW - 16);
      put({ op: "rect", x: mx + meterW / 2 - (tw + 12) / 2, y: 21, w: tw + 12, h: 18, r: 9, color: C2.card });
      put({
        op: "text",
        x: mx + meterW / 2 - tw / 2,
        y: 34,
        text: label,
        size: 12,
        weight: 800,
        color: props.pct === null ? C2.faint : C2.txt
      });
    }
  });
}
function ActivityList(props) {
  const rowH = 40;
  const h = Math.max(props.rows.length * rowH, 40);
  const fmtHM = (t) => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return CanvasBox({
    height: h,
    paint: (origin, put) => {
      if (props.rows.length === 0) {
        put({
          op: "text",
          x: 0,
          y: 25,
          text: "belum ada aktivitas",
          size: 12,
          weight: 400,
          color: "#7E93A6",
          align: "center",
          width: origin.w
        });
        return;
      }
      props.rows.forEach((row, i) => {
        const y = i * rowH;
        const dotY = y + rowH / 2;
        if (i < props.rows.length - 1) {
          put({ op: "line", x1: 18, y1: dotY + 5, x2: 18, y2: dotY + rowH - 5, color: C2.line, width: 2 });
        }
        put({ op: "circle", cx: 18, cy: dotY, r: 4, color: row.color });
        put({
          op: "text",
          x: 34,
          y: dotY + 4,
          text: truncate(row.line, 13, origin.w - 34 - 48),
          size: 13,
          weight: 500,
          color: "#CFDCE8"
        });
        const time = fmtHM(row.t);
        put({
          op: "text",
          x: origin.w - 14 - textWidth(time, 10.5),
          y: dotY + 4,
          text: time,
          size: 10.5,
          weight: 400,
          color: "#7E93A6"
        });
      });
    }
  });
}
function fmtAgo(t, now) {
  if (t === undefined)
    return "belum pernah";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60)
    return "baru saja";
  if (s < 3600)
    return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400)
    return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hr lalu`;
}
function truncate(text, size, maxWidth) {
  if (maxWidth <= 24 || textWidth(text, size) <= maxWidth)
    return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, size) > maxWidth)
    t = t.slice(0, -1);
  return `${t}…`;
}
function withAlpha(hex, alpha) {
  const body = hex.replace("#", "");
  const full = body.length === 3 ? body.split("").map((c) => c + c).join("") : body;
  return `#${alpha.toString(16).padStart(2, "0")}${full.slice(0, 6).toUpperCase()}`;
}

// src/protocol.ts
var BLE_SVC_UUID = "9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e001";
var BLE_CMD_UUID = "9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e002";
var BLE_STAT_UUID = "9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e003";
var IDLE_LIKE = new Set(["IDLE", "STOP"]);
function parseStatus(line) {
  if (!line.startsWith("ST:"))
    return null;
  const f = line.slice(3).split("|");
  if (f.length < 7)
    return null;
  const step = f[2].split("/");
  const rel = (f[5] ?? "0000").padEnd(4, "0");
  const waterField = f[7];
  let waterPct = null;
  if (waterField !== undefined && waterField.startsWith("W")) {
    const n = parseInt(waterField.slice(1), 10);
    if (!Number.isNaN(n) && n >= 0)
      waterPct = n;
  }
  const mode = f[0];
  return {
    mode,
    prog: f[1] ?? "",
    step: parseInt(step[0] ?? "0", 10) || 0,
    steps: parseInt(step[1] ?? "0", 10) || 0,
    elapsedS: Math.max(0, parseInt(f[3] ?? "0", 10) || 0),
    remainS: Math.max(0, parseInt(f[4] ?? "0", 10) || 0),
    motorA: rel[0] === "1",
    motorB: rel[1] === "1",
    drain: rel[2] === "1",
    inlet: rel[3] === "1",
    heapKB: parseInt(f[6] ?? "0", 10) || 0,
    waterPct,
    running: !IDLE_LIKE.has(mode)
  };
}
function parseSetting(line) {
  const m = /^SET (\S+) ?(.*)$/.exec(line);
  if (!m)
    return null;
  return { key: m[1], value: m[2] ?? "" };
}
function parseReply(line) {
  if (line.startsWith("OK "))
    return { ok: true, busy: false, msg: line.slice(3) };
  if (line === "OK")
    return { ok: true, busy: false, msg: "OK" };
  if (line.startsWith("ERR"))
    return { ok: false, busy: false, msg: line };
  if (line.startsWith("BUSY"))
    return { ok: false, busy: true, msg: line };
  return null;
}
var SETTING_DEFS = [
  { key: "WASHMIN", label: "Cuci min", min: 1, max: 60, step: 1, decimals: 0 },
  { key: "SPINMIN", label: "Peras min", min: 1, max: 30, step: 1, decimals: 0 },
  { key: "DRAINMIN", label: "Buang min", min: 1, max: 15, step: 1, decimals: 0 },
  { key: "FILLMIN", label: "Isi min", min: 1, max: 10, step: 1, decimals: 0 },
  { key: "RINSEMIN", label: "Bilas min", min: 1, max: 15, step: 1, decimals: 0 },
  { key: "SPINDRAINS", label: "Buang saat peras", min: 5, max: 300, step: 5, decimals: 0, advanced: true },
  { key: "RINSEDRAINS", label: "Buang saat bilas", min: 15, max: 180, step: 5, decimals: 0, advanced: true },
  { key: "STOPCOASTS", label: "Coast berhenti", min: 0, max: 60, step: 1, decimals: 0, advanced: true },
  { key: "PULSES", label: "Pulse putaran", min: 0.5, max: 10, step: 0.1, decimals: 1, advanced: true },
  { key: "DEADS", label: "Jeda antar-pulse", min: 0, max: 5, step: 0.05, decimals: 2, advanced: true }
];
var PROGRAM_SLOTS = [
  { key: "PROG0", name: "CEPAT" },
  { key: "PROG1", name: "NORMAL" },
  { key: "PROG2", name: "KUSTOM" }
];
var MODE_LABELS = {
  WASH: "Cuci",
  SPIN: "Peras",
  DRAIN: "Buang",
  FILL: "Isi",
  WAIT: "Tunggu",
  RINSE: "Bilas"
};
function fmtDurationS(totalS) {
  const s = Math.max(0, Math.floor(totalS));
  return s >= 60 ? `${Math.round(s / 60)} mnt` : `${s} dtk`;
}
function fmtProgramSummary(tokens) {
  const trimmed = tokens.trim();
  if (!trimmed)
    return "";
  const parts = [];
  for (const raw of trimmed.split(",")) {
    const piece = raw.trim();
    if (!piece)
      continue;
    const m = /^([A-Za-z]+):(\d+)$/.exec(piece);
    if (!m)
      return trimmed;
    const label = MODE_LABELS[m[1].toUpperCase()] ?? m[1].toUpperCase();
    parts.push(`${label} ${fmtDurationS(parseInt(m[2], 10))}`);
  }
  return parts.length > 0 ? parts.join(" · ") : trimmed;
}
function parseProgramSteps(tokens) {
  const trimmed = tokens.trim();
  if (!trimmed)
    return [];
  const steps = [];
  for (const raw of trimmed.split(",")) {
    const piece = raw.trim();
    if (!piece)
      continue;
    const m = /^([A-Za-z]+):(\d+)$/.exec(piece);
    if (m) {
      steps.push({
        mode: m[1].toUpperCase(),
        s: Math.max(1, parseInt(m[2], 10) || 0)
      });
    }
  }
  return steps;
}
function formatProgramSteps(steps) {
  return steps.map((st) => `${st.mode}:${Math.round(st.s)}`).join(", ");
}
function fmtActivityLine(raw) {
  const line = raw.trim();
  if (!line)
    return "";
  if (line.startsWith("> ")) {
    const cmd = line.slice(2).trim();
    if (cmd === "STOP")
      return "Minta stop";
    if (cmd.startsWith("PROG ")) {
      const idx = parseInt(cmd.slice(5), 10);
      const name = PROGRAM_SLOTS[idx]?.name ?? `Slot ${idx}`;
      return `Mulai program ${name}`;
    }
    if (cmd === "TUB")
      return "Mulai Tub Clean";
    const mode = MODE_LABELS[cmd] ?? cmd;
    return `Mulai ${mode}`;
  }
  if (line.startsWith("OK ")) {
    const msg = line.slice(3).trim();
    if (msg === "STOP")
      return "Mesin berhenti";
    if (msg.startsWith("PROG ") || msg === "TUB CLEAN")
      return `Program dimulai (${msg})`;
    const m = /^([A-Za-z]+)\s+(\d+)\s*s$/.exec(msg);
    if (m) {
      const mode = MODE_LABELS[m[1].toUpperCase()] ?? m[1];
      return `${mode} dimulai (${fmtDurationS(parseInt(m[2], 10))})`;
    }
    return `OK · ${msg}`;
  }
  if (line.startsWith("BUSY")) {
    return "Ditolak: mesin sedang berjalan";
  }
  if (line.startsWith("ERR ")) {
    return line;
  }
  return line;
}
function fmtClock(totalS) {
  const s = Math.max(0, Math.floor(totalS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtSettingValue(def, v) {
  return v.toFixed(def.decimals);
}

// src/screens/home.screen.tsx
var FUNCTIONS = [
  { label: "CUCI", cmd: "WASH", icon: "wash", color: "#00B7FD" },
  { label: "PERAS", cmd: "SPIN", icon: "spin", color: "#BB86FC" },
  { label: "BUANG", cmd: "DRAIN", icon: "drain", color: "#00FFC8" },
  { label: "ISI", cmd: "FILL", icon: "droplet", color: "#00FF80" },
  { label: "BILAS", cmd: "RINSE", icon: "waves", color: "#38BDF8" },
  { label: "BILAS ND", cmd: "RINSEND", icon: "wavesSlash", color: "#7DD3FC" }
];
function rowColor(line) {
  if (line.startsWith(">"))
    return "#00B7FD";
  if (line.startsWith("OK"))
    return "#00FF80";
  if (line.startsWith("ERR"))
    return "#FF3838";
  if (line.startsWith("BUSY"))
    return "#FCB518";
  return "#9DB2C7";
}
var HomeScreen = defineScreen({
  name: "Home",
  initialState: () => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    rows: [],
    usage: {},
    pending: null,
    err: null
  }),
  actions: {
    link: defineAction({
      run({ input, state }) {
        const s = state;
        s.link = { ...s.link, ...input };
      }
    }),
    status: defineAction({
      run({ input, state }) {
        state.status = input;
      }
    }),
    log: defineAction({
      run({ input, state }) {
        const s = state;
        s.rows = [input, ...s.rows].slice(0, 12);
      }
    }),
    usage: defineAction({
      run({ input, state }) {
        state.usage = input;
      }
    }),
    result: defineAction({
      run({ input, state }) {
        const s = state;
        s.pending = null;
        s.err = input.ok ? null : `${input.busy ? "BUSY" : "ERR"} · ${input.msg}`;
      }
    }),
    clearErr: defineAction({
      run({ state }) {
        state.err = null;
      }
    }),
    disconnect: defineAction({
      run({ services }) {
        const svc = services;
        svc.ble?.disconnect();
      }
    }),
    start: defineAction({
      run({ input, state, services }) {
        const s = state;
        if (!s.link.connected)
          return;
        if (input !== "STOP" && s.pending !== null)
          return;
        s.pending = input;
        s.err = null;
        services.send?.(input);
      }
    })
  },
  view({ state, actions }) {
    const s = state;
    const st = s.status;
    const now = Date.now();
    const offline = !s.link.connected;
    const waiting = !offline && st === null;
    const running = st?.running === true;
    const done = st !== null && !running && st.prog.startsWith("DONE");
    const total = (st?.elapsedS ?? 0) + (st?.remainS ?? 0);
    const pct = offline || waiting ? null : done ? 1 : running && total > 0 ? Math.min(1, st.elapsedS / total) : null;
    const accent = offline || waiting ? "#9DB2C7" : running ? modeColor(st.mode) : done ? "#00FF80" : "#00B7FD";
    const status = offline ? "OFFLINE" : waiting ? "MENUNGGU STATUS…" : running ? `${st.mode} · LANGKAH ${st.step}/${st.steps}` : done ? `SELESAI — ${st.prog.replace(/^DONE /, "")}` : "SIAP MENCUCI";
    const right = running ? `SISA ${fmtClock(st.remainS ?? 0)}` : waiting ? "—" : st?.waterPct != null ? `AIR ${st.waterPct}%` : offline ? "—" : "SIAP";
    const caption = offline ? undefined : waiting ? "menunggu status pertama dari mesin" : running ? `berlalu ${fmtClock(st.elapsedS ?? 0)} · ${st.prog}` : done ? "siklus selesai" : "pilih fungsi di bawah · program ada di tab Programs";
    const activeCmd = running ? st.mode : null;
    const functionCards = FUNCTIONS.map((f) => ({
      ...f,
      sub: fmtAgo(s.usage[f.cmd], now),
      disabled: offline,
      pending: s.pending === f.cmd,
      active: activeCmd === f.cmd,
      onPress: () => actions.start(f.cmd)
    }));
    return /* @__PURE__ */ jsx(Scaffold, {
      children: /* @__PURE__ */ jsxs(Column, {
        padding: "md",
        gap: "lg",
        children: [
          /* @__PURE__ */ jsx(StatusStrip, {
            status,
            accent,
            pct,
            right,
            caption
          }),
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "FUNGSI MESIN"
              }),
              /* @__PURE__ */ jsx(FunctionGrid, {
                functions: functionCards
              }),
              /* @__PURE__ */ jsx(StopBar, {
                disabled: offline,
                pending: s.pending === "STOP",
                onPress: () => actions.start("STOP")
              })
            ]
          }),
          s.err ? /* @__PURE__ */ jsx(SnackBar, {
            message: s.err,
            actionLabel: "OK",
            onAction: () => actions.clearErr()
          }) : null,
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "AKTIVITAS TERBARU"
              }),
              /* @__PURE__ */ jsx(ActivityList, {
                rows: s.rows.map((r) => ({
                  t: r.t,
                  line: fmtActivityLine(r.line),
                  color: rowColor(r.line)
                })),
                now
              })
            ]
          }),
          offline ? null : /* @__PURE__ */ jsx(ListRow, {
            label: "Sambungan Bluetooth",
            sub: "putuskan dari mesin",
            pill: { label: "PUTUSKAN", onPress: () => actions.disconnect() }
          })
        ]
      })
    });
  }
});

// src/screens/programs.screen.tsx
var ProgramsScreen = defineScreen({
  name: "Programs",
  initialState: () => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    values: {},
    pending: null,
    snack: null
  }),
  actions: {
    link: defineAction({
      run({ input, state }) {
        const s = state;
        s.link = { ...s.link, ...input };
      }
    }),
    status: defineAction({
      run({ input, state }) {
        state.status = input;
      }
    }),
    settings: defineAction({
      run({ input, state }) {
        state.values = input;
      }
    }),
    result: defineAction({
      run({ input, state }) {
        const s = state;
        s.pending = null;
        s.snack = input;
      }
    }),
    clearSnack: defineAction({
      run({ state }) {
        state.snack = null;
      }
    }),
    goHome: defineAction({
      run({ services }) {
        services.navigate?.("home");
      }
    }),
    start: defineAction({
      run({ input, state, services }) {
        const s = state;
        if (!s.link.connected || s.pending !== null || s.status?.running === true)
          return;
        s.pending = input;
        s.snack = null;
        services.send?.(input);
      }
    }),
    edit: defineAction({
      run({ input, state, services }) {
        const s = state;
        const slot = PROGRAM_SLOTS[input];
        if (!slot || !s.link.connected || s.status?.running === true)
          return;
        services.editProgram?.(input, s.values[slot.key] ?? "").then((next) => {
          if (next !== null) {
            services.send?.(`SET ${slot.key} ${next}`);
          }
        });
      }
    })
  },
  view({ state, actions }) {
    const s = state;
    const st = s.status;
    const running = st?.running === true;
    const offline = !s.link.connected;
    const slotColors = ["#00B7FD", "#00FF80", "#BB86FC"];
    return /* @__PURE__ */ jsx(Scaffold, {
      children: /* @__PURE__ */ jsxs(Column, {
        padding: "md",
        gap: "lg",
        children: [
          running ? /* @__PURE__ */ jsx(StatusStrip, {
            status: "SEDANG BERJALAN",
            accent: "#FCB518",
            pct: null,
            right: st.mode,
            caption: `Ketuk untuk ke Home · ${st.prog}`,
            onPress: () => actions.goHome()
          }) : null,
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "PROGRAM TERSIMPAN"
              }),
              PROGRAM_SLOTS.map((slot, i) => /* @__PURE__ */ jsx(ProgramCard, {
                name: slot.name,
                color: slotColors[i] ?? "#00B7FD",
                line: s.values[slot.key] !== undefined ? fmtProgramSummary(s.values[slot.key]) || "(belum dikonfigurasi)" : offline ? "tersimpan di mesin · sambungkan untuk membaca" : "belum dimuat — tarik GET:ALL di Settings",
                state: offline ? "locked" : running ? "busy" : s.pending === `PROG ${i}` ? "pending" : "idle",
                onStart: () => actions.start(`PROG ${i}`),
                onEdit: running ? undefined : () => actions.edit(i)
              }, slot.key))
            ]
          }),
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "PEMELIHARAAN"
              }),
              /* @__PURE__ */ jsx(ProgramCard, {
                name: "TUB CLEAN",
                color: "#FF9F45",
                icon: "tub",
                line: "Cuci 15 mnt · Buang 1 mnt · Peras 5 mnt",
                state: offline ? "locked" : running ? "busy" : s.pending === "TUB" ? "pending" : "idle",
                onStart: () => actions.start("TUB")
              })
            ]
          }),
          s.snack ? /* @__PURE__ */ jsx(SnackBar, {
            message: `${s.snack.ok ? "OK" : s.snack.busy ? "BUSY" : "ERR"} · ${s.snack.msg}`,
            actionLabel: "OK",
            onAction: () => actions.clearSnack()
          }) : null
        ]
      })
    });
  }
});

// src/screens/control.screen.tsx
var ControlsScreen = defineScreen({
  name: "Controls",
  initialState: () => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    pending: null,
    snack: null
  }),
  actions: {
    link: defineAction({
      run({ input, state }) {
        const s = state;
        s.link = { ...s.link, ...input };
      }
    }),
    status: defineAction({
      run({ input, state }) {
        state.status = input;
      }
    }),
    result: defineAction({
      run({ input, state }) {
        const s = state;
        s.pending = null;
        s.snack = input;
      }
    }),
    clearSnack: defineAction({
      run({ state }) {
        state.snack = null;
      }
    }),
    goHome: defineAction({
      run({ services }) {
        services.navigate?.("home");
      }
    }),
    send1: defineAction({
      run({ input, state, services }) {
        const s = state;
        if (!s.link.connected)
          return;
        if (input !== "STOP" && s.pending !== null)
          return;
        s.pending = input;
        s.snack = null;
        services.send?.(input);
      }
    })
  },
  view({ state, actions }) {
    const s = state;
    const st = s.status;
    const offline = !s.link.connected;
    const waiting = !offline && st === null;
    const relays = [
      { icon: "motorA", name: "MOTOR A", on: st ? st.motorA : null, color: "#00B7FD" },
      { icon: "motorB", name: "MOTOR B", on: st ? st.motorB : null, color: "#BB86FC" },
      { icon: "drain", name: "BUANG", on: st ? st.drain : null, color: "#00FFC8" },
      { icon: "droplet", name: "ISI", on: st ? st.inlet : null, color: "#00FF80" }
    ];
    const running = st?.running === true;
    const water = st?.waterPct ?? null;
    const total = (st?.elapsedS ?? 0) + (st?.remainS ?? 0);
    const pct = running && total > 0 ? Math.min(1, st.elapsedS / total) : null;
    return /* @__PURE__ */ jsx(Scaffold, {
      children: /* @__PURE__ */ jsxs(Column, {
        padding: "md",
        gap: "lg",
        children: [
          /* @__PURE__ */ jsx(StatusStrip, {
            status: offline ? "OFFLINE" : waiting ? "MENUNGGU STATUS…" : running ? `${st.mode} · LANGKAH ${st.step}/${st.steps}` : st.prog.startsWith("DONE") ? `SELESAI — ${st.prog.replace(/^DONE /, "")}` : st.mode,
            accent: offline || waiting ? "#9DB2C7" : running ? modeColor(st.mode) : "#00B7FD",
            pct,
            right: running ? `SISA ${fmtClock(st.remainS ?? 0)}` : offline || waiting ? "—" : "SIAP",
            caption: offline ? "offline · belum ada data" : waiting ? "menunggu status pertama dari mesin" : running ? `Ketuk untuk ke Home · ${st.prog}` : st?.prog ?? "menunggu status pertama dari mesin",
            onPress: running ? () => actions.goHome() : undefined
          }),
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "RELAI — INDIKATOR, BUKAN TOMBOL"
              }),
              relays.map((r) => /* @__PURE__ */ jsx(RelayRow, {
                icon: r.icon,
                iconColor: r.color,
                label: r.name,
                on: r.on
              }, r.name))
            ]
          }),
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "SENSOR"
              }),
              /* @__PURE__ */ jsx(SensorRow, {
                pct: water,
                caption: water === null ? offline ? "offline · belum terbaca" : "belum terbaca" : "level air dalam tangki"
              })
            ]
          }),
          /* @__PURE__ */ jsx(StopBar, {
            disabled: offline,
            pending: s.pending === "STOP",
            onPress: () => actions.send1("STOP")
          }),
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "PERANGKAT"
              }),
              /* @__PURE__ */ jsx(ListRow, {
                icon: "droplet",
                iconColor: "#00FFC8",
                label: "Cek air (raw)",
                sub: "WATER — adc mentah + ema + pct",
                pill: offline ? undefined : { label: "KIRIM", busy: s.pending === "WATER", onPress: () => actions.send1("WATER") },
                locked: offline ? "offline" : undefined
              }),
              /* @__PURE__ */ jsx(ListRow, {
                icon: "power",
                iconColor: "#9DB2C7",
                label: "Versi firmware",
                sub: `heap ${st?.heapKB ?? "—"} KB · ${s.link.name ?? "polytron"}`,
                pill: offline ? undefined : { label: "KIRIM", busy: s.pending === "VER", onPress: () => actions.send1("VER") },
                locked: offline ? "offline" : undefined
              })
            ]
          }),
          s.snack ? /* @__PURE__ */ jsx(SnackBar, {
            message: `${s.snack.ok ? "OK" : s.snack.busy ? "BUSY" : "ERR"} · ${s.snack.msg}`,
            actionLabel: "OK",
            onAction: () => actions.clearSnack()
          }) : null
        ]
      })
    });
  }
});

// src/screens/settings.screen.tsx
var SettingsScreen = defineScreen({
  name: "Settings",
  initialState: () => ({
    link: { supported: false, connecting: false, connected: false, name: null },
    status: null,
    values: {},
    snack: null
  }),
  actions: {
    link: defineAction({
      run({ input, state }) {
        const s = state;
        s.link = { ...s.link, ...input };
      }
    }),
    status: defineAction({
      run({ input, state }) {
        state.status = input;
      }
    }),
    settings: defineAction({
      run({ input, state }) {
        state.values = input;
      }
    }),
    result: defineAction({
      run({ input, state }) {
        state.snack = input;
      }
    }),
    clearSnack: defineAction({
      run({ state }) {
        state.snack = null;
      }
    }),
    refresh: defineAction({
      run({ state, services }) {
        const s = state;
        if (!s.link.connected)
          return;
        services.send?.("GET:ALL");
      }
    }),
    bump: defineAction({
      run({ input, state, services }) {
        const s = state;
        const def = SETTING_DEFS.find((d) => d.key === input.key);
        if (!def || !s.link.connected || s.values[def.key] === undefined)
          return;
        const raw = parseFloat(s.values[def.key] ?? "");
        const base = Number.isNaN(raw) ? def.min : raw;
        const next = Math.min(def.max, Math.max(def.min, base + def.step * input.dir));
        s.values = { ...s.values, [def.key]: fmtSettingValue(def, next) };
        services.send?.(`SET ${def.key} ${fmtSettingValue(def, next)}`);
      }
    }),
    spinMotor: defineAction({
      run({ input, state, services }) {
        const s = state;
        if (!s.link.connected)
          return;
        const motor = input === 1 ? "B" : "A";
        s.values = { ...s.values, SPINMOTOR: motor };
        services.send?.(`SET SPINMOTOR ${motor}`);
      }
    }),
    clock: defineAction({
      run({ state, services }) {
        const s = state;
        if (!s.link.connected)
          return;
        const now = services.clockNow?.() ?? null;
        if (!now) {
          s.snack = { ok: false, busy: false, msg: "waktu host tidak tersedia" };
          return;
        }
        services.send?.(`CLOCK ${now}`);
      }
    }),
    wcal: defineAction({
      run({ input, state, services }) {
        if (!state.link.connected)
          return;
        services.send?.(`WCAL ${input}`);
      }
    }),
    water: defineAction({
      run({ state, services }) {
        if (!state.link.connected)
          return;
        services.send?.("WATER");
      }
    })
  },
  view({ state, actions }) {
    const s = state;
    const offline = !s.link.connected;
    const spinMotorIdx = s.values.SPINMOTOR === "B" ? 1 : s.values.SPINMOTOR === "A" ? 0 : -1;
    const waterPct = s.status?.waterPct ?? null;
    const everyday = SETTING_DEFS.filter((d) => !d.advanced);
    const advanced = SETTING_DEFS.filter((d) => d.advanced);
    const settingRows = (defs) => defs.map((def) => /* @__PURE__ */ jsx(SettingRow, {
      label: def.label,
      sub: def.key,
      value: s.values[def.key],
      disabled: offline,
      unloaded: !offline && s.values[def.key] === undefined,
      onStep: (dir) => actions.bump({ key: def.key, dir })
    }, def.key));
    return /* @__PURE__ */ jsx(Scaffold, {
      children: /* @__PURE__ */ jsxs(Column, {
        padding: "md",
        gap: "lg",
        children: [
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "MESIN"
              }),
              /* @__PURE__ */ jsx(ChoiceRow, {
                label: "Motor peras",
                sub: spinMotorIdx < 0 ? offline ? "tersimpan di mesin" : "belum dimuat" : `aktif: MOTOR ${s.values.SPINMOTOR}`,
                options: ["A", "B"],
                selected: spinMotorIdx < 0 ? 0 : spinMotorIdx,
                disabled: offline || spinMotorIdx < 0,
                onSelect: (i) => actions.spinMotor(i)
              }),
              /* @__PURE__ */ jsx(ListRow, {
                icon: "clock",
                iconColor: "#9DB2C7",
                label: "Jam LCD",
                sub: "samakan dengan jam ponsel ini",
                pill: offline ? undefined : { label: "SET CLOCK", onPress: () => actions.clock() },
                locked: offline ? "offline" : undefined
              })
            ]
          }),
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "DURASI"
              }),
              settingRows(everyday)
            ]
          }),
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "SENSOR AIR"
              }),
              /* @__PURE__ */ jsx(SensorRow, {
                pct: waterPct,
                caption: waterPct === null ? offline ? "offline · belum terbaca" : "belum terbaca" : "level air dalam tangki"
              }),
              /* @__PURE__ */ jsx(ListRow, {
                icon: "droplet",
                iconColor: "#00FFC8",
                label: "Kalibrasi tangki kosong",
                sub: "isi ulang referensi bawah (WCAL EMPTY)",
                pill: offline ? undefined : { label: "JALANKAN", onPress: () => actions.wcal("EMPTY") },
                locked: offline ? "offline" : undefined
              }),
              /* @__PURE__ */ jsx(ListRow, {
                icon: "droplet",
                iconColor: "#00FFC8",
                label: "Kalibrasi tangki penuh",
                sub: "isi ulang referensi atas (WCAL FULL)",
                pill: offline ? undefined : { label: "JALANKAN", onPress: () => actions.wcal("FULL") },
                locked: offline ? "offline" : undefined
              }),
              /* @__PURE__ */ jsx(ListRow, {
                label: "Matikan mode kalibrasi",
                sub: "WCAL OFF",
                pill: offline ? undefined : { label: "MATIKAN", onPress: () => actions.wcal("OFF") },
                locked: offline ? "offline" : undefined
              })
            ]
          }),
          /* @__PURE__ */ jsxs(Column, {
            gap: "sm",
            children: [
              /* @__PURE__ */ jsx(Text, {
                variant: "label",
                children: "LANJUTAN"
              }),
              settingRows(advanced)
            ]
          }),
          /* @__PURE__ */ jsx(ListRow, {
            label: "Muat ulang pengaturan",
            sub: "GET:ALL — baca semua nilai dari mesin",
            pill: offline ? undefined : { label: "GET:ALL", onPress: () => actions.refresh() },
            locked: offline ? "offline" : undefined
          }),
          s.snack ? /* @__PURE__ */ jsx(SnackBar, {
            message: `${s.snack.ok ? "OK" : s.snack.busy ? "BUSY" : "ERR"} · ${s.snack.msg}`,
            actionLabel: "OK",
            onAction: () => actions.clearSnack()
          }) : null
        ]
      })
    });
  }
});

// src/runtime.ts
var screens = {
  home: HomeScreen,
  programs: ProgramsScreen,
  controls: ControlsScreen,
  settings: SettingsScreen
};
var noBleHost = {
  supported: () => false,
  connect: () => Promise.resolve(false),
  disconnect: () => {
    return;
  },
  write: () => Promise.resolve(false)
};
var REPLY_TIMEOUT_MS = 1e4;

class WasherRuntime {
  app;
  services;
  lastLink = { supported: false, connecting: false, connected: false, name: null };
  lastStatus = null;
  settings = {};
  pendingCmds = [];
  usage = {};
  constructor(host = {}) {
    const { designWidth, ...hostServices } = host;
    this.services = {
      ble: noBleHost,
      clockNow: () => null,
      editProgram: () => Promise.resolve(null),
      navigate: (route) => this.navigate(route),
      send: (cmd) => this.send(cmd),
      ...hostServices
    };
    this.app = new ApplicationRuntime({
      screens,
      initial: "home",
      theme: washerTheme,
      services: this.services,
      designWidth: designWidth ?? 390
    });
    this.lastLink = { ...this.lastLink, supported: this.services.ble.supported() };
    this.app.pushState("link", this.lastLink);
  }
  route() {
    return this.app.route();
  }
  routes() {
    return this.app.routes();
  }
  status() {
    return this.lastStatus;
  }
  navigate(name) {
    if (name in screens) {
      this.app.navigate(name);
      this.app.render();
    }
  }
  linkPush(link) {
    const was = this.lastLink.connected;
    this.lastLink = { ...this.lastLink, ...link };
    this.app.pushState("link", this.lastLink);
    if (was && !this.lastLink.connected) {
      this.lastStatus = null;
      this.failAllPending("sambungan terputus");
      this.app.pushState("status", null);
    }
  }
  lineIn(raw) {
    const line = raw.trim();
    if (!line)
      return;
    const status = parseStatus(line);
    if (status) {
      this.lastStatus = status;
      this.app.pushState("status", status);
      return;
    }
    const setting = parseSetting(line);
    if (setting) {
      this.settings = { ...this.settings, [setting.key]: setting.value };
      this.app.pushState("settings", this.settings);
      return;
    }
    const reply = parseReply(line) ?? { ok: true, busy: false, msg: line };
    const front = this.pendingCmds.shift();
    if (front?.timer)
      clearTimeout(front.timer);
    this.app.pushTo(front?.screen ?? this.app.route(), "result", reply);
    this.log(line);
  }
  send(cmd) {
    this.log(`> ${cmd}`);
    this.usage[cmd] = Date.now();
    this.app.pushState("usage", { ...this.usage });
    const set = /^SET (\S+) (.+)$/.exec(cmd);
    if (set) {
      this.settings = { ...this.settings, [set[1]]: set[2] };
      this.app.pushState("settings", this.settings);
    }
    const entry = { screen: this.app.route(), cmd, timer: null };
    const fail = (why) => {
      const i = this.pendingCmds.indexOf(entry);
      if (i < 0)
        return;
      this.pendingCmds.splice(i, 1);
      if (entry.timer)
        clearTimeout(entry.timer);
      this.app.pushTo(entry.screen, "result", { ok: false, busy: false, msg: why });
      this.log(`ERR ${why} (${entry.cmd})`);
    };
    entry.timer = setTimeout(() => fail("tanpa jawaban dari mesin"), REPLY_TIMEOUT_MS);
    this.pendingCmds.push(entry);
    this.services.ble.write(cmd).then((ok) => {
      if (!ok)
        fail("kirim gagal — cek sambungan");
    }, () => fail("kirim gagal — cek sambungan"));
  }
  failAllPending(why) {
    for (const entry of this.pendingCmds.splice(0)) {
      if (entry.timer)
        clearTimeout(entry.timer);
      this.app.pushTo(entry.screen, "result", { ok: false, busy: false, msg: why });
      this.log(`ERR ${why} (${entry.cmd})`);
    }
  }
  dispose() {
    for (const entry of this.pendingCmds.splice(0)) {
      if (entry.timer)
        clearTimeout(entry.timer);
    }
  }
  log(line) {
    this.app.pushTo("home", "log", { t: Date.now(), line });
  }
  tap(id) {
    this.app.dispatch("TAP", { id });
  }
  onStateInvalidation(listener) {
    return this.app.onStateInvalidation(listener);
  }
  render() {
    return this.app.render();
  }
}

// src/write-queue.ts
function createWriteQueue(write, onFail) {
  let chain = Promise.resolve();
  return {
    enqueue(cmd) {
      const run = chain.then(() => write(cmd));
      chain = run.then(() => {
        return;
      }, () => {
        return;
      });
      return run.then(() => true, (e) => {
        onFail(cmd, e);
        return false;
      });
    }
  };
}

// ../gallery-preview/renderer.ts
function toCss(color) {
  if (color.startsWith("#") && color.length === 9) {
    const a = parseInt(color.slice(1, 3), 16) / 255;
    const r = parseInt(color.slice(3, 5), 16);
    const g = parseInt(color.slice(5, 7), 16);
    const b = parseInt(color.slice(7, 9), 16);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }
  return color;
}
function anchorOffsetForTest(position, visibleHeight) {
  if (!position.fixed || position.anchorSize === undefined)
    return 0;
  if (position.anchor === "bottom")
    return visibleHeight - position.anchorSize;
  if (position.anchor === "center")
    return (visibleHeight - position.anchorSize) / 2;
  return 0;
}
var KNOWN_OP_KINDS = new Set([
  "rect",
  "outline",
  "text",
  "circle",
  "ring",
  "line",
  "gradient"
]);
function sceneContractError(scene) {
  if (!scene || typeof scene !== "object") {
    return "scene is not an object";
  }
  if (typeof scene.version !== "number") {
    return "scene.version is missing or not a number";
  }
  if (!Array.isArray(scene.ops)) {
    return "scene.ops is missing or not an array";
  }
  if (!Array.isArray(scene.taps)) {
    return "scene.taps is missing or not an array";
  }
  if (scene.version > CanvasPreviewRenderer.SUPPORTED_SCENE_VERSION) {
    return `scene version ${scene.version} exceeds renderer support (${CanvasPreviewRenderer.SUPPORTED_SCENE_VERSION})`;
  }
  for (let index = 0;index < scene.ops.length; index++) {
    const op = scene.ops[index];
    if (!op || typeof op !== "object") {
      return `ops[${index}] is not an object`;
    }
    const kind = op.op;
    if (!KNOWN_OP_KINDS.has(kind)) {
      return `unknown op kind "${kind}" at ops[${index}]`;
    }
  }
  return null;
}
function hitTestTaps(taps, designX, viewportY, visibleHeight, scrollY, action) {
  for (let index = taps.length - 1;index >= 0; index--) {
    const tap = taps[index];
    if (action !== undefined && tap.action !== action)
      continue;
    const y = tap.fixed ? tap.y + anchorOffsetForTest(tap, visibleHeight) : tap.y - scrollY;
    if (tap.x <= designX && designX <= tap.x + tap.w && y <= viewportY && viewportY <= y + tap.h) {
      return index;
    }
  }
  return null;
}
function translateFixedOp(op, visibleHeight) {
  const dy = anchorOffsetForTest(op, visibleHeight);
  if (dy === 0)
    return op;
  switch (op.op) {
    case "circle":
    case "ring":
      return { ...op, cy: op.cy + dy };
    case "line":
      return { ...op, y1: op.y1 + dy, y2: op.y2 + dy };
    default:
      return { ...op, y: op.y + dy };
  }
}

class CanvasPreviewRenderer {
  canvas;
  context;
  scale = 1;
  designWidth = 720;
  static SUPPORTED_SCENE_VERSION = 1;
  constructor(canvas) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Canvas 2D context unavailable");
    this.context = context;
    this.resize();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.scale = rect.width > 0 ? rect.width / this.designWidth : 1;
  }
  render(scene, scrollY) {
    const error = sceneContractError(scene);
    if (error !== null) {
      console.error(`[TENUN_SCENE_ERROR] ${error}; keeping the last painted scene`);
      return;
    }
    this.designWidth = scene.designWidth;
    this.resize();
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;
    const scale = width / scene.designWidth;
    const visibleHeight = height / scale;
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = toCss(scene.background);
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(0, -scrollY);
    ctx.beginPath();
    ctx.rect(0, scrollY, scene.designWidth, visibleHeight);
    ctx.clip();
    for (const op of scene.ops) {
      if (!op.fixed)
        this.paint(ctx, op);
    }
    ctx.restore();
    ctx.save();
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, scene.designWidth, visibleHeight);
    ctx.clip();
    for (const op of scene.ops) {
      if (op.fixed)
        this.paint(ctx, translateFixedOp(op, visibleHeight));
    }
    ctx.restore();
  }
  hitTest(scene, clientX, clientY, scrollY, action) {
    if (sceneContractError(scene) !== null)
      return null;
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / scene.designWidth;
    return hitTestTaps(scene.taps, (clientX - rect.left) / scale, (clientY - rect.top) / scale, rect.height / scale, scrollY, action);
  }
  maxScroll(scene) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / scene.designWidth;
    return Math.max(0, scene.contentHeight - rect.height / scale);
  }
  paint(ctx, op) {
    switch (op.op) {
      case "text": {
        ctx.fillStyle = toCss(op.color);
        ctx.font = `${op.weight >= 600 ? "700" : "400"} ${op.size}px sans-serif`;
        let x = op.x;
        if (op.width !== undefined && op.align === "center") {
          const measured = ctx.measureText(op.text).width;
          x = op.x + Math.max(0, (op.width - measured) / 2);
        }
        ctx.fillText(op.text, x, op.y);
        return;
      }
      case "circle": {
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.fillStyle = toCss(op.color);
        ctx.fill();
        return;
      }
      case "ring": {
        if (op.track) {
          ctx.beginPath();
          ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
          ctx.strokeStyle = toCss(op.track);
          ctx.lineWidth = op.width;
          ctx.lineCap = "round";
          ctx.stroke();
        }
        if (op.progress > 0) {
          const start = -Math.PI / 2;
          const end = start + Math.PI * 2 * Math.min(op.progress, 1);
          ctx.beginPath();
          ctx.arc(op.cx, op.cy, op.r, start, end);
          ctx.strokeStyle = toCss(op.color);
          ctx.lineWidth = op.width;
          ctx.lineCap = "round";
          ctx.stroke();
        }
        return;
      }
      case "line": {
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.strokeStyle = toCss(op.color);
        ctx.lineWidth = op.width;
        ctx.stroke();
        return;
      }
      case "gradient": {
        ctx.save();
        if (op.shadow)
          this.applyShadow(ctx, op.shadow);
        const gradient = ctx.createLinearGradient(op.x, op.y, op.x, op.y + op.h);
        gradient.addColorStop(0, op.color);
        gradient.addColorStop(1, op.colorTo);
        ctx.beginPath();
        ctx.roundRect(op.x, op.y, op.w, op.h, op.r);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.restore();
        return;
      }
      case "outline": {
        ctx.beginPath();
        ctx.roundRect(op.x, op.y, op.w, op.h, op.r);
        ctx.strokeStyle = toCss(op.color);
        ctx.lineWidth = op.width;
        ctx.stroke();
        return;
      }
      default: {
        ctx.save();
        if (op.shadow)
          this.applyShadow(ctx, op.shadow);
        ctx.beginPath();
        ctx.roundRect(op.x, op.y, op.w, op.h, op.r);
        ctx.fillStyle = toCss(op.color);
        ctx.fill();
        ctx.restore();
      }
    }
  }
  applyShadow(ctx, elevation) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = elevation;
    ctx.shadowOffsetY = elevation / 2;
  }
}

// preview.ts
var canvas = document.querySelector("#preview");
var routes = document.querySelector("#routes");
var linkBtn = document.querySelector("#link-btn");
var statusText = document.querySelector("#status");
if (!canvas || !routes || !linkBtn || !statusText)
  throw new Error("preview shell is incomplete");
var previewCanvas = canvas;
var routeNav = routes;
var device = null;
var cmdChar = null;
var encoder = new TextEncoder;
var decoder = new TextDecoder;
function bleSupported() {
  return typeof navigator.bluetooth?.requestDevice === "function";
}
function textOf(dv) {
  return decoder.decode(dv.buffer.byteOffset === 0 && dv.buffer.byteLength === dv.byteLength ? dv.buffer : dv);
}
var gattQueue = createWriteQueue(async (cmd) => {
  if (!cmdChar)
    throw new Error("not connected");
  await cmdChar.writeValue(encoder.encode(cmd));
  await new Promise((r) => setTimeout(r, 80));
}, (_cmd, e) => {
  statusText.textContent = `write failed: ${String(e)}`;
  statusText.className = "status error";
});
function enqueueWrite(cmd) {
  return gattQueue.enqueue(cmd);
}
var userDisconnected = false;
var reconnectTimer = 0;
var reconnectAttempts = 0;
function clearAutoReconnect() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  }
  reconnectAttempts = 0;
}
async function attemptAutoReconnect() {
  if (userDisconnected || !device || demoActive || reconnectAttempts >= 3) {
    return;
  }
  reconnectAttempts++;
  statusText.textContent = `sambung ulang (${reconnectAttempts}/3)…`;
  linkBtn.className = "wait";
  reconnectTimer = window.setTimeout(async () => {
    if (userDisconnected || !device || demoActive)
      return;
    try {
      const server = await device.gatt?.connect();
      if (!server)
        throw new Error("no server");
      const svc = await server.getPrimaryService(BLE_SVC_UUID);
      cmdChar = await svc.getCharacteristic(BLE_CMD_UUID);
      const stat = await svc.getCharacteristic(BLE_STAT_UUID);
      await stat.startNotifications();
      stat.addEventListener("characteristicvaluechanged", (e) => {
        if (e.target.value)
          runtime.lineIn(textOf(e.target.value));
      });
      clearAutoReconnect();
      pushLink({ connected: true, connecting: false, name: device.name ?? "polytron" });
      runtime.lineIn(textOf(await stat.readValue()));
      enqueueWrite("GET:ALL");
    } catch {
      if (reconnectAttempts < 3 && !userDisconnected) {
        attemptAutoReconnect();
      } else {
        clearAutoReconnect();
        pushLink({ connected: false, connecting: false });
      }
    }
  }, reconnectAttempts * 2000);
}
async function bleConnect() {
  const bt = navigator.bluetooth;
  if (!bt?.requestDevice)
    return false;
  userDisconnected = false;
  clearAutoReconnect();
  pushLink({ connecting: true });
  try {
    device = await bt.requestDevice({ filters: [{ services: [BLE_SVC_UUID] }] });
    device.addEventListener("gattserverdisconnected", () => {
      cmdChar = null;
      pushLink({ connected: false, connecting: false });
      if (!userDisconnected && !demoActive && device) {
        attemptAutoReconnect();
      }
    });
    const server = await device.gatt?.connect();
    if (!server)
      throw new Error("no gatt server");
    const svc = await server.getPrimaryService(BLE_SVC_UUID);
    cmdChar = await svc.getCharacteristic(BLE_CMD_UUID);
    const stat = await svc.getCharacteristic(BLE_STAT_UUID);
    await stat.startNotifications();
    stat.addEventListener("characteristicvaluechanged", (e) => {
      if (e.target.value)
        runtime.lineIn(textOf(e.target.value));
    });
    pushLink({ connected: true, connecting: false, name: device.name ?? "polytron" });
    runtime.lineIn(textOf(await stat.readValue()));
    enqueueWrite("GET:ALL");
    return true;
  } catch {
    pushLink({ connected: false, connecting: false });
    return false;
  }
}
function editProgramOverlay(slot, current) {
  return new Promise((resolve) => {
    const overlay = document.querySelector("#prog-edit");
    const title = document.querySelector("#prog-edit-title");
    const stepsContainer = document.querySelector("#prog-edit-steps");
    const summary = document.querySelector("#prog-edit-summary");
    const quickAdds = document.querySelector(".quick-adds");
    const toggleRawBtn = document.querySelector("#prog-edit-toggle-raw");
    const rawSection = document.querySelector("#prog-edit-raw-section");
    const input = document.querySelector("#prog-edit-input");
    const msg = document.querySelector("#prog-edit-msg");
    const saveBtn = document.querySelector("#prog-edit-save");
    const cancelBtn = document.querySelector("#prog-edit-cancel");
    if (!overlay || !input || !msg || !saveBtn || !cancelBtn) {
      resolve(null);
      return;
    }
    let steps = parseProgramSteps(current);
    let done = false;
    const finish = (v) => {
      if (done)
        return;
      done = true;
      overlay.hidden = true;
      resolve(v);
    };
    const slotName = PROGRAM_SLOTS[slot]?.name ?? `Slot ${slot}`;
    if (title)
      title.textContent = `${slotName} (Slot ${slot})`;
    overlay.hidden = false;
    input.value = current;
    msg.textContent = `Token mentah: WASH:600, DRAIN:30, SPIN:300, FILL:60, WAIT:60`;
    const stepColors = {
      WASH: "#00B7FD",
      SPIN: "#BB86FC",
      DRAIN: "#00FFC8",
      FILL: "#00FF80",
      RINSE: "#38BDF8",
      WAIT: "#FCB518"
    };
    function renderSteps() {
      if (!stepsContainer || !summary)
        return;
      stepsContainer.replaceChildren();
      if (steps.length === 0) {
        const empty = document.createElement("div");
        empty.style.color = "var(--dim)";
        empty.style.fontSize = "12px";
        empty.style.padding = "10px";
        empty.style.textAlign = "center";
        empty.textContent = "Belum ada langkah. Tambahkan langkah di bawah:";
        stepsContainer.appendChild(empty);
      }
      steps.forEach((st, idx) => {
        const row = document.createElement("div");
        row.className = "step-row";
        const badge = document.createElement("span");
        badge.className = "step-mode";
        const color = stepColors[st.mode] ?? "#9DB2C7";
        badge.style.color = color;
        badge.style.border = `1px solid ${color}66`;
        badge.style.background = `${color}18`;
        badge.textContent = `${idx + 1}. ${MODE_LABELS[st.mode] ?? st.mode}`;
        const stepper = document.createElement("div");
        stepper.className = "step-stepper";
        const minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.textContent = "−";
        minusBtn.title = "Kurangi durasi";
        minusBtn.onclick = () => {
          const stepDelta = st.s <= 60 ? 10 : st.s <= 300 ? 30 : 60;
          st.s = Math.max(10, st.s - stepDelta);
          syncFromSteps();
        };
        const valSpan = document.createElement("span");
        valSpan.className = "step-val";
        valSpan.textContent = fmtDurationS(st.s);
        const plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.textContent = "+";
        plusBtn.title = "Tambah durasi";
        plusBtn.onclick = () => {
          const stepDelta = st.s < 60 ? 10 : st.s < 300 ? 30 : 60;
          st.s = Math.min(3600, st.s + stepDelta);
          syncFromSteps();
        };
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "step-del";
        delBtn.textContent = "×";
        delBtn.title = "Hapus langkah ini";
        delBtn.onclick = () => {
          steps.splice(idx, 1);
          syncFromSteps();
        };
        stepper.append(minusBtn, valSpan, plusBtn, delBtn);
        row.append(badge, stepper);
        stepsContainer.appendChild(row);
      });
      const totalS = steps.reduce((sum, s) => sum + s.s, 0);
      summary.textContent = steps.length > 0 ? `Total durasi: ${fmtClock(totalS)} (${steps.length} langkah)` : "Total durasi: 0:00 (kosong)";
    }
    function syncFromSteps() {
      const formatted = formatProgramSteps(steps);
      input.value = formatted;
      renderSteps();
    }
    if (quickAdds) {
      quickAdds.onclick = (e) => {
        const target = e.target.closest("[data-add]");
        if (!target)
          return;
        const [mode, sStr] = (target.dataset.add ?? "").split(":");
        if (mode && sStr) {
          steps.push({ mode: mode.toUpperCase(), s: parseInt(sStr, 10) || 60 });
          syncFromSteps();
        }
      };
    }
    if (toggleRawBtn && rawSection) {
      rawSection.hidden = true;
      toggleRawBtn.textContent = "Tampilkan format teks mentah";
      toggleRawBtn.onclick = () => {
        rawSection.hidden = !rawSection.hidden;
        toggleRawBtn.textContent = rawSection.hidden ? "Tampilkan format teks mentah" : "Sembunyikan format teks mentah";
      };
    }
    input.oninput = () => {
      steps = parseProgramSteps(input.value);
      renderSteps();
    };
    saveBtn.onclick = () => finish(input.value.trim());
    cancelBtn.onclick = () => finish(null);
    input.onkeydown = (e) => {
      if (e.key === "Enter")
        finish(input.value.trim());
      if (e.key === "Escape")
        finish(null);
    };
    renderSteps();
    if (rawSection && rawSection.hidden) {
      saveBtn.focus();
    } else {
      input.focus();
    }
  });
}
function clockNow() {
  const d = new Date;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
var demoActive = false;
var demoTimer = 0;
var DEMO_SET = [
  "SET WASHMIN 10",
  "SET SPINMIN 7",
  "SET DRAINMIN 2",
  "SET FILLMIN 3",
  "SET RINSEMIN 5",
  "SET SPINDRAINS 30",
  "SET RINSEDRAINS 60",
  "SET STOPCOASTS 10",
  "SET PULSES 2.5",
  "SET DEADS 0.05",
  "SET SPINMOTOR B",
  "SET PROG0 WASH:300, SPIN:120",
  "SET PROG1 WASH:600, DRAIN:30, SPIN:300",
  "SET PROG2 WASH:900, DRAIN:60, FILL:60, SPIN:300"
];
var SIM_DEFAULT = [
  { mode: "WASH", s: 600 },
  { mode: "DRAIN", s: 60 },
  { mode: "SPIN", s: 300 },
  { mode: "FILL", s: 60 },
  { mode: "SPIN", s: 180 }
];
var SIM_FUNCS = {
  WASH: [{ mode: "WASH", s: 300 }],
  SPIN: [{ mode: "SPIN", s: 300 }],
  DRAIN: [{ mode: "DRAIN", s: 120 }],
  FILL: [{ mode: "FILL", s: 120 }]
};
var FN_NAMES = {
  WASH: "CUCI",
  SPIN: "PERAS",
  DRAIN: "BUANG",
  FILL: "ISI",
  RINSE: "BILAS",
  RINSEND: "BILAS ND"
};
var simToks = SIM_DEFAULT;
var simName = "NORMAL";
var simRun = false;
var simEl = 0;
var simWater = 63;
var simTotal = () => simToks.reduce((a, t) => a + t.s, 0);
function simTokAt(el) {
  let acc = 0;
  for (let i = 0;i < simToks.length; i++) {
    acc += simToks[i].s;
    if (el < acc)
      return { mode: simToks[i].mode, idx: i };
  }
  return { mode: simToks[simToks.length - 1].mode, idx: simToks.length - 1 };
}
function simRelays(mode) {
  if (mode === "WASH")
    return "1000";
  if (mode === "SPIN")
    return "0100";
  if (mode === "DRAIN")
    return "0010";
  if (mode === "FILL")
    return "0001";
  return "0000";
}
function simStart(toks, name) {
  simToks = toks;
  simName = name;
  simEl = 0;
  simRun = true;
}
function pushSimStatus() {
  const line = simRun ? (() => {
    const t = simTokAt(simEl);
    return `ST:${t.mode}|${simName}|${t.idx + 1}/${simToks.length}|${simEl}|${Math.max(0, simTotal() - simEl)}|${simRelays(t.mode)}|180|W${simWater}`;
  })() : `ST:IDLE|${simName.startsWith("DONE") ? simName : "READY"}|0/0|${simEl}|0|0000|180|W${simWater}`;
  runtime.lineIn(line);
}
function demoExec(rawCmd) {
  const cmd = rawCmd.toUpperCase();
  const reply = (r) => runtime.lineIn(r);
  const start = (toks, name, ok) => {
    simStart(toks, name);
    reply(ok);
  };
  if (cmd === "STOP") {
    if (simRun)
      simName = `DONE ${simName.replace(/^DONE /, "")}`;
    simRun = false;
    reply("OK STOP");
  } else if (cmd.startsWith("GET")) {
    reply("OK 14 settings follow");
    for (const l of DEMO_SET)
      runtime.lineIn(l);
  } else if (cmd.startsWith("SET")) {
    reply(`OK SET ${cmd.slice(4).split(" ")[0]}`);
  } else if (cmd.startsWith("PROG")) {
    const n = Math.max(0, Math.min(2, parseInt(cmd.split(" ")[1] ?? "0", 10) || 0));
    const sets = [
      [{ mode: "WASH", s: 300 }, { mode: "SPIN", s: 120 }],
      [...SIM_DEFAULT],
      [{ mode: "WASH", s: 900 }, { mode: "DRAIN", s: 60 }, { mode: "FILL", s: 60 }, { mode: "SPIN", s: 300 }]
    ];
    start(sets[n], ["CEPAT", "NORMAL", "KUSTOM"][n], `OK ${["CEPAT", "NORMAL", "KUSTOM"][n]}`);
  } else if (cmd === "TUB") {
    start([{ mode: "WASH", s: 900 }, { mode: "DRAIN", s: 60 }, { mode: "SPIN", s: 300 }], "TUB CLEAN", "OK TUB CLEAN");
  } else if (cmd === "CLOCK") {
    reply("OK CLOCK 10:24");
  } else if (cmd === "WATER") {
    reply(`WATER raw 433 ema 430 pct ${simRun ? simWater : -1} cal 310..1024`);
  } else if (cmd === "VER") {
    reply("polytron-wash-tft v4.10");
  } else if (cmd.startsWith("WCAL")) {
    reply("OK WCAL");
  } else if (cmd.startsWith("RINSE")) {
    const nd = cmd.startsWith("RINSEND");
    start([{ mode: "FILL", s: 60 }, { mode: "DRAIN", s: 60 }, { mode: "SPIN", s: 120 }], FN_NAMES[nd ? "RINSEND" : "RINSE"], nd ? "OK RINSEND" : "OK RINSE");
  } else if (cmd.startsWith("WASH") || cmd.startsWith("SPIN") || cmd.startsWith("DRAIN") || cmd.startsWith("FILL")) {
    const verb = ["WASH", "SPIN", "DRAIN", "FILL"].find((v) => cmd.startsWith(v));
    start(SIM_FUNCS[verb], FN_NAMES[verb], `OK ${verb} 300 s`);
  } else {
    reply("ERR verb");
  }
  pushSimStatus();
}
function demoTick() {
  if (!simRun)
    return;
  simEl += 1;
  const mode = simTokAt(simEl).mode;
  if (mode === "FILL")
    simWater = Math.min(100, simWater + 1);
  if (mode === "DRAIN")
    simWater = Math.max(0, simWater - 2);
  if (simEl >= simTotal()) {
    simRun = false;
    simName = `DONE ${simName.replace(/^DONE /, "")}`;
  }
  pushSimStatus();
}
function toggleDemo(on) {
  if (on === demoActive)
    return;
  demoActive = on;
  const btn = document.querySelector("#demo-btn");
  if (on) {
    simToks = SIM_DEFAULT;
    simName = "NORMAL";
    simEl = 0;
    simRun = true;
    simWater = 63;
    pushLink({ supported: true, connecting: false, connected: true, name: "simulator" });
    for (const l of DEMO_SET)
      runtime.lineIn(l);
    pushSimStatus();
    demoTimer = window.setInterval(demoTick, 1000);
    btn?.classList.add("on");
  } else {
    window.clearInterval(demoTimer);
    pushLink({ supported: bleSupported(), connecting: false, connected: false, name: null });
    btn?.classList.remove("on");
  }
  btn?.setAttribute("aria-pressed", on ? "true" : "false");
}
var nativeBle = window.PolytronNative;
var bleSeam = {
  supported: () => demoActive || nativeBle !== undefined || bleSupported(),
  connect: () => {
    if (demoActive)
      return Promise.resolve(true);
    if (nativeBle) {
      nativeBle.connect();
      return Promise.resolve(true);
    }
    return bleConnect();
  },
  disconnect: () => {
    userDisconnected = true;
    clearAutoReconnect();
    if (demoActive) {
      toggleDemo(false);
      return;
    }
    if (nativeBle) {
      nativeBle.disconnect();
      return;
    }
    try {
      device?.gatt?.disconnect();
    } catch {}
  },
  write: (cmd) => {
    if (demoActive) {
      demoExec(cmd);
      return Promise.resolve(true);
    }
    if (nativeBle) {
      return Promise.resolve(nativeBle.write(cmd));
    }
    return enqueueWrite(cmd);
  }
};
window.__nativeLine = (line) => {
  runtime.lineIn(line);
};
window.__nativeLink = (l) => {
  pushLink({ supported: true, connected: l.connected, connecting: false, name: l.name });
  if (l.connected) {
    bleSeam.write("GET:ALL");
  }
};
var runtime = new WasherRuntime({
  ble: bleSeam,
  clockNow,
  editProgram: editProgramOverlay,
  designWidth: Math.round(Math.min(430, Math.max(320, window.innerWidth || 390)))
});
var linkNow = { supported: false, connecting: false, connected: false, name: null };
function pushLink(link) {
  linkNow = { ...linkNow, ...link };
  runtime.linkPush(linkNow);
  linkBtn.classList.toggle("ok", linkNow.connected);
  linkBtn.classList.toggle("wait", !linkNow.connected && linkNow.supported && !linkNow.connecting);
  linkBtn.disabled = false;
  if (linkNow.connected) {
    statusText.textContent = linkNow.name ?? "tersambung";
    linkBtn.title = "tersambung — ketuk untuk memutuskan";
  } else if (linkNow.connecting) {
    statusText.textContent = "menghubungkan…";
    linkBtn.title = "sedang memilih perangkat";
  } else if (linkNow.supported) {
    statusText.textContent = "belum tersambung";
    linkBtn.title = "ketuk untuk menyambungkan ke mesin";
  } else {
    statusText.textContent = "offline";
    linkBtn.title = "Bluetooth tidak tersedia — ketuk untuk info atau coba mode DEMO";
  }
  paint();
}
linkBtn.addEventListener("click", () => {
  if (linkNow.connecting)
    return;
  if (linkNow.connected) {
    userDisconnected = true;
    clearAutoReconnect();
    bleSeam.disconnect();
    return;
  }
  if (linkNow.supported) {
    userDisconnected = false;
    clearAutoReconnect();
    bleSeam.connect();
    return;
  }
  alert(`Browser ini belum mendukung Web Bluetooth (misalnya di iOS/Safari).

` + "Gunakan Google Chrome atau Microsoft Edge di Android / PC, atau aktifkan mode DEMO di kanan atas untuk simulasi kontrol.");
});
var renderer = new CanvasPreviewRenderer(previewCanvas);
var scrollY = 0;
var activeTap = null;
var prevRunning = false;
function updateDocumentFeedback() {
  const st = runtime.status();
  if (st?.running) {
    document.title = `(${fmtClock(st.remainS)}) ${st.mode} · Polytron Wash`;
    prevRunning = true;
  } else if (st && !st.running && st.prog.startsWith("DONE")) {
    document.title = `(✓ Selesai) Polytron Wash`;
    if (prevRunning) {
      prevRunning = false;
      try {
        navigator.vibrate?.([200, 100, 200, 100, 300]);
      } catch {}
    }
  } else {
    document.title = "Polytron Wash · TenunJS";
    prevRunning = false;
  }
}
function paint() {
  updateDocumentFeedback();
  const result = runtime.render();
  scrollY = Math.min(scrollY, renderer.maxScroll(result.scene));
  renderer.render(result.scene, scrollY);
  if (activeTap) {
    const ctx = previewCanvas.getContext("2d");
    if (ctx) {
      const scale = previewCanvas.clientWidth / result.scene.designWidth;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.scale(scale, scale);
      ctx.translate(0, -scrollY);
      ctx.fillStyle = "rgba(0, 183, 253, 0.16)";
      ctx.strokeStyle = "rgba(0, 183, 253, 0.45)";
      ctx.lineWidth = 2;
      const r = Math.min(14, activeTap.h / 3);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(activeTap.x, activeTap.y, activeTap.w, activeTap.h, r);
      } else {
        ctx.rect(activeTap.x, activeTap.y, activeTap.w, activeTap.h);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  for (const button of routeNav.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.route === runtime.route());
  }
}
function makeRouteButtons() {
  routeNav.replaceChildren();
  const labels = {
    home: "Home",
    programs: "Programs",
    controls: "Controls",
    settings: "Settings"
  };
  for (const route of runtime.routes()) {
    const button = document.createElement("button");
    button.className = "route";
    button.dataset.route = route;
    button.textContent = labels[route] ?? route;
    button.addEventListener("click", () => {
      runtime.navigate(route);
      scrollY = 0;
      paint();
    });
    routeNav.append(button);
  }
}
previewCanvas.addEventListener("pointerdown", (event) => {
  previewCanvas.setPointerCapture(event.pointerId);
  pointerY = event.clientY;
  dragging = false;
  const render = runtime.render();
  const rect = previewCanvas.getBoundingClientRect();
  const scale = rect.width / render.scene.designWidth;
  const x = (event.clientX - rect.left) / scale;
  const y = (event.clientY - rect.top) / scale + scrollY;
  activeTap = render.scene.taps.find((tap) => x >= tap.x && x <= tap.x + tap.w && y >= tap.y && y <= tap.y + tap.h) ?? null;
  if (activeTap)
    paint();
});
previewCanvas.addEventListener("pointermove", (event) => {
  if (!previewCanvas.hasPointerCapture(event.pointerId))
    return;
  const delta = pointerY - event.clientY;
  if (Math.abs(delta) > 1) {
    dragging = true;
    if (activeTap) {
      activeTap = null;
      paint();
    }
  }
  pointerY = event.clientY;
  const scene = runtime.render().scene;
  const scale = previewCanvas.clientWidth / scene.designWidth;
  scrollY = Math.max(0, Math.min(renderer.maxScroll(scene), scrollY + delta / scale));
  renderer.render(scene, scrollY);
});
previewCanvas.addEventListener("pointerup", (event) => {
  previewCanvas.releasePointerCapture(event.pointerId);
  activeTap = null;
  if (dragging)
    return;
  const render = runtime.render();
  const rect = previewCanvas.getBoundingClientRect();
  const scale = rect.width / render.scene.designWidth;
  const x = (event.clientX - rect.left) / scale;
  const y = (event.clientY - rect.top) / scale + scrollY;
  let fired = false;
  render.scene.taps.forEach((tap, i) => {
    if (x >= tap.x && x <= tap.x + tap.w && y >= tap.y && y <= tap.y + tap.h) {
      const run = render.tapRuns[i];
      if (typeof run === "function") {
        run();
        fired = true;
      }
    }
  });
  if (fired) {
    try {
      navigator.vibrate?.(12);
    } catch {}
    paint();
  } else {
    paint();
  }
});
previewCanvas.addEventListener("pointercancel", () => {
  activeTap = null;
  paint();
});
previewCanvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const scene = runtime.render().scene;
  const scale = previewCanvas.clientWidth / scene.designWidth;
  scrollY = Math.max(0, Math.min(renderer.maxScroll(scene), scrollY + event.deltaY / scale));
  renderer.render(scene, scrollY);
}, { passive: false });
var pointerY = 0;
var dragging = false;
makeRouteButtons();
document.querySelector("#demo-btn")?.addEventListener("click", () => toggleDemo(!demoActive));
pushLink({ supported: bleSupported() });
paint();
window.addEventListener("resize", () => paint());
runtime.onStateInvalidation(() => paint());
window.__polytronDebug = {
  runtime,
  tapAt: (fx, fy) => {
    const r = previewCanvas.getBoundingClientRect();
    const scene = runtime.render().scene;
    const x = fx * scene.designWidth;
    const y = fy * (scene.contentHeight ?? previewCanvas.height);
    const runs = runtime.render().tapRuns;
    let fired = false;
    scene.taps.forEach((tap, i) => {
      if (!fired && x >= tap.x && x <= tap.x + tap.w && y >= tap.y && y <= tap.y + tap.h) {
        const run = runs[i];
        if (typeof run === "function") {
          run();
          fired = true;
        }
      }
    });
    if (fired)
      paint();
    return fired;
  },
  sceneTexts: () => {
    const scene = runtime.render().scene;
    const texts = [];
    for (const op of scene.ops)
      if (op.op === "text")
        texts.push(op.text);
    return texts;
  },
  lineIn: (line) => runtime.lineIn(line),
  toggleDemo
};

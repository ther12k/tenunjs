---
okf_version: 0.2
title: "Widgets and Styling API"
summary: "The three widget tiers, typed themes, and how layouts lower to display lists."
type: reference
status: accepted
---

# Widgets and styling

A runnable example — every widget below exists today:

```tsx
<Card padding="md" radius="lg" background="surfaceRaised">
  <Row gap="sm" align="center">
    <Icon glyph="◉" size={28} color="primary" />
    <Expanded>
      <Column gap="xs">
        <Text variant="title">Order #A-1042</Text>
        <Text variant="caption" color="onSurfaceVariant">Ready for pickup</Text>
      </Column>
    </Expanded>
    <Button variant="text" onPress={actions.open}>Open</Button>
  </Row>
</Card>
```

## The three tiers

**Structural widgets** (`@tenunjs/widgets`) — layout and interaction:
`Scaffold`, `AppBar`, `Column`, `Row`, `Text`, `Button`, `Card`,
`SizedBox`, `Center`, `Stack`, `Positioned`, `Expanded`, `GestureDetector`,
`Container`, `Icon`, `Spacer`, `Wrap`. These mirror Flutter's layout
vocabulary; see [Migrating from Flutter](flutter-migration.md) for the
widget-by-widget mapping and the deliberate divergences (`gap` instead of
spacer children, one `Button` with variants, flat `Container` decoration).

**Material components** (`@tenunjs-examples/ui-kit`) — the M3 family on
top of the structural tier: `Avatar`, `Chip`, `Switch`, `Checkbox`,
`Slider`, `TextField`, `Tabs`, `NavigationBar`, `ModalDrawer`,
`ModalBottomSheet`, `AlertDialog`, `SnackBar`, `SearchBar`, `ListTile`,
`FAB`, `IconButton`, `Carousel`, `ProgressRing`, `ProgressBar`,
`SegmentedButton`, `PageIndicator`, `StarRating`, `Sparkline`, `Badge`,
`HeroCard`, `Bubble`, `Divider`.

**Canvas escape hatch** (`CanvasBox` from the ui-kit) — the `CustomPaint`
equivalent for genuinely hand-drawn visuals; its paint closure emits plain
display-list ops and composes inside the structural widgets.

## Current prototype theme

```ts
export const appTheme = defineTheme({
  colors: {
    surface: '#FFFFFF',
    surfaceRaised: '#F5F6F8',
    text: '#16181D',
    accent: '#356AE6',
    danger: '#B42318',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 6, md: 10, lg: 16 },
  typography: {
    body: { size: 16, lineHeight: 22 },
    title: { size: 20, lineHeight: 26, weight: 600 },
  },
});
```

The public style API is typed and layout-oriented. It is not CSS, has no
selectors or cascade, and compiles to host-widget property blocks.

Color props on the structural widgets accept `#rrggbb` / `#aarrggbb`
literals or palette role names (`"primary"`, `"onSurfaceVariant"`, ...).
`ThemeScopeBox` narrows the palette for a region — Flutter's `Theme`
inspiration for the prototype. It is not yet the complete inherited
widget context or app-wide theme invalidation promised by TN-068.

## Accepted semantic color contract (TN-143)

[ADR-0024](../03-decisions/adr-0024-semantic-color-slots-before-widget-freeze.md)
freezes the color vocabulary and indirection rule before the widget layer
stabilizes. New widget schemas and semantic drawing APIs use a `ColorRef`,
created with `colorSlot("onSurface")`, instead of a literal color. Complete
palettes own the literal values. Application-specific colors use named
slots such as `colorSlot("app.chartRevenue")`.

The reference API is exported from `@tenunjs/widgets`:

```ts
import {
  bakeThemeScene,
  colorSlot,
  type SemanticDisplayListScene,
  type ThemePalette,
} from '@tenunjs/widgets';

const source: SemanticDisplayListScene = {
  tenun: 'semantic-display-list',
  version: 1,
  designWidth: 360,
  contentHeight: 120,
  background: colorSlot('background'),
  ops: [{
    op: 'text', x: 16, y: 40, text: 'One screen, two palettes',
    size: 18, weight: 600, color: colorSlot('onBackground'),
  }],
  taps: [],
};

function commitWithPalette(palette: ThemePalette) {
  // Keep source for the next palette change. The returned scene is
  // disposable concrete-color output for the current v1 hosts.
  return bakeThemeScene(source, palette);
}
```

`defineColorPalette()` validates and freezes a complete palette. Built-in
slots include background/surface pairs, primary/container pairs, outlines,
status/foreground pairs, and inverse surfaces; the ADR lists all 24.
Missing slots, malformed colors, unknown names, and literals inside a
semantic scene throw `ThemeContractError` with a stable code. A failed
bake does not mutate the source or the previous scene.

The [theme contract example](../examples/theme-contract/README.md) supplies
complete light/dark palettes and persists the selected preference through
`StorageCapability`. It proves this boundary with one unchanged semantic
screen. Ordinary TSX widgets, inherited scopes, and `ApplicationRuntime`
theme invalidation are still TN-068 implementation work; the prototype
widget props shown above have not silently changed to accept `ColorRef`.

The semantic scene stays in TypeScript. Only the result of
`bakeThemeScene()` uses the existing display-list v1 host format. Palette
colors use `#RRGGBB` or alpha-first `#AARRGGBB`; browser preview adapters
need conversion for the latter before claiming alpha conformance. The
reference example uses opaque colors.

## How layout lowers

The display-list engine walks the widget tree in a measure/place pass and
emits a plain-JSON scene consumed by the prototype hosts:

```json
{
  "tenun": "display-list",
  "version": 1,
  "designWidth": 720,
  "contentHeight": 1180,
  "background": "#101014",
  "ops": [ { "op": "rect", "x": 16, "y": 16, "w": 688, "h": 96, "r": 14, "color": "#1C1C24" } ],
  "taps": [ { "x": 16, "y": 16, "w": 688, "h": 96, "action": "tap", "payload": { "id": 0 } } ]
}
```

Ops are the seven drawing primitives (rect, outline, text, circle, ring,
line, gradient); taps are hit regions whose payload ids index a callback
table rebuilt on every render. Hosts stay dumb painter/dispatchers — no
widget knowledge crosses the boundary, which is why the structural tier
could grow without touching the Android prototype.

## Finite viewports and framework re-layout (TN-157)

`layoutScreen(theme, tree, { width, height })` supplies finite root bounds
in design units. `layoutScreen(theme, tree, width)` retains the existing
content-height mode: root width is finite and root height is unbounded.
An explicit SizedBox or Container can bound a subtree in either mode.

Finite height reaches the Scaffold body after its AppBar, padded
containers, and nested Rows/Columns. Expanded shares the available main
axis in either direction; cross-axis stretch also assigns an actual child
box. Geometry and hit regions use the same allocation. An Expanded in an
unbounded main axis throws `LayoutError` with `UNBOUNDED_FLEX`.

`ApplicationRuntime` accepts `viewport` as an alternative to its legacy
`designWidth` option:

```ts
const runtime = new ApplicationRuntime({
  screens,
  initial: 'today',
  theme: appTheme,
  viewport: { width: 720, height: 1000 },
});

// Called by an adapter that owns the current surface dimensions.
runtime.setViewport({ width: 540, height: 800 });
```

A changed viewport preserves route and controller state, invalidates the
old tap table, and emits one existing state-invalidation notification. A
subscribed `installHostHandoff` re-renders and commits the new scene;
otherwise the caller renders explicitly before dispatching new taps.
Identical dimensions are a no-op. Viewport data is copied, stays outside
application snapshots, and cannot be changed after runtime disposal.

Viewport dimensions must be positive finite numbers. Malformed dimensions
or supplying both initial `viewport` and `designWidth` fail with
`INVALID_VIEWPORT` before state changes. Invalid numeric widget constraints
fail with `INVALID_CONSTRAINT`; zero-sized widget boxes remain valid.

The [Day Plan foundation](../examples/framework-feel/README.md) exercises
this API with ordinary TSX screens and one custom visual. **Automatic
browser/Android viewport delivery is still a TN-155 follow-on.** Current
hosts repaint/scale a scene when their surface changes size; explicit
runtime-size tests do not certify that host-resize behavior. No new host
dispatch verb or scene-wire version is introduced here.

## Automatic host viewport delivery (TN-158)

The host handoff answers a `"VIEWPORT"` dispatch when the application it
drives adopts host bounds:

```ts
// Host side (browser host, Android SurfaceView, or any embedder):
dispatch("VIEWPORT", JSON.stringify({ width, height }));

// Bundle side: installHostHandoff routes the verb to app.setViewport
// when the application exposes it (ApplicationRuntime does).
```

Semantics:

- **Units are logical.** The browser host delivers canvas CSS pixels; the
  Android `SurfaceView` delivers density-independent pixels. After
  adoption the committed scene's `designWidth` equals the delivered
  width, so the host's design-to-pixel scale converges to 1 (browser) or
  the display density (Android), and hit-testing stays consistent.
- **The resized scene commits through the existing invalidation
  channel** — the same one a direct `setViewport()` call uses. State and
  route are preserved; the old tap table is invalidated; identical
  dimensions are a no-op that commits nothing.
- **Negotiation is one probe.** A bundle whose handoff application has
  no `setViewport` (wrapper apps, legacy bundles, the reference notes
  app) answers `UNKNOWN_ACTION`. Hosts read that — or a `NULL` result
  across the Android JNI boundary — as "this bundle does not negotiate
  viewports", stop delivering, and keep scaling the committed scene
  under its own `designWidth`. The Android view re-probes after an
  engine swap (OTA apply, hot reload) because support belongs to the
  bundle, not the view.
- **Malformed payloads fail visibly.** A non-JSON or invalid-dimension
  payload degrades to the handoff's `{}` and surfaces inside the runtime
  as `INVALID_VIEWPORT` — never a silent ignore.

## Host compatibility contract

Three version identities exist and none implies the others:

1. **Application bundle version** — which JS bundle is running.
2. **Snapshot state schema** — the serialized app-state shape (e.g. the
   showcase's `stateSchema: 2`); a host rejects or resets on newer ones.
3. **Scene contract version** — the display-list shape (`version: 1`
   today) and the host's `SUPPORTED_SCENE_VERSION`.

Host policy is **fail-closed**: a scene whose version exceeds host
support, or that contains an unknown op kind, is rejected whole — the
Android host keeps its last committed scene (including its hit regions)
and logs; the browser renderer neither paints nor hit-tests the rejected
scene and keeps its last painted canvas. A partially rendered interface
is never an acceptable outcome, and a rejected first commit renders an
explicit incompatible-bundle state, not a fallback UI.

One boundary a version number cannot draw: additive *fields* within a
scene version (like the anchored-overlay metadata) look identical to a
pre-anchor scene — `version` stays 1 either way, so version gating alone
cannot detect that a bundle *uses* them. Safe bundle↔host pairing
therefore comes from distribution — ship the matching APK from the same
tree — not from negotiation. This is exactly why the OTA boundary is
**JS application bundles only; no DEX/JAR/native library OTA**: the
fail-closed parser protects updated hosts, and host-contract changes
ship as an APK update. Bottom-anchored overlays resolve against the
application viewport height and are not IME-inset aware.

## Accessibility boundary

Drawn controls are not automatically accessible controls. The display
list paints glyphs and hit rectangles; no accessibility tree, content
descriptions, or virtual view hierarchy crosses the host boundary yet.
Interactive regions are currently reachable only by pointer. Full
accessibility (a virtual hierarchy with actions per region) is tracked
future work, not an implied capability of this API.

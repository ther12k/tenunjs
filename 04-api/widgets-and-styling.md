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

## Typed theme

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
widget, minus the context gymnastics.

## How layout lowers

The display-list engine walks the widget tree in a measure/place pass and
emits a plain-JSON scene every host paints identically:

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

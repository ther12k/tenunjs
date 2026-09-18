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

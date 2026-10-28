---
okf_version: 0.2
title: "Migrating from Flutter"
summary: "Widget-by-widget mapping from Flutter/Dart screens to the TenunJS TSX authoring model."
type: reference
status: accepted
---

# Migrating from Flutter

TenunJS borrows Flutter's best part — the composition model: every piece of
UI is a widget, layout is a tree of named widgets with named parameters, and
custom drawing is an explicit escape hatch. A Flutter screen ports over
almost name-for-name. Where Flutter's own ergonomics are weak, TenunJS
deliberately diverges (and says so below instead of pretending parity).

The three authoring tiers:

1. **Structural widgets** (`@tenunjs/widgets`) — the Flutter layout
   vocabulary: `Scaffold`, `AppBar`, `Column`, `Row`, `Text`, `Button`,
   `Card`, plus the migration set `SizedBox`, `Center`, `Stack`,
   `Positioned`, `Expanded`, `GestureDetector`, `Container`, `Icon`,
   `Spacer`, `Wrap`.
2. **Material components** (`@tenunjs-examples/ui-kit`) — the M3 family:
   `Avatar`, `Chip`, `Switch`, `Checkbox`, `Slider`, `TextField`, `Tabs`,
   `NavigationBar`, `ModalDrawer`, `ModalBottomSheet`, `AlertDialog`,
   `SnackBar`, `SearchBar`, `ListTile`, `FAB`, `IconButton`, `Carousel`,
   `ProgressRing`, `ProgressBar`, `SegmentedButton`, `PageIndicator`,
   `StarRating`, `Sparkline`, `Badge`, `HeroCard`, `Bubble`, `Divider`.
3. **Canvas escape hatch** (`CanvasBox`) — Flutter's `CustomPaint`: a paint
   closure emitting plain display-list ops when a visual genuinely needs
   hand-drawing.

## Widget mapping

| Flutter | TenunJS | Notes |
| --- | --- | --- |
| `Scaffold` | `Scaffold` | `appBar` + body children |
| `AppBar` | `AppBar` | `onMenu` for the drawer burger |
| `Column` | `Column` | `gap` instead of spacer children; `align` = crossAxisAlignment |
| `Row` | `Row` | `justify` = mainAxisAlignment; cross-axis default center, like Flutter |
| `Text` | `Text` | `variant` type scale instead of inline `TextStyle` |
| `ElevatedButton` / `FilledButton` / `OutlinedButton` / `TextButton` | `Button variant=` | one widget, named variants |
| `Card` | `Card` | `padding` / `radius` / `background` / `elevation` |
| `Container` | `Container` | flat `color` / `radius` / `borderColor` / `borderWidth` / `shadow` — no `BoxDecoration` |
| `SizedBox` | `SizedBox` | also the invisible base that sizes a `Stack` |
| `Center` | `Center` | |
| `Stack` | `Stack` | children in declaration order, later on top |
| `Positioned` | `Positioned` | `left`+`right` (or `top`+`bottom`) stretches |
| `Expanded` | `Expanded` | `flex` shares the Row's free width |
| `Flexible` | — | implicit text shrink covers the loose case |
| `GestureDetector` / `InkWell` | `GestureDetector` | `onTap` around any widget; see the input-model note below |
| `Spacer` | `Spacer` | Columns; Rows space with `gap` |
| `Wrap` | `Wrap` | `spacing` / `runSpacing` |
| `Icon` | `Icon` | `name` registry (check, close, star, favorite, menu, …) or direct `glyph`; no icon font |
| `CircleAvatar` | `Avatar` | ui-kit |
| `Chip` / `FilterChip` | `Chip` | ui-kit |
| `Switch`, `Checkbox`, `Slider` | same names | ui-kit |
| `TextField` | `TextField` | prototype: focus-ring stand-in; real editing/IME is the intended surface (M4) |
| `TabBar` / `TabBarView` | `Tabs` | screen state owns the page |
| `BottomNavigationBar` | `NavigationBar` | ui-kit |
| `Drawer` | `ModalDrawer` | overlay; place last in the body |
| `showModalBottomSheet` | `ModalBottomSheet` | overlay; place last |
| `showDialog` | `AlertDialog` | overlay; place last |
| `ScaffoldMessenger` / `SnackBar` | `SnackBar` | screen state owns visibility |
| `ListTile` | `ListTile` | leading/title/subtitle/trailing |
| `ListView` | `Column` | prototype: the whole scene scrolls; independent scroll regions and virtualization are the intended replacement (TN-155) |
| `Image` / `Image.network` | — | no image op yet (host capability, tracked) |
| animations | — | deterministic scenes; animation is future work |
| `CustomPainter` | `CanvasBox paint=` | same escape hatch |
| `setState` | typed actions | `defineScreen` actions mutate state; `view()` is pure |
| `Provider` / `Riverpod` / `Bloc` | controller state | one screen-scoped store, serializable snapshots |
| `ThemeData` | `defineTheme` | color roles; `ThemeScopeBox` narrows regions |

## What we deliberately do better

- **`gap` on Row/Column.** No `SizedBox(height: 8)` filler between every
  child — spacing is a property of the container.
- **One `Button`.** Flutter's four button classes collapse into one widget
  with a `variant`.
- **Flat Container decoration.** `color`/`radius`/`borderColor` props
  instead of a nested `BoxDecoration` (and `BoxShadow` list).
- **Typed actions + pure view.** No `setState`, no `BuildContext`, no
  effect cleanup — the controller's actions mutate typed state, `view()`
  renders from committed state, and snapshots serialize deterministically.
- **JSON display lists.** Layout lowers to a plain-JSON scene (rects,
  texts, circles, lines, gradients, taps) that every host — browser canvas
  or Android prototype — paints identically.
- **Fail-closed validation.** JSX props validate with stable error codes
  (`TENUN_JSX_ERROR`, `TENUN_PROP_INVALID`) instead of failing silently.

Colors on structural widgets accept `#rrggbb`/`#aarrggbb` literals or
palette role names (`"primary"`, `"onSurfaceVariant"`, ...), so themes flow
without imports.

## Input model: prototype boundaries, not the destination

The widget vocabulary maps closely, but today's interaction behavior is
prototype-grade. These are boundaries of the executing prototype — each has
an intended replacement in the architecture, tracked through the issue queue:

- **Tap dispatch is region-based, topmost-wins (prototype).** There is no
  gesture arena and no disambiguation between competing detectors yet: tap
  regions register in paint order and the last containing region receives
  the event (which is what makes modal scrims safe today). The intended
  model — gesture arbitration, drag/pinch, focus — is owned by the
  [input, focus, and gestures architecture](../02-architecture/input-focus-gestures.md);
  long-press already rides the display-list contract (TN-148/TN-152).
- **One gesture type, whole-scene scrolling (prototype).** `GestureDetector`
  means `onTap`; vertical drag is owned by the host scrolling the entire
  scene. The intended model is independent, nested scroll regions with
  gesture arbitration
  ([scrolling and animation](../02-architecture/scrolling-animation.md)) —
  `ListView`-style widgets arrive with it, not as a `Column` substitute
  forever.
- **`TextField` is a focus-ring stand-in (prototype).** Real text editing,
  IME composition, and selection are owned by the
  [text and IME architecture](../02-architecture/text-and-ime.md); the
  Android embedder already exercises a production soft-keyboard path on its
  reference app, and the widget-level surface catches up under M4.
- **"Hot reload" is engine replacement + snapshot restore (deliberate
  mechanism).** A replaced engine gets a serialized snapshot — exported
  state survives, live objects and callback identity do not. Flutter's hot
  reload preserves state in place and skips `main()`/`initState()`; the
  mechanisms differ and so do their limits. This is a design choice about
  the QuickJS runtime, not a missing feature.

## Honest gaps today (prototype boundaries to be replaced)

These are known prototype limits with intended replacements — not permanent
framework positions:

- `Column` has no main-axis `justify` — the scene is content-height and
  scrolls, so there is no free main-axis space to distribute (bounded
  containers arrive with the
  [public layout contract](../02-architecture/layout.md), TN-156).
- `Expanded` works in Rows; bounded-height Columns come later.
- Row `align="stretch"` degrades to `start` (no cross-axis size forcing
  in the prototype engine).
- No `Image`, no animations, no list virtualization (see the table).
- No persistent element/render layer yet: every render rebuilds the
  display list. Widget identity, incremental reconciliation, and preserved
  state across reconciliation are part of the planned widget layer — the
  display-list scene is the prototype's commit format, not the final
  element model.

The end-to-end application that exercises the intended behavior — nested
layout under resizing, editable text, independent scrolling, route
transitions with animation — is the next milestone
([TN-155](../06-issues/tn-155-framework-feel-milestone-app.md)).

## Cookbook

### Counter — the getting-started port

```dart
// Flutter
Scaffold(
  appBar: AppBar(title: const Text('Counter')),
  body: Center(
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text('$count', style: Theme.of(context).textTheme.displayLarge),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            OutlinedButton(onPressed: decrement, child: const Text('Decrease')),
            FilledButton(onPressed: increment, child: const Text('Increase')),
          ],
        ),
      ],
    ),
  ),
)
```

```tsx
// TenunJS — the shipped examples/counter
<Scaffold appBar={<AppBar title="Counter" />}>
  <Column padding="lg" gap="lg" align="center">
    <Card padding="lg" radius="lg" background="surfaceRaised">
      <Text variant="display">{state.count}</Text>
    </Card>
    <Row gap="md">
      <Button variant="secondary" onPress={actions.decrement}>Decrease</Button>
      <Button onPress={actions.increment}>Increase</Button>
    </Row>
  </Column>
</Scaffold>
```

`state` and `actions` arrive in `view({ state, actions })` — the
replacement for `setState`: actions mutate typed controller state, the
runtime re-renders.

### Media card — Stack + Positioned + GestureDetector

The flutter-showcase `HotelCard` is the shipped example of this pattern:

```tsx
<GestureDetector onTap={onSelect}>
  <Stack>
    <SizedBox width={328} height={300} />          {/* sizes the stack */}
    <Positioned top={0} left={0} right={0}>
      <Container height={172} radius={22} color={tint} shadow={6}>
        <Center><Icon glyph={hotel.glyph} size={72} color="#FFFFFF" /></Center>
      </Container>
    </Positioned>
    <Positioned top={187} left={0}><Text variant="title">{hotel.name}</Text></Positioned>
    <Positioned left={0} right={0} bottom={19}>
      <Row justify="between">
        <Text variant="body" color="#3DD68C">${hotel.price} / night</Text>
        <Text variant="caption" color="#F5A623">{hotel.rating} ★</Text>
      </Row>
    </Positioned>
  </Stack>
</GestureDetector>
```

The invisible `SizedBox` base sizes the stack (Flutter's
`Positioned.fill`-over-a-sized-box idiom); everything else positions over
it. Declaration order is z-order, exactly like Flutter's Stack.

### Row + Expanded — the list-tile staple

```tsx
<Row gap="sm" align="center">
  <Avatar label="TR" />
  <Expanded>
    <Column gap="xs">
      <Text variant="title">Tirta Rimba</Text>
      <Text variant="caption" color="onSurfaceVariant">Ubud, Bali</Text>
    </Column>
  </Expanded>
  <Button variant="text" onPress={actions.open}>Open</Button>
</Row>
```

`Expanded` takes the free width (flex shares with multiple Expanded
children), so the trailing button keeps its natural size — the single most
common Flutter row pattern, ported verbatim.

## Porting workflow

1. Map widgets through the table; layouts transfer structurally.
2. Replace inter-child `SizedBox` spacers with `gap`.
3. Replace `setState` with typed actions; handlers become `actions.x()`.
4. Pass colors as literals or palette role names.
5. Keep genuinely hand-drawn visuals in `CanvasBox` — that is what it is
   for, and it composes inside the structural widgets.

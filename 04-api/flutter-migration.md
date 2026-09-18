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
| `GestureDetector` / `InkWell` | `GestureDetector` | `onTap` around any widget |
| `Spacer` | `Spacer` | Columns; Rows space with `gap` |
| `Wrap` | `Wrap` | `spacing` / `runSpacing` |
| `Icon` | `Icon` | `name` registry (check, close, star, favorite, menu, …) or direct `glyph`; no icon font |
| `CircleAvatar` | `Avatar` | ui-kit |
| `Chip` / `FilterChip` | `Chip` | ui-kit |
| `Switch`, `Checkbox`, `Slider` | same names | ui-kit |
| `TextField` | `TextField` | focus-ring stand-in for real editing |
| `TabBar` / `TabBarView` | `Tabs` | screen state owns the page |
| `BottomNavigationBar` | `NavigationBar` | ui-kit |
| `Drawer` | `ModalDrawer` | overlay; place last in the body |
| `showModalBottomSheet` | `ModalBottomSheet` | overlay; place last |
| `showDialog` | `AlertDialog` | overlay; place last |
| `ScaffoldMessenger` / `SnackBar` | `SnackBar` | screen state owns visibility |
| `ListTile` | `ListTile` | leading/title/subtitle/trailing |
| `ListView` | `Column` | the whole scene scrolls; no virtualization yet |
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

## Honest gaps today

- `Column` has no main-axis `justify` — the scene is content-height and
  scrolls, so there is no free main-axis space to distribute.
- `Expanded` works in Rows; bounded-height Columns come later.
- Row `align="stretch"` degrades to `start` (no cross-axis size forcing
  in the prototype engine).
- No `Image`, no animations, no list virtualization (see the table).

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

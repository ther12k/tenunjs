---
okf_version: 0.2
title: "Layout Architecture"
summary: "Frozen public layout semantics (TN-156), renderer-neutral adapter contract, and Yoga/Taffy evidence gate."
type: architecture
status: accepted
---

# Layout architecture

TenunJS exposes a typed, Flutter-inspired style model. The public layout
semantics below are **frozen** (TN-156, 2026-10-28): widget behavior is the
contract, and any backend — the current TypeScript lowering, Yoga, Taffy, or
a future native engine — implements behind it. The public semantics guide
the backend choice, not the other way around.

Conformance is enforced by the spike corpus
(`spikes/layout/corpus/`): every case runs against every backend candidate
through the shared C driver in the existing evidence-packet flow, and a
backend that cannot pass the corpus cannot be selected. Cases 011–014
extend that corpus from adapter mechanics to public semantics; the one
case the current candidates could not both pass is recorded under
"Measured-space rule" below as a selection discriminator.

## Public layout semantics (frozen)

### The constraint model

Layout is one pass down and up the tree, in Flutter's shape:

1. A parent hands each child a **constraint**: minimum and maximum width
   and height, per axis. An axis is **unbounded** when its maximum is
   infinite.
2. The child determines its own size **within** those constraints
   (clamping into `[min, max]` when both are finite; sizes are never
   negative).
3. The parent positions the child inside its own box.

Constraints tighten monotonically: a child never receives more space than
its parent received, minus the parent's own padding, and a constraint's
min never exceeds its max. Unbounded space is a first-class state, not an
error — see the widget rules for what each widget does with it.

### Widget rules (behavior, not implementation)

- **Row / Column.** Children lay out sequentially along the main axis
  with `gap` between them; the cross axis follows `align`
  (start / center / stretch). With a **bounded** main axis, free space
  distributes to `Expanded` children proportionally to their flex values,
  after every non-`Expanded` child has taken its natural size; free space
  with no `Expanded` children sits after the last child (justify start)
  or centers the group (justify center). With an **unbounded** main axis
  the container's main size is the sum of children plus gaps.
  (Corpus 014: justify-center in a bounded Column. Corpus 011:
  cross-axis stretch.)
- **Expanded (flex).** Claims a share of the parent's FREE main-axis
  space, only when that axis is bounded; multiple `Expanded` children
  share proportionally to flex. **`Expanded` inside an unbounded main
  axis is a contract error**: a fail-visible diagnostic at layout time,
  never an accidental zero-size child. (Corpus 011: two flex-1 children
  in a bounded 300×100 Column each receive exactly 50 of main-axis
  space — the axis the current prototype does not yet implement.)
- **SizedBox.** Fixed width/height when given; otherwise sizes to its
  child and passes constraints through.
- **Center.** Passes its constraints through loosened and positions the
  child centered in its own box.
- **Stack.** Sizes to its first non-positioned child (or an explicit
  sized base); `Positioned` children place by the edges given, and
  opposing edges (left+right, top+bottom) stretch the child between
  them; declaration order is z-order.
- **Text — intrinsic measurement.** Text is a measured node: given a
  definite available width it may wrap and reports the height its lines
  need; given non-definite width it reports its max-content (single-line)
  size. A measured node's answer is authoritative for its size, clamped
  into its constraint box by the caller. (Corpus 006/009/010: measured
  nodes under definite and forwarded constraints; the fallback answer
  under non-definite space is the text analogy of max-content.)
- **Scroll regions (the TN-155 target).** A scroll container is bounded
  by its parent's constraints — that box is the **viewport** — while its
  content lays out with an **unbounded main axis** and keeps its intrinsic
  size. Content taller than the viewport overflows and is never clamped,
  shrunk, or re-measured to fit; scrolling changes the paint offset only,
  never layout. Nested scroll regions size the same way, each viewport
  bounded by its own parent. (Corpus 012: a 300×100 bounded Column holds
  a 140-tall intrinsic child whose own contents lay out through y=140 on
  both backend candidates — overflow preserved, nothing shrunk.)

### Measured-space rule (backend discriminator, found while freezing)

A backend must pass **non-definite** available main-axis space to a
measured child whenever the container's main axis is auto/unbounded;
substituting a bounded ancestor's size as definite measurement space is a
violation (it silently replaces a text's wrapped height with the
viewport height).

Observed 2026-10-28: the current candidates diverge exactly here. Under
`align: stretch` in a bounded-height Column, **taffy** conforms (the
measured child's fallback answer is used — corpus 010 passes this way),
while **yoga's candidate adapter** substitutes the bounded height as
definite available height (measured child came back 300×100 instead of
300×20; the case was dropped from the corpus and recorded here). Yoga's
adapter must fix this or be rejected at the M0 selection gate.

### Deliberate divergences from Flutter

- `gap` on Row/Column (and `spacing`/`runSpacing` on Wrap) instead of
  `SizedBox` spacer children.
- One `Button` with variants; flat `Container` decoration props instead
  of `BoxDecoration`.
- Default cross alignment is per-widget and documented on the widget
  (Row defaults to center, like Flutter); the contract itself is neutral
  — explicit `align` is always available and always wins.
- Layout output is a serializable display-list scene; the commit format
  is the framework's, not the backend's.

### Prototype boundaries this contract supersedes

The current TypeScript lowering implements a Flexbox-class subset:
content-height Columns (no bounded-main-axis `Expanded`), no cross-axis
size forcing (`align="stretch"` degrades to start), and whole-scene
scrolling instead of independent scroll regions. These are prototype
boundaries **violating** this frozen contract, not long-term differences;
TN-155's milestone app exercises their replacements.

## Where layout executes (frozen decision)

The **semantics** live in this contract; the **execution home** for v0.x
is the TypeScript framework layer — the same architectural position
Flutter occupies, where most layout logic lives in the Dart framework,
not the engine. Native-side layout remains available behind the unchanged
adapter contract (`spikes/layout/layout_adapter.h`) as an optimization
path, adoptable only through the M0/M2 evidence gates with the corpus as
the conformance bar. Being Flutter-inspired does not require native-side
layout; adopting it must be justified by runtime design and measurement,
never by the backend's convenience.

## Public style concepts

- Width, height, minimum, maximum, and aspect ratio
- Padding, margin, gap
- Row and column direction
- Main/cross-axis alignment
- Flex grow/shrink/basis
- Absolute positioning
- Overflow and clipping
- Device scale and safe-area insets
- Intrinsic measurement for text, images, and platform views

## Adapter contract

```text
create layout node
set typed style
attach/detach child
set measure callback
calculate under constraints
read result
mark dirty
release
```

Yoga and Taffy spikes consume the same conformance fixtures. Selection considers correctness, build/toolchain cost, incremental layout behavior, measurement callbacks, memory, and diagnostics—not only raw layout throughput.

## Constraint boundary

The framework does not expose CSS parsing, selectors, cascade, or browser layout. It may use familiar property names where they improve TypeScript ergonomics.

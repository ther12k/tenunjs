---
okf_version: 0.2
title: "Layout Architecture"
summary: "Renderer-neutral layout contract and Yoga/Taffy evidence gate."
type: architecture
status: accepted
---

# Layout architecture

TenunJS exposes a typed, Flutter-inspired style model but initially implements a practical Flexbox-class subset.

## Public layout semantics (the contract backends implement)

Widget names are not the product; layout **behavior** is. Flutter's
constraint-based model is the reference experience: parents provide bounds,
children determine their size within those bounds, and parents position
their children. The public semantics below are the contract; Yoga, Taffy,
or another backend implements behind it — **the public semantics guide the
backend choice, not the other way around.** The contract must explicitly
define (TN-156):

- How minimum and maximum constraints propagate from parent to child, and
  which widgets tighten or loosen them.
- How `Expanded` distributes free space in Rows **and** in bounded-height
  Columns (the prototype supports Rows only).
- What happens when a child receives unbounded space in a given axis —
  defined behavior (intrinsic sizing, clamping, or a fail-visible
  diagnostic), never an accident of the backend.
- How text wrapping and intrinsic measurement interact with layout: when
  a paragraph is measured, when its result is cached, and how it
  constrains and is constrained by its parent.
- How independent scroll regions behave inside surrounding widgets —
  viewport sizing, content measurement, and clipping — replacing the
  prototype's whole-scene scrolling.
- Which behaviors intentionally differ from Flutter, and why — written
  down, not implied by whatever the backend happens to do.

Two scope notes. Putting all layout into C++ or Rust is **not** a
requirement of being Flutter-inspired — Flutter itself keeps substantial
layout logic in its Dart framework; a native-side layout engine is a
separate engineering choice that must be justified by the runtime design
and measurements. And the current executing prototype (a Flexbox-class
subset lowering to a content-height scene) is a prototype boundary on the
way to this contract, not a long-term difference.

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

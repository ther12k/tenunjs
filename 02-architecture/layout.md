---
okf_version: 0.2
title: "Layout Architecture"
summary: "Renderer-neutral layout contract and Yoga/Taffy evidence gate."
type: architecture
status: accepted
---

# Layout architecture

TenunJS exposes a typed, Flutter-inspired style model but initially implements a practical Flexbox-class subset.

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

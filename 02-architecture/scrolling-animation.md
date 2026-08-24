---
okf_version: 0.2
title: "Scrolling and Animation"
summary: "Native-side frame behavior independent of JavaScript availability."
type: architecture
status: accepted
---

# Scrolling and animation

## Principle

JavaScript configures interaction; native evaluates frame-by-frame motion.

## Scrolling

A scroll node owns offset, velocity, bounds, overscroll policy, momentum, and gesture linkage in the engine. JS receives throttled/coalesced observations and terminal events. Programmatic commands use generation-aware handles and cancellable promises.

## Lazy lists

`ListView.builder` exposes item count, key, estimated extent, and row builder. The runtime materializes a bounded window; native owns viewport metrics and requests ranges. Recycling never changes semantic identity without an explicit key transition.

## Animation graph

Typed animation values, curves, springs, transforms, opacity, color, and selected layout-affecting properties compile to native graph nodes. The graph runs against the frame clock on the render/UI side.

## JS stall test

The acceptance suite starts a scroll and an opacity/transform animation, blocks the JS thread for 200 ms, and verifies that native motion continues within the declared frame budget. Callbacks may be delayed; visual state must not freeze.

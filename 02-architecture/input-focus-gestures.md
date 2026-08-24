---
okf_version: 0.2
title: "Input, Focus, and Gesture Architecture"
summary: "Unified pointer, keyboard, focus, and gesture behavior."
type: architecture
status: accepted
---

# Input, focus, and gesture architecture

## Input normalization

Embedders normalize touch, stylus, mouse, wheel, hardware keyboard, back, and accessibility actions into timestamped engine events. Coordinates include device scale and surface generation.

## Hit testing

The engine hit-tests the retained tree using layout, transforms, clips, visibility, and pointer policy. Hit paths remain stable for one event dispatch.

## Gesture arena

Recognizers compete through explicit states: possible, accepted, rejected, cancelled. Built-ins include tap, long press, pan, scale, and scroll. Nested scroll behavior is specified rather than inferred from callback order.

## Focus

Focus is a separate tree with scopes, traversal order, modal trapping, restoration, and platform accessibility coordination. Paint order does not automatically determine focus order.

## Event dispatch

Native events resolve to runtime-owned action handles. JS callbacks are queued after native locks are released. Coalescible move/scroll events are bounded; press, key, accessibility, and lifecycle events are not silently dropped.

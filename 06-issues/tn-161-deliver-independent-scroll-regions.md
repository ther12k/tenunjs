---
okf_version: 0.2
title: "TN-161: Deliver independent scroll regions"
summary: "TN-155 slice 4: a ScrollView widget over the frozen TN-156 scroll semantics, a scroll-region scene op both hosts render and hit-test, and the Android scroll-clipping P1 fix."
type: issue
status: closed
issue_id: "TN-161"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-156"
  - "TN-157"
---

# TN-161 — Deliver independent scroll regions

## Purpose

TN-156 froze the scroll semantics (bounded viewport, unbounded content
axis, overflow never clamped) but the only scrolling was whole-scene, and
the Android painter clipped content incorrectly under scroll (the
2026-10-27 review's P1 #3). This slice delivers the widget, the scene
op, both host adapters, and that fix.

## Required outcome

1. **`ScrollView` widget** lowering to a nested `scroll-region` op:
   bounded viewport box, intrinsic content height, children and tagged
   taps in content space; unbounded main axis and nesting fail visibly.
2. **Browser + Android hosts** paint regions (clip to viewport box,
   translate by the region's own clamped offset), hit-test tagged taps in
   content space in the same topmost-wins scan, and route wheel/drag and
   touch drags to the region under the pointer/DOWN point.
3. **The Android scroll-clip fix**: the scrolling layer's clip is now
   established in viewport space BEFORE the content translate.
4. **Day Plan** exercises it: the Today checklist is a scroll region;
   the footer stays pinned; resize re-bounds the region with state
   preserved; the shared-bundle parity gate carries the new op through
   real QuickJS.

## Status note (2026-10-29, closed)

Implemented and published in one session. Compatibility is the same
pairing rule as `text-input`: scenes using `scroll-region` require a
scroll-aware host; older hosts reject them visibly, and scenes without
`ScrollView` are byte-identical to before. Theme baking classifies the
colorless container and recurses into its children.

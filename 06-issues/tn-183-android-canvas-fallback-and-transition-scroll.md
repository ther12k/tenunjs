---
okf_version: 0.2
title: "TN-183: Android canvas null-fallback and route-transition scroll parity"
summary: "Two Android host render defects from the 2026-10-30 review: lockDrawCanvas missed SurfaceHolder's null-return rejection shape (blank surface on GPU-less configs), and route transitions dropped the scroll offset — a scrolled page snapped to its top the instant the animation started."
type: issue
status: in-progress
issue_id: "TN-183"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-181"
---

# TN-183 — Android canvas null-fallback and route-transition scroll parity

## Purpose

The 2026-10-30 production-readiness review (post-`823adc6`) found two
defects in the Android host's rendering path.

## Defect 1: the software fallback misses `null` hardware canvases (P1)

`lockDrawCanvas()` (TN-181) fell back to `lockCanvas()` only when
`lockHardwareCanvas()` THREW. But Android's `SurfaceHolder`
implementation catches hardware-backend failures inside its own lock and
returns `null` (AOSP `SurfaceView.internalLockCanvas`, verified API 26
`android-8.0.0_r1` :1027–1071, API 30, API 36 — the catch-and-return-null
shape is stable across every supported level). On such configs both draw
sites (`redraw`, `transitionFrameRunnable`) received `null` and skipped
drawing entirely: a blank or stale surface despite the documented
"unconditional software fallback".

## Required outcome

The fallback covers BOTH rejection shapes — thrown exceptions and `null`
returns: `holder.lockHardwareCanvas() ?: holder.lockCanvas()`.

## Defect 2: route transitions discarded scroll positioning (P2)

Settled rendering paints the scrollable body under `translate(0, -scrollY)`
(`renderDisplayList`), but `drawSceneLayer` — the path every transition
frame paints through — applied no vertical offset. A page scrolled 200
units snapped to its top the moment a route animation started, and the
destination could jump again at settle when the retained `scrollY` was
suddenly applied. The browser twin never had this bug:
`paintTransitionFrame` paints BOTH layers under the same `scrollY`
(`examples/gallery-preview/renderer.ts`, `paintScene(from/to, scrollY, …)`).

## Required outcome

1. `RouteTransitionState` snapshots `scrollY` at `beginRouteTransition`.
2. Both transition layers paint their non-fixed body under
   `translate(0, -scrollY)` inside the viewport clip; fixed overlays stay
   viewport-pinned — the settled-renderer and browser-twin rule.
3. The whole-scene scroll extent is recomputed at COMMIT time
   (`syncFromScene`), not only on the first draw, so touch clamps and
   transition snapshots work in laid-out-but-undrawn views.

## Verification

- `RouteTransitionTest.transitionSnapshotsTheScrollOffsetItsLayersPaintUnder`
  (device gate): a measured 320×480 view with 2000-unit content clamps a
  huge drag to exactly 1520 (extent exists at commit time), scrolls to
  400 through the production `scrollBy` clamp, and the in-flight
  transition snapshots 400 — then settles.
- 8/8 CI gates including the KVM device acceptance.

## Out of scope

- Pixel-diff evidence of the painted offset (the shared
  `renderDisplayListOps` body is the settled renderer's own pass; the
  device journeys exercise it on a real surface).

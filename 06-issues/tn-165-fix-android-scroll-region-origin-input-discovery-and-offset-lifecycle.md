---
okf_version: 0.2
title: "TN-165: Fix Android scroll-region paint origin, nested input discovery, and offset lifecycle"
summary: "TN-161's Android adapter clips to the region box but paints children without the region origin, finds no editor for a TextField inside a ScrollView, and leaks region offsets across engine swaps."
type: issue
status: closed
issue_id: "TN-165"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-160"
  - "TN-161"
---

# TN-165 — Fix Android scroll-region paint origin, nested input discovery, and offset lifecycle

## Purpose

The 2026-10-29 production-readiness review found three Android-side
defects in the just-landed TN-161 scroll regions (the browser host has
the same first two; this issue scopes the Android surface per the
current focus — the browser twins are follow-up work):

1. **Paint origin.** `paintDisplayListOp` clips to the region's scene
   box but translates only by the scroll offset, so children paint at
   content coordinates as if the region sat at (0,0). A region at
   (20,100) with a child at local (0,0) paints NOTHING (the clip
   excludes it) while its tap still hits — misplaced or invisible
   content with working hit-testing.
2. **Nested input discovery.** `adoptDisplayTextInput` searches only
   top-level ops, but the TN-161/TN-160 lowering nests a focused
   `text-input` descriptor inside the region's content ops. A TextField
   inside a ScrollView silently gets no editor session or IME — on a
   scene the contract accepts as valid.
3. **Offset lifecycle.** `regionOffsets` is view-scoped and never
   cleared on engine swap, so a swapped-in engine whose regions reuse
   the same ids inherits scroll positions from a different application.

## Required outcome

1. Region children paint translated by the region origin (x, y) minus
   the clamped offset, matching the hit-testing math.
2. Focused text-input discovery walks scroll-region content ops; the
   discovery helper is a pure, JVM-testable function on
   `DisplayListScene` and keeps the "at most one focused descriptor"
   contract visible.
3. An engine swap clears region offsets together with the other
   per-engine adapter state.

## Verification

- JVM: `DisplayListScene` discovery test (root-level, nested,
  read-only-skip, none) and a paint-transform mirror test in
  `TenunSurfaceViewTest` (hand-mirrored math, the existing
  `testSyncFromScene` precedent).
- Device gate: a `DisplayListTextInputTest` case whose script nests the
  focused descriptor inside a scroll-region commits through the
  production bridge and obtains a working InputConnection.
- The TN-161 parity gate and Day Plan journeys keep passing.

## Out of scope

- The browser host twins (renderer paint origin, stale stored offsets,
  `BrowserTextInput.sync` discovery) — separate follow-up issue.
- Any scene-op wire format change.
## Status note

**Closed 2026-10-29 by PR #250** (branch `fix/tn-162-165-android-production-blockers`,
commit `33f5602`). Evidence: DisplayListSceneTest discovery (root/nested/read-only/none), TenunSurfaceViewTest paint-transform mirror, device-gate DisplayListTextInputTest nested-scroll-region InputConnection case, TN-161 parity gate unchanged.


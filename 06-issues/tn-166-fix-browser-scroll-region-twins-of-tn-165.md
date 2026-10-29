---
okf_version: 0.2
title: "TN-166: Fix the browser scroll-region twins of TN-165"
summary: "The browser host paints scroll-region children without the region origin, hit-tests with stale unclamped offsets, finds no editor for a nested TextField, and skips nested text-input/text-clip contract checks."
type: issue
status: closed
issue_id: "TN-166"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-160"
  - "TN-161"
  - "TN-165"
---

# TN-166 — Fix the browser scroll-region twins of TN-165

## Purpose

TN-165 fixed the Android surface of the 2026-10-29 readiness findings and
explicitly deferred the browser twins. All three are live in
`examples/gallery-preview` at `35f3310` (probe evidence in the readiness
review):

1. **Paint origin.** `CanvasPreviewRenderer.render` clips to the region's
   scene box but translates children only by the scroll offset. A region
   at (20,44) with its first child at local (0,0) paints that child at
   scene (0,0) — clipped away entirely — while its tap still hit-tests
   correctly (`hitTestTapsWithRegions` subtracts the region origin).
   Invisible content with working hit-testing.
2. **Stale stored offsets.** Painting clamps the stored offset locally,
   but the offset map keeps the unclamped value and
   `hitTestTapsWithRegions` reads it raw. After scrolling a 20-row list
   to 700 and re-rendering an 8-row list (max offset 12), the first row
   paints at −12 yet a tap on it returns no target — painting and
   hit-testing disagree by 688 units.
3. **Nested input discovery.** `BrowserTextInput.sync` searches only
   top-level `scene.ops`, but the TN-160/TN-161 lowering nests a focused
   descriptor inside the region's content ops. The same field that gets
   an editor outside a ScrollView gets none inside one
   (`platformInputs=0`) on a scene the contract accepts.

Plus one hardening gap found by the same probes: `sceneContractError`
checks nested op KINDS but not the per-kind contracts — a nested
text-input with an invalid selection, a duplicate id, a second focused
descriptor, or a nested invalid text clip passes browser validation that
Android rejects.

## Required outcome

1. Region children paint translated by the region origin minus the
   clamped offset — the same math hit-testing uses, mirrored from
   `TenunSurfaceView`.
2. The stored offset is normalized to the current scene's bounds on
   every render (write-back), and `hitTestTapsWithRegions` clamps at
   read against the region's own `contentHeight − h`. Painting,
   hit-testing, drag continuation, and editor positioning all read one
   value.
3. `BrowserTextInput` discovers a focused, editable descriptor at the
   root OR inside scroll-region content, and positions the platform
   editor in the region's content space (region origin plus the region's
   current paint offset) through an injectable offset resolver the host
   wires to the renderer.
4. `sceneContractError` applies the text-input descriptor checks
   (validity, duplicate ids, single focus across root AND nested) and
   the text-clip validation to nested ops, with region-attributed
   messages.

## Verification

- New `examples/gallery-preview/test/scroll-region.test.ts`: paint
  origin (recorded rect/clip coordinates in scene space), offset
  normalization after content shrink (render + hit-test agreement),
  nested-editor discovery and positioning through the real widget
  handoff, and the nested contract-violation cases. Regression shape:
  every assertion fails on the pre-fix renderer/adapter.
- Existing text-input, framework-feel, and gallery suites keep passing;
  Android gates untouched (no Android files change).

## Out of scope

- Widgets-package polish found by the same probes (ScrollView
  constructor dropping nested-array children; the theme baker passing a
  null child through) — the host boundary already rejects those scenes
  fail-visibly; separate issue if pursued.
- Whole-scene scroll behavior, region lifecycle beyond offsets.

## Status note (2026-10-29, closed)

Implemented and published in one session. Fixed in PR #251 (commit 3021985):
browser paint/hit-testing now share the region-origin math and one clamped
offset value, the platform editor adopts and positions focused descriptors
nested in scroll regions through the real widget handoff, and nested ops
carry the full per-kind contract checks. Four checked-in tests fail
pre-fix and pass post-fix; 583-test suite, typecheck, manifest, and all
eight CI gates green including the device gate.


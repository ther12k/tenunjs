---
okf_version: 0.2
title: "TN-152: Carry the long-press gesture through the browser hosts"
summary: "TN-148's dual tap/long-press regions broke browser clicks (the unfiltered reverse hit test always picked the long-press region); browser hosts need gesture-filtered hit tests, hold timers, and dispatch by payload id — plus the malformed-scene and horizontal-slop edges."
type: issue
status: closed
issue_id: "TN-152"
milestone: "M2"
priority: "P1"
depends_on:
  - "TN-133"
  - "TN-148"
---

# TN-152 — Carry the long-press gesture through the browser hosts

## Metadata

| Field | Value |
|---|---|
| Milestone | M2 — Native scene, layout, and rendering (browser preview legs) |
| Priority | P1 |
| Dependencies | TN-133 (browser host legs), TN-148 (dual-gesture regions) |
| Suggested size | One renderer+shells PR |
| Gate impact | Every dual-gesture widget on any browser host; 2026-10-25 review's #3 finding |

## Purpose

Found by the 2026-10-25 framework review (reproduced headlessly). A
`GestureDetector` with both handlers emits two same-frame regions — tap
first, long-press second — and the shared `hitTestTaps` reverse scan
picked the LAST region, so a browser SHORT CLICK dispatched the
long-press run (`taps:0, holds:1` for one click). The Android host was
gesture-aware; the browser hosts were not. Two adjacent defects fell
out of the same audit: the gallery/showcase shells dispatched by region
INDEX (wrong run whenever chrome regions are prepended — the gallery
back bar, the showcase launcher), and the browser scene validator
accepted shapes (`ops:[null]`, missing `taps`) that later crashed
hit-testing instead of rejecting the scene. On the Android side, the
hold timer only canceled on VERTICAL slop: a finger wandering
horizontally past slop still fired the hold at the DOWN point.

## Required outcome

- `hitTestTaps`/`PreviewRenderer.hitTest` accept a gesture filter;
  hosts pass `"tap"` on click and `"long-press"` on hold; omitted keeps
  the legacy scan (golden tests unchanged).
- All three browser surfaces (generic contract host, gallery shell,
  showcase shell) arm a hold timer on pointerdown, cancel on
  slop/release/cancel, suppress the tap when the hold fired, and
  dispatch by the region's PAYLOAD ID.
- `sceneContractError` requires a `taps` array and rejects non-object
  ops entries as violations; the Android slop check becomes
  axis-agnostic.

## References

- `examples/gallery-preview/renderer.ts`, `host.ts`, `preview.ts`
- `examples/flutter-showcase-preview/preview.ts`
- `embedders/android/app/src/main/kotlin/id/my/tenun/embedder/TenunSurfaceView.kt`
- `examples/gallery-preview/test/renderer.test.ts` (TN-152 describes)

## Status note (2026-10-25, closed)

Closed via PR #231: gesture-filtered hit tests + hold timers landed in
all three browser surfaces with payload-id dispatch; the validator
rejects the two malformed shapes; the Android slop check is
axis-agnostic (the previously dead `touchDownX` now earns its keep).
Renderer tests pin filtered resolution both ways, hold-only invisibility
to taps, and both malformed-shape rejections. Physical-input evidence
(pointer hold in a real browser) is the TN-146 shell-UX track's to
capture; the contract-level proof is headless and in CI.

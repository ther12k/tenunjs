---
okf_version: 0.2
title: "TN-148: Carry the long-press gesture through the display-list contract"
summary: "Launcher-shaped apps live on hold gestures (app options, rearrange); add a second hit-region gesture — long-press — to the scene protocol, the GestureDetector widget, the runtime verb set, and the Android host, additive to tap."
type: issue
status: closed
issue_id: "TN-148"
milestone: "M3"
priority: "P1"
depends_on:
  - "TN-133"
---

# TN-148 — Carry the long-press gesture through the display-list contract

## Metadata

| Field | Value |
|---|---|
| Milestone | M3 — Application model and navigation (runtime surface) |
| Priority | P1 |
| Dependencies | TN-133 (execution contract: layoutScreen run table, host-verb dispatch, handoff adapter) |
| Suggested size | One gesture PR (widgets + embedder + engine-loop leg) |
| Gate impact | Blocks launcher rearrange/options UX; first multi-gesture region in the scene |

## Purpose

The launcher feasibility review (2026-10-16, conversation record) found
the JS-visible touch vocabulary is tap-only: `GestureDetector.onTap`,
scene regions with `action:"tap"`, and the runtime's closed verb set
(`TAP`/`TENUN_RESTORE`/`__TENUN_EXPORT`). Launcher interaction lives on
long-press — app info, rearrange, wallpaper — and the mecha-launcher
reference's action ring is hold-triggered. Drag-to-scroll already
exists host-side only, which is correct (it never crosses the seam as
a gesture), but hold-to-act must.

## Design

Regions stay the wire unit. A `GestureDetector` with `onLongPress`
emits a SECOND region with the same frame and `action:"long-press"`,
sharing the tap-run table (index-aligned `payload.id`). Hosts choose
which region to dispatch by gesture, not hit-test order — so the two
regions never compete in the topmost-wins test. The Android host arms
a timer on ACTION_DOWN (`ViewConfiguration.getLongPressTimeout()`),
cancels on scroll-slop/release/cancel, and a fired long-press
suppresses that press's tap (the standard host rule the contract now
documents). `onTap` becomes optional on `GestureDetector` so a
hold-only affordance emits exactly one region.

Additive by construction: no opcode changes, no scene-version bump
(existing scenes carry only `"tap"` and keep their golden digests),
and the runtime verb set gains case-insensitive `LONG-PRESS` reusing
the `TAP_TARGET_UNKNOWN` failure for foreign ids.

## Required outcome

- `TapRegionAction` union (`"tap" | "long-press"`) on
  `SerializedTap`; `addTap` takes the action.
- `GestureDetector` grows `onLongPress?` (and `onTap` becomes
  optional) in `@tenunjs/widgets`.
- `ApplicationRuntime.dispatch` accepts `LONG-PRESS` from the shared
  run table; `installHostHandoff` commits after it like TAP.
- Android `TenunSurfaceView`: hold timer, suppression rule,
  action-filtered hit test; `ACTION_CANCEL` handled.
- Engine-loop gate: the counter bundle's value card gains a
  hold-to-reset region; the C harness extracts the region id from the
  committed scene (what the touch timer does) and proves the
  lowercase verb round-trips through real QuickJS.

## References

- [TN-133 — execution and scene-lowering contract](tn-133-own-public-application-execution-and-scene-lowering-contract.md)
- `packages/widgets/src/display-list.ts` (regions, addTap)
- `packages/widgets/src/app-runtime.ts` (verb set)
- `embedders/android/app/src/main/kotlin/id/my/tenun/embedder/TenunSurfaceView.kt` (touch timer)
- `embedders/android/src/test/cpp/test_engine_loop.c` (gate leg 5)

## Status note (2026-10-16, closed)

Closed via PR #229: region union + optional `onLongPress` landed in
`@tenunjs/widgets` (display-list, structural, runtime verb,
handoff commit rule, 8 new tests); the Android host arms/cancels the
hold timer with tap suppression; the counter sample's value card
holds to reset and the engine loop proves the region id → `long-press`
dispatch → reset → re-commit round trip in real QuickJS. Existing
golden scene digests unchanged (tap-only trees are byte-identical).

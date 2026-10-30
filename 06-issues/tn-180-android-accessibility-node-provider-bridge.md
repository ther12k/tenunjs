---
okf_version: 0.2
title: "TN-180: Android accessibility node provider bridge over scene.semantics"
summary: "TN-091 slice 1: TenunSurfaceView exposes scene.semantics as Android virtual accessibility nodes through an AccessibilityNodeProvider — ACTION_CLICK dispatches the same tap a finger does, focus syncs with stable ids, live regions announce explicitly."
type: issue
status: ready
issue_id: "TN-180"
milestone: "M5"
priority: "P1"
depends_on:
  - "TN-179"
---

# TN-180 — Android accessibility node provider bridge over scene.semantics

## Purpose

TN-179 put the semantics projection on the wire (ADR-0025); this slice
makes Android screen readers able to drive it. The Android host had no
accessibility surface at all: a raw SurfaceView reads as one opaque
focusable rectangle.

## Required outcome

1. `DisplayListScene` parses `scene.semantics` STRICTLY (a declared
   block with unknown version, missing/duplicate ids, unknown actions,
   or malformed bounds is a `SceneContractException` — the ops rule);
   pre-TN-179 scenes parse unchanged (null semantics).
2. `SemanticsBridgeState` (pure Kotlin, JVM-tested): stable virtual ids
   per semantic id across commits, retired ids never reused, commit
   diffing (content-changed vs live-region announcements, rate-limited
   to 2/commit), and accessibility-focus bookkeeping that survives id
   stability and clears when the focused node leaves the scene.
3. `TenunAccessibilityProvider`: framework node population (role →
   className, label/hint/value, focused/readOnly/disabled state,
   bounds in parent/screen with scene scroll + region offsets applied),
   `performAction` where ACTION_CLICK/LONG_CLICK/FOCUS dispatch the
   ordinary "tap"/"long-press" through the view's single dispatch path,
   and accessibility-focus queries.
4. `TenunSurfaceView` exposes the provider, resets the bridge on engine
   swaps (ids belong to the emitting engine), and advances it on every
   applied commit with diff events.

## Verification

- JVM: `SceneAccessibilityBridgeTest` (6 tests) — strict parsing,
  absent-block tolerance, id stability/retirement, diff/announcement
  decisions, rate limiting, focus lifecycle.
- Device: `EngineAccessibilityProviderTest` — real framework nodes from
  a production engine's committed scenes; ACTION_CLICK ≡ touch (count
  advances through the same dispatch); focus set/clear/find through the
  provider.
- Full run_android_test.sh, 8-gate CI.

## Out of scope

- TalkBack manual journeys on a physical phone (ADR-0019 evidence —
  TN-091 stays open until then).
- `ACTION_SET_TEXT` through accessibility (needs the revisioned TEXT_EDIT
  session contract; the IME path remains the editing route).
- RTL ordering (TN-068 context remainder).

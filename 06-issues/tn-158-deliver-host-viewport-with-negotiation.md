---
okf_version: 0.2
title: "TN-158: Deliver host viewport automatically with negotiation"
summary: "Second TN-155 slice: hosts deliver logical-unit viewport bounds automatically (browser canvas, Android surface), with one-probe negotiation so bundles without viewport support keep design-width scaling."
type: issue
status: closed
issue_id: "TN-158"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-157"
---

# TN-158 — Deliver host viewport automatically with negotiation

## Metadata

| Field | Value |
|---|---|
| Milestone | M4 — Core widgets, text input, scrolling, and animation (TN-155 umbrella slice) |
| Priority | P1 |
| Dependencies | TN-157 (bounded layout + runtime viewport API, closed) |
| Suggested size | One vertical slice: handoff verb + two host adapters + tests |
| Gate impact | Hosts stop being fixed-design-width consumers; TN-155's "correct nested layout under changing screen sizes" gains a real delivery path |

## Purpose

TN-157 delivered `ApplicationRuntime.setViewport()` but no host called it:
the browser generic host scaled the committed scene to its canvas, and the
Android `SurfaceView` scaled by `designWidth`. The framework-feel app
booted at fixed 720×1000 everywhere. This slice connects hosts to the
runtime API with a negotiated, logical-unit protocol so applications can
lay out under REAL surface bounds — and bundles that predate the protocol
keep working unchanged.

## Required outcome

1. **A VIEWPORT dispatch verb in the host handoff** (`packages/widgets`):
   routes to `app.setViewport` when the application exposes it; the
   resized scene commits through the existing invalidation channel;
   unsupported applications answer `UNKNOWN_ACTION`; malformed payloads
   fail visibly as `INVALID_VIEWPORT`.
2. **Browser delivery** (`examples/gallery-preview/host.ts`): the generic
   host probes once after bundle boot with the canvas's CSS-pixel bounds
   and re-delivers on window resize; unsupported bundles are never asked
   again and keep scaled-scene behavior.
3. **Android delivery** (`TenunSurfaceView.kt`): surface changes deliver
   density-independent logical bounds; adoption converges the design-to-
   pixel scale to the display density; support is re-negotiated after an
   engine swap (OTA/hot reload) because it belongs to the bundle; legacy
   bundles (reference notes app) answer NULL across JNI and are skipped.
4. **Application-level proof**: Day Plan adopts host bounds mid-journey —
   resize, act, resize again — retaining route and controller state, with
   live taps rebuilt against the new geometry.

## Non-goals

- No scene-wire version change, no new scene fields, no package-dependency
  changes (negotiation is behavioral: UNKNOWN_ACTION / NULL result).
- No changes to `MainActivity`, the BLE service, or other files carrying
  concurrent work-in-progress in the shared checkout.
- Physical-device rendering and resize evidence remain TN-155's journey
  evidence; this slice proves the protocol and adapters through tests,
  the generic browser host, and the existing CI device gate (legacy path
  unaffected).

## Verification

- `packages/widgets` handoff tests: VIEWPORT adoption, repeat delivery,
  identical-dimension no-op, UNKNOWN_ACTION negotiation, INVALID_VIEWPORT
  visibility.
- `examples/framework-feel` journey tests: mid-journey resize with state
  retention and rebuilt taps; snapshots carry no viewport.
- Full `bun test` + `bun run typecheck` + `verify-manifest.py`.
- `run_android_test.sh`: Kotlin compiles (SurfaceView change), all engine
  loops (notes/counter/Polytron/framework-feel parity) still pass —
  proving the legacy path is untouched.

## References

- [Finite viewports and framework re-layout](../04-api/widgets-and-styling.md)
- [Automatic host viewport delivery](../04-api/widgets-and-styling.md)
- TN-157 (bounded layout foundation, closed)
- TN-155 (framework-feel milestone app, in progress)

## Status note (2026-10-29, closed)

Closed with PR #244 (merge 196d6de), implemented and published in the
same session: handoff VIEWPORT verb, generic-browser-host delivery with
one-probe negotiation, Android SurfaceView delivery in density-
independent units with engine-swap re-negotiation, and the Day Plan
mid-journey resize tests. Verified locally (513/0 tests, typecheck,
manifest, full run_android_test.sh with the framework-feel parity) and
by CI — all eight jobs green on the PR and on main, including the
installed-device gate exercising the legacy-bundle negotiation path.
TN-155 continues with editable text/IME, independent scrolling,
host-evaluated transitions, TN-068 theme integration, and the device
journey.

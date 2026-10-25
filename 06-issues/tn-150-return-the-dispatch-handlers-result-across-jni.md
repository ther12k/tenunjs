---
okf_version: 0.2
title: "TN-150: Return the dispatch handler's result across the JNI boundary"
summary: "The native dispatch API returned the committed scene for every verb, so __TENUN_EXPORT and __TENUN_STATE_SCHEMA replies never reached Kotlin — state carry across OTA/hot-reload swaps silently degraded to a clean restart."
type: issue
status: closed
issue_id: "TN-150"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-029"
---

# TN-150 — Return the dispatch handler's result across the JNI boundary

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P1 |
| Dependencies | TN-029 (load and execute a verified bundle on Android) |
| Suggested size | One native PR (bridge + JNI + engine-loop legs) |
| Gate impact | OTA/hot-reload state carry; the 2026-10-25 review's #1 finding |

## Purpose

Found by the 2026-10-25 framework review (reproduced against the real
TSX counter bundle in vendored QuickJS). The public handoff contract
returns data for some verbs — `__TENUN_EXPORT` returns the state
snapshot, `__TENUN_STATE_SCHEMA` the schema reply — but
`tenun_android_engine_dispatch` discarded the JS handler's return value
and returned `strdup(current_scene)` for every verb. `MainActivity`'s
OTA apply and hot-reload paths parse that reply for `stateSchema`, read
`-1`, and skip `TENUN_RESTORE`: the documented schema-gated state carry
never executed once on device, even between same-schema bundles. (The
TN-144 gate had already noted "__TENUN_EXPORT is unusable at that
boundary"; this issue closes the gap instead of living with it.)

## Required outcome

- A second native entry point returns the handler's STRING reply
  (NULL for no handler / thrown handler / non-string return); the
  scene-returning dispatch stays unchanged for the touch paths that
  consume committed scenes.
- Kotlin `TenunEngine` exposes the result channel; MainActivity's
  export/schema queries use it, keeping the scene channel for
  everything else.
- Engine-loop legs prove: the real TSX bundle's `__TENUN_EXPORT`
  reply carries `states` + `stateSchema`, the schema reply parses, a
  non-string return yields NULL, and legacy dispatch still returns the
  committed scene.

## References

- `embedders/android/app/src/main/cpp/tenun_android_bridge.c`
- `embedders/android/app/src/main/kotlin/id/my/tenun/embedder/TenunEngine.kt`
- `embedders/android/app/src/main/kotlin/id/my/tenun/embedder/MainActivity.kt`
- `embedders/android/src/test/cpp/test_engine_loop.c` (section 14 + TSX leg 6)

## Status note (2026-10-25, closed)

Closed via PR #231: `tenun_android_engine_dispatch_result` (C API + JNI
`nativeDispatchActionResult`) shares one handler-run body with legacy
dispatch and returns the handler's string reply; both entry points drain
pending jobs (TN-151). MainActivity's two state-carry blocks query the
result channel. Engine-loop sections 13/14 plus the TSX leg prove the
channel against the real handoff bundle; device-level OTA-journey
evidence (state carried across a real swap) remains with the existing
androidTest suite's next run, recorded here as the honest boundary.

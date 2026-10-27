---
okf_version: 0.2
title: "TN-154: Native Polytron Wash milestone validation app on Android"
summary: "Run Polytron Wash 100% natively on Android with QuickJS, JNI Host Service Bridge for Bluetooth LE, SurfaceView Skia-backed Canvas rendering, in-scene bottom navigation, and native MotionEvent touch hit-testing."
type: issue
status: closed
issue_id: "TN-154"
milestone: "M1"
priority: "P0"
depends_on:
  - "TN-132"
  - "TN-141"
  - "TN-150"
  - "TN-151"
---

# TN-154 — Native Polytron Wash milestone validation app on Android

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P0 |
| Dependencies | TN-132 (installed Android execution), TN-141 (capability seam contracts), TN-150 (JNI dispatch results), TN-151 (QuickJS job drain) |
| Suggested size | Full Android native capability + validation suite |
| Gate impact | First real-world native companion app running 100% native on Android without WebView |

## Purpose

Polytron Wash (`examples/polytron`) was initially prototyped on Android
via an embedded WebView container. This issue promotes Polytron Wash to the
official milestone validation app for 100% native TenunJS execution on Android:
no WebView, no HTML DOM, running directly in QuickJS with Android SurfaceView
hardware canvas rendering, JNI Host Service Bridge for Bluetooth Low Energy,
and native MotionEvent hit-testing.

## Required outcome

- **JNI Host Service Bridge:** C bridge and JNI export
  `tenun_android_engine_set_host_call_handler` & `nativeSetHostCallHandler`
  exposing `globalThis.tenun_host_call(service, method, payloadJson)` to
  JavaScript, wired to Kotlin `HostServiceRegistry`.
- **Native BLE Service:** `PolytronBleService` implements the GATT client
  for the washer's v4 protocol (`9f6d1c30-...`), handles `connect`, `disconnect`,
  and serialized command writes, and pushes status lines (`BLE_LINE`) and link
  changes (`BLE_LINK`) into the QuickJS engine.
- **Rendering & DisplayList Parity:** `TenunSurfaceView` paints the complete
  `DisplayOp` vocabulary (`rect`, `outline`, `circle`, `ring` progress arcs,
  `line`, `text` with alignment and weight).
- **Navigation Chrome:** Native in-scene bottom navigation bar (`Beranda`,
  `Program`, `Kontrol`, `Setelan`) with fixed bottom anchoring and touch regions.
- **Packaging & CI Gate:** `buildPolytronBundle` and `run_polytron_bundle_checks`
  integrated into `run_android_test.sh` (tested in real QuickJS under `verify:android`).

## References

- `embedders/android/app/src/main/cpp/tenun_android_bridge.c` & `.h`
- `embedders/android/app/src/main/kotlin/id/my/tenun/embedder/HostServiceRegistry.kt`
- `embedders/android/app/src/main/kotlin/id/my/tenun/embedder/PolytronBleService.kt`
- `embedders/android/app/src/main/kotlin/id/my/tenun/embedder/TenunSurfaceView.kt`
- `embedders/android/tools/gallery-bundle/polytron-entry.ts`
- `embedders/android/src/test/cpp/test_engine_loop.c` (section 16 + Polytron suite)

## Status note (2026-10-27, closed)

Closed via PR #233: JNI Host Service Bridge (`tenun_host_call`) implemented
with C callback and Android JNI dispatcher; `HostServiceRegistry` and
`PolytronBleService` wired in `MainActivity`; `TenunSurfaceView` text
alignment and custom shader rendering verified; `polytron-entry.ts` bundles
native in-scene bottom navigation tabs; `test_engine_loop` exercises
native C BLE write, live washer notifications, and tab navigation;
`run_android_test.sh` executes the native Polytron bundle checks in real
QuickJS as a continuous gate.

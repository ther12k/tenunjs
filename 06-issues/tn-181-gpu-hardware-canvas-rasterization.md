---
okf_version: 0.2
title: "TN-181: GPU rasterization — draw through Android's hardware canvas"
summary: "Every frame rasterized on the CPU because both draw paths locked the SOFTWARE canvas. lockHardwareCanvas() hands the surface to Android's hardware-accelerated Skia GL backend — same paint ops, GPU raster, unconditional software fallback where no GPU backend exists."
type: issue
status: ready
issue_id: "TN-181"
milestone: "M4"
priority: "P1"
depends_on: []
---

# TN-181 — GPU rasterization: draw through Android's hardware canvas

## Purpose

The 2026-10-30 Skia review confirmed both draw paths in
`TenunSurfaceView` (the commit redraw and the TN-169 transition frames)
lock the SOFTWARE canvas: every rect/text/ring/gradient rasterizes on
the CPU at every frame, regardless of the device's GPU. This is the
single biggest rendering bottleneck in the Android host today and the
first stage of the Skia adoption track (ADR-0026).

## Required outcome

1. Both draw paths draw through `lockHardwareCanvas()` (API 23+;
   minSdk 26) — Android's hardware-accelerated Skia GL backend.
2. Every paint op this host uses — `drawRect`/`drawRoundRect`/`drawText`/
   `LinearGradient` shaders/`saveLayerAlpha`/clips — is
   hardware-supported; output stays pixel-compatible, so the entire
   existing device journey suite (framework-feel journey, transitions,
   IME, overlay) is the visual-parity evidence.
3. Unconditional software fallback (`IllegalStateException` and broader
   `RuntimeException` — no GPU backend on some emulators/headless
   configs): behavior identical to today where hardware is absent.
   `unlockCanvasAndPost` posts either kind.

## Verification

- Full `run_android_test.sh` including the KVM emulator device gate
  (15+ instrumentation tests across journeys/transitions/IME/accessibility).
- 8-gate CI.

## Out of scope

- The framework-owned Skia renderer (`skia-safe`) — TN-182, its own
  slice with its own evidence.
- A dedicated GPU render thread; frame-pacing work.

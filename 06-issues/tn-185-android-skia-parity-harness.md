---
okf_version: 0.2
title: "TN-185: Android skia-host parity harness — the cdylib on the device gate"
summary: "ADR-0026 stage 3, first slice: libtenun_skia_host.so cross-builds into the APK (arm64-v8a/x86_64, prebuilt rust-skia bindings), a dlopen shim bridges the C ABI, the device gate dual-renders every probe scene through BOTH painters with shared anchor classifiers, injects the device Roboto pair through a new set-typefaces ABI, and logs Canvas-vs-skia-host per-frame timings — the measurement path ADR-0019 requires before any production-surface switch."
type: issue
status: closed
issue_id: "TN-185"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-184"
---

# TN-185 — Android skia-host parity harness

## Purpose

ADR-0026 stage 3 is gated on measured parity and performance evidence
from the framework-owned renderer against the platform painter on the
device gate (ADR-0019: physical-device numbers before the production
surface switches). Stage 2 proved the renderer against its own tests
and real scene JSON on the desktop — nothing on a device could call it.
This slice builds the EVIDENCE path; the production paint surface stays
the platform Canvas until the measurement says otherwise.

## Required outcome

1. **Cross-build**: `tools/skia-host/build-android.sh` produces
   `libtenun_skia_host.so` into `app/src/main/jniLibs/<abi>` via
   cargo-ndk (rust-skia ships prebuilt Android bindings — seconds, not
   a from-source Skia build). The cdylib is git-ignored; CI builds it
   fresh (rust toolchain + cargo-ndk added to the device job).
2. **Bridge**: the existing `libtenun_android` dlopen()s the cdylib in
   the app's linker namespace (`System.loadLibrary` is RTLD_LOCAL, so
   `dlsym(RTLD_DEFAULT)` cannot see the exports) and forwards three C
   calls. Absent library ⇒ `-100` and `SkiaHostBridge.available == false`
   — fail-visible, never a silent fallback. The production painter is
   untouched.
3. **Typeface injection**: Android has no fontconfig default inside the
   app process, so a new C ABI `tenun_skia_host_set_typefaces` accepts
   the host's TTF pair; BOTH fonts validate before either is stored
   (generation bump invalidates per-thread caches). Desktop keeps the
   fontconfig fallback when nothing is injected.
4. **Device parity test** (`SkiaHostParityTest`, device gate): 12 probe
   scenes — solid/rounded rect, outline, gradient, circle, full/half
   ring, line, #aarrggbb blend, scroll-region clipping, fixed bottom
   overlay, bold text ink, zero-extent text clip — render through BOTH
   painters (`renderDisplayListForTest` on a Bitmap canvas vs
   `SkiaHostBridge.renderScene`), with shared color-classifier anchors
   and ink-band bounds asserting the SAME classification in both
   outputs. The view is sized to designWidth so design units are device
   pixels.
5. **Timing evidence**: a rich scene (60 rects + 12 texts) timed over
   30 iterations per painter, logged per frame — the stage-1-vs-stage-2
   record ADR-0026 requires, with only a pathological-regression bound
   (100 ms) asserted.

## Verification

- `cargo test` 21 tests incl. injected-typeface validation + rendering.
- Local: `:app:compileDebugKotlin`, `:app:compileDebugAndroidTestKotlin`,
  `:app:testDebugUnitTest`, `:offline-ble:compileKotlin`+test all green.
- 8/8 CI gates: the device job now installs rust + cargo-ndk, runs the
  cross-build before assembly, and the parity suite runs inside
  `connectedDebugAndroidTest` on the KVM emulator.

## Out of scope

- The production-surface switch (Android draws through skia-host every
  frame) — gated on the measured parity this harness produces, per
  ADR-0019 physical-device evidence.
- GPU-backed Skia surfaces and a dedicated Skia render thread (later
  stage-3 slices; this path is CPU raster into a buffer).
- Elevation shadows (TN-160/ADR-0026 stage 3 image filters).

## Status note (2026-10-31, closed)

Implemented in PR #268: the cdylib cross-builds for both ABIs in
seconds (prebuilt rust-skia bindings), the dlopen shim forwards the C
ABI with fail-visible absence, typeface injection validates whole, and
the device gate dual-renders 12 probe scenes through both painters with
shared anchors plus per-frame timing evidence. 8/8 CI gates on the PR
head. The production surface remains the platform Canvas pending the
measured-parity record this harness now produces.

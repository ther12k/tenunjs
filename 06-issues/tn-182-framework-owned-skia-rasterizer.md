---
okf_version: 0.2
title: "TN-182: Framework-owned Skia rasterizer for display-list scenes"
summary: "engine/render/skia-host paints the exact display-list wire contract through skia-safe — every op kind pixel-tested in cargo test, fail-visible validation, and a C ABI for the future Android surface. ADR-0026 stage 2."
type: issue
status: closed
issue_id: "TN-182"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-181"
---

# TN-182 — Framework-owned Skia rasterizer for display-list scenes

## Purpose

The framework's rendering contract (the display-list scene) was painted
only by platform hosts: browser Canvas and Android Canvas. No
framework-owned Skia code existed — the "Skia is the mandatory v0.x
renderer" product decision had no implementation. ADR-0026 stage 2
closes that: the framework itself owns a Skia painter of its own
contract.

## Required outcome

1. `engine/render/skia-host` (Rust, `skia-safe`, production tree — not
   a spike): renders display-list scenes v1 into RGBA8 — rect (fill,
   radius, gradient via `colorTo`), outline, text (baseline `y`, weight
   → font), circle, ring (track + progress arc swept from 12 o'clock
   clockwise), line, gradient, scroll-region (viewport clip + content
   space), text-input accepted-but-unpainted (the hosts' rule).
2. The same semantics the other hosts honor: designWidth → surface
   scaling (`dlScale`), fail-visible validation (unknown op kinds,
   non-`#rrggbb` colors, wrong scene version → errors, never partial
   frames).
3. C ABI `tenun_skia_render_scene` for the stage-3 Android surface;
   buffer-length and JSON failures fail closed.
4. CI: `cargo fmt`/`clippy -D warnings`/`cargo test` in `verify-rust`.

## Verification

- 12 pixel-level tests (see ADR-0026): geometry per op kind, scroll
  clipping, malformed-scene rejection, designWidth scaling, C ABI
  round-trip.
- Full 8-gate CI with the crate in the rust gate.

## Out of scope

- The Android JNI surface + GPU-backed Skia surfaces + render thread
  (ADR-0026 stage 3, needs measured stage-2 parity on the device gate).
- Elevation shadows (Skia image filters at stage 3).
- A pinned framework font / CJK coverage (TN-160 decision at stage 3).

## Status note (2026-10-30, closed)

Implemented and published in one session. Fixed in PR #265 (with the CI
link-deps follow-up): engine/render/skia-host paints the display-list
wire contract through skia-safe — every op kind pixel-tested (12 cargo
tests incl. ring progress sweep, scroll clipping, designWidth scaling,
C ABI round-trip with fail-closed buffer checks), fail-visible
validation, no dynamic freetype/fontconfig on dev machines (CI installs
the dev libs where skia-bindings builds from source). Wired into the
verify-rust CI gate; 8/8 green. Stage 3 (Android JNI surface + GPU Skia
surfaces + render thread) is gated on measured stage-2 parity per
ADR-0019.

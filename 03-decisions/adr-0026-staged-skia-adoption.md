---
okf_version: 0.2
title: "ADR-0026: Staged Skia adoption — from the platform GPU backend to a framework-owned renderer"
summary: "Skia arrives in three evidence-gated stages: the Android hardware canvas now (GPU raster, zero new deps), the framework-owned skia-safe rasterizer of the display-list contract next (CPU raster + C ABI), and the on-device Skia surface + render thread after measured parity."
type: decision
status: accepted
---

# ADR-0026: Staged Skia adoption

## Context

The product decision names Skia the mandatory renderer for the v0.x
mobile architecture, but the Android host rasterized every frame on the
CPU through the software canvas, and no framework-owned Skia code
existed. "Adopt Skia" is not one change: it spans which backend draws
today's frames, who owns the rasterizer, and when GPU surfaces are
warranted — each with different risk and evidence needs.

## Decision

Three stages, each independently shippable and evidence-gated:

1. **GPU rasterization via the platform backend (TN-181, shipped).**
   Draw through `lockHardwareCanvas()` — Android's hardware-accelerated
   Skia GL backend — with the software canvas as the unconditional
   fallback. No new dependencies; every paint op stays pixel-compatible,
   so the device journey suite is the parity evidence. This removes the
   CPU-raster bottleneck today without pretending the framework owns the
   rasterizer.
2. **Framework-owned Skia rasterizer of the display-list contract
   (TN-182).** `engine/render/skia-host` (Rust, `skia-safe`) paints the
   EXACT scene wire contract — op set, design-unit coordinates,
   `Text.y`-baseline, scroll-region content space, fail-visible
   validation — CPU-rasterized into RGBA8 with a C ABI entry
   (`tenun_skia_render_scene`). Pixel-level tests prove each op kind in
   `cargo test`, wired into the `verify-rust` CI gate. Known gap:
   elevation shadows are not painted yet (Skia image filters arrive with
   stage 3). This makes the framework OWN a real Skia painter of its
   contract without yet betting the production surface on it.
3. **On-device Skia surface + render thread (later, evidence-gated).**
   The C ABI is consumed from Android (JNI surface, GPU-backed Skia
   surfaces, a dedicated render thread with the animation thread's
   paint-lock discipline). Entering this stage requires measured parity
   and performance evidence from stage 2 against stage 1 on the device
   gate — physical-device numbers per ADR-0019 before the production
   surface switches.

## Consequences

- The scene wire contract stays the single rendering contract; hosts
  (browser Canvas, Android Canvas, Skia) remain interchangeable
  painters of it — TN-157-style structural parity extends naturally.
- `engine/` opens as the framework-owned engine tree (outside `spikes/`
  so governed evidence digests are untouched).
- Stage 2's crate is deliberately NOT under `spikes/`: it is production
  code with CI gates, not selection evidence; the M0 selection gates
  (ADR-0005/0007/0008) remain untouched by this ADR.
- Text rendering uses the platform's default typeface for now; a pinned
  framework font (licensing, CJK coverage — TN-160) is a separate
  decision at stage 3.

## Verification

- Stage 1: 8/8 CI incl. device gate on the hardware canvas (PR #264).
- Stage 2: 12 pixel-level `cargo test`s in `engine/render/skia-host`
  (background fill, rect/radius, outline stroke-vs-fill, gradient stops,
  circle/ring geometry incl. progress sweep from 12 o'clock, line, text
  glyph coverage, scroll-region clipping, text-input no-paint acceptance,
  malformed-scene rejection, designWidth scaling, C ABI round-trip with
  fail-closed buffer checks), running in `verify-rust`.

## Revisit trigger

Stage 3 entry, or measured evidence that the platform GPU backend
cannot meet the frame budget on target hardware.

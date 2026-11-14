---
okf_version: 0.2
title: "TN-198: Raster throughput benchmark — skia-host frame-time baseline"
summary: "No frame-time evidence exists anywhere in the repo: the Skia adoption track (ADR-0026) and any future rasterization decision gate on a measured per-frame cost for a realistic scene, not on intuition. A notch-scale 760x560 scene (the fixed surface of the lekuvo desktop pilot candidate) rasterizes end-to-end through tenun-skia-host; p50/p95/p99 per frame are recorded through the shared evidence harness as the CPU-raster baseline."
type: issue
status: ready
issue_id: "TN-198"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-184"
---

# TN-198 — Raster throughput benchmark: skia-host frame-time baseline

## Purpose

Every rasterization decision so far was made without a single measured
frame time: ADR-0026 staged Skia adoption by contract reasoning alone,
TN-181 moved the Android host to the hardware canvas on a qualitative
bottleneck claim, and the desktop-pilot question (whether CPU raster is
sufficient for a fixed 760x560 surface without a GPU backend) has no
evidence either way. This issue closes the measurement gap at the
framework level: one reproducible harness, one committed evidence
packet, one baseline number every later rasterization decision cites.

The scene is notch-scale on purpose: 760x560 fixed pixels is the lekuvo
desktop pilot candidate's surface, and it is also a realistic
mid-complexity scene (card + shadow-decorated pill, vinyl rings, 24-bar
EQ, transport glyphs, three text labels, one fixed-overlay status line —
~55 ops, solid colors only). Per-frame cost here is the worst case a
host pays when it repaints the whole scene per commit, which is how
every current host works.

## Required outcome

1. `engine/render/skia-host/examples/raster-bench.rs` — measures
   `render_scene` end-to-end (scene JSON parse + paint + premul RGBA
   readback, the exact per-commit cost a host pays), warmup excluded,
   p50/p95/p99/mean/min/max in ms per frame, machine packet on stdout.
2. `benchmarks/raster/notch-scene.json` — the notch-scale scene
   fixture (display-list v1, 760x560, designWidth 760, solid colors).
3. Evidence through the shared harness
   (`benchmarks/architecture/run.ts`): committed packet with source
   commit, host, tools, and reproducibility commands; narrative and
   interpretation in `08-validation/`.
4. The baseline is cited by name in ADR-0026's stage-3 planning notes
   (shadow painting adds image-filter cost on top of this number) and
   by the desktop-pilot ADR (kill criterion: notch-scale p95 must fit
   the pilot's frame budget on target hardware).

## Non-goals

- TS-side costs (scene build, reconciliation, layout) are out of scope:
  this measures the painter only.
- GPU paths (TN-181's hardware canvas, future skia-host GPU backends)
  are separate measurements; this is the CPU baseline they compare
  against.
- The `shadow` field is accepted-but-unpainted at stage 2, so the
  baseline excludes image-filter cost by construction — noted in the
  evidence doc, priced when stage 3 lands.
- No desktop platform claims live in this issue; the scene size is
  motivated by the pilot candidate but the measurement is
  painter-internal and platform-neutral.

---
okf_version: 0.2
title: "Skia raster baseline — notch-scale CPU frame time (TN-198)"
summary: "First frame-time evidence in the repo: tenun-skia-host rasterizes a 760x560 notch-scale display-list scene end-to-end in p50 1.2ms / p95 1.5ms / p99 1.7ms on CPU (i5-13420H, skia-safe 0.87) — an order of magnitude inside a 60 Hz frame budget. This number is the baseline ADR-0026 stage-3 planning (shadow image-filter cost) and the desktop-pilot ADR (kill criterion) cite."
type: evidence
status: accepted
evidence_for: "TN-198"
packet: "benchmarks/architecture/evidence/skia-raster-bench-v1/skia-raster-bench-v1.evidence.json"
---

# Skia raster baseline — notch-scale CPU frame time (TN-198)

## Question

Every rasterization decision so far was made without a measured frame
time: ADR-0026 staged Skia adoption by contract reasoning, TN-181
moved the Android host to the hardware canvas on a qualitative
bottleneck claim, and the desktop-pilot question — is CPU raster
sufficient for a fixed 760×560 surface, no GPU backend — had no
evidence either way. This baseline answers the CPU half.

## Method

`engine/render/skia-host/examples/raster-bench.rs` calls
`render_scene(scene_json, 760, 560)` in a loop: display-list JSON
parse + paint + premul RGBA8 readback, the exact work a host pays per
scene commit (the future C-ABI present path skips the readback; the
parse stays until hosts cache parsed scenes — both notes below). 60
warmup frames excluded, 600 measured, `std::time::Instant` walls.

Scene: `benchmarks/raster/notch-scene.json` — display-list v1,
designWidth 760 (scale 1.0), ~55 solid-color ops: shadow-carrying card
and pill (shadow accepted-but-unpainted at stage 2), vinyl circle +
groove rings + progress ring, accent blob, 24-bar EQ (worst-case op
count), transport glyphs, three `text` ops through the default-font
path, one `fixed`+`anchor: bottom` status line (two-pass paint path),
panel outline. Pixel parity against the other painters is TN-184's
contract, not re-verified here.

Packet recorded from a clean detached worktree at 79b0e20
(`TENUN_EVIDENCE_OUT` replay, the TN-172 pattern): `dirty: false`,
changed files 0.

## Result

| Metric | ms/frame | Budget share (16.7 ms / 60 Hz) |
| --- | --- | --- |
| p50 | 1.215 | 7.3% |
| p95 | 1.536 | 9.2% |
| p99 | 1.704 | 10.2% |
| mean | 1.223 | 7.3% |
| max | 2.407 | 14.4% |

Host: 13th Gen Intel Core i5-13420H, Linux 6.8.0, rustc 1.99.1,
skia-safe 0.87 (CPU raster_n32_premul, no GPU backend).

Run-to-run spread is real on this machine: a second 600-frame run on
the same tree (dirty, recorded pre-commit) measured p50 1.746 /
p95 3.024 / p99 3.277 — same order of magnitude, ~40% higher tails
(laptop turbo/thermal noise). Threshold claims should therefore cite
p99, not p50, and leave ≥5× margin.

## Interpretation

1. **CPU raster at notch scale is not a bottleneck.** p95 1.54 ms is
   10.9× inside a 60 Hz budget and 5.4× inside 120 Hz; the observed
   max (2.41 ms) is 6.9× inside 60 Hz. The desktop-pilot question
   ("does lekuvo need a GPU path day one?") is answered no on this
   class of hardware — with the caveat that target hardware for the
   pilot is whatever machine runs lekuvo-host, and this baseline is a
   laptop CPU, not that machine. The pilot ADR should re-run this
   bench on target hardware as its evidence step; the harness makes
   that a one-command replay.
2. **ADR-0026 stage 3 gets a priced envelope.** Shadow painting
   (Skia image filters) lands on top of this baseline; the gap between
   p99 1.70 ms and the 16.7 ms budget (~14.9 ms) is the filter budget.
   Card+pill shadows at these radii are single-figure-ms territory on
   CPU by the same order-of-magnitude argument, but the stage-3 PR
   must re-run the bench with `shadow` actually painted and record the
   delta — that re-measured packet, not this one, is stage 3's
   evidence.
3. **TN-181's GPU claim gets its comparator.** The Android host moved
   to `lockHardwareCanvas()` on a qualitative claim; this packet is
   the CPU number that decision and any future "do we need GPU on
   desktop" debate cite.

## Limitations (recorded, not hidden)

- Painter-only: TS-side scene build, reconciliation, and relayout
  (the pill-morph per-frame relayout case, TN-087) are out of scope
  and priced separately.
- `render_scene` parses the scene JSON every call; hosts that cache
  parsed scenes pay less. Measured as-is: the parse is part of the
  per-commit cost until a host-side cache exists (a desktop-embedder
  design choice, not this issue's).
- Readback (`read_pixels`) is included because the current Rust API
  copies out; a C-ABI surface-pointer present path would cut it.
- Solid colors only (lekuvo's palette); gradients would add shader
  cost this baseline does not carry.
- `mem_total_bytes` in the packet is null (prober returned nothing) —
  recorded as not-found per harness rules.

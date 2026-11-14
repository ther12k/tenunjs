# Raster throughput benchmark (TN-198)

Measures `tenun-skia-host`'s per-frame cost end-to-end — display-list
JSON parse + paint + premul RGBA8 readback, the exact work a host pays
per scene commit — over a notch-scale scene. This is the CPU-raster
baseline that ADR-0026 stage-3 planning (shadow painting adds
image-filter cost) and the desktop-pilot ADR (kill criterion: notch
p95 must fit the frame budget) cite by name.

## Usage

```sh
bun run benchmarks/architecture/run.ts --label skia-raster-bench-v1 \
  --step skia-cpu-raster \
  "cargo run --release --manifest-path engine/render/skia-host/Cargo.toml \
   --example raster-bench -- --scene benchmarks/raster/notch-scene.json \
   --width 760 --height 560 --frames 600 --warmup 60" \
  --artifact benchmarks/raster/notch-scene.json
```

The packet lands in `benchmarks/architecture/evidence/<label>/` — the
shared evidence envelope, per that harness's rules.

## Scene fixture

`notch-scene.json` — display-list v1, 760×560 device pixels,
`designWidth: 760` (scale 1.0), ~55 ops, solid colors only:

- album card + artwork bands (rounded rects, `shadow` carried but
  unpainted at stage 2 — the baseline therefore excludes image-filter
  cost by construction),
- vinyl (circle + groove rings + progress ring with track),
- accent blob (two solid circles standing in for the future feather),
- the morphing pill at full width + a 24-bar EQ (worst-case op count),
- transport glyphs (circles + small rects, no glyph text),
- three `text` ops through the default-font path,
- one `fixed`+`anchor: bottom` status line (two-pass paint path),
- panel `outline`.

Relayout/reconciliation costs are TS-side and deliberately out of
scope; this number is the painter only. Regenerating the packet on a
different machine or commit produces a comparable-but-not-identical
distribution — record machine specs from the packet header when
citing the baseline.

#!/usr/bin/env sh
# Trusted cold-replay chain for skia-raster-bench-v1 (never taken from packets).
set -eu

# Warm the skia-host build so the recorded step measures the bench, not the
# first compile (durations are never compared; step exit codes, names,
# commands, and the artifact manifest are).
cargo build --release --manifest-path engine/render/skia-host/Cargo.toml

bun run benchmarks/architecture/run.ts --label skia-raster-bench-v1 \
  --step skia-cpu-raster "cargo run --release --manifest-path engine/render/skia-host/Cargo.toml --example raster-bench -- --scene benchmarks/raster/notch-scene.json --width 760 --height 560 --frames 600 --warmup 60" \
  --artifact benchmarks/raster/notch-scene.json

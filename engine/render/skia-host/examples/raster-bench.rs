//! TN-198 raster throughput benchmark: measures `render_scene` end-to-end
//! frame cost (scene JSON parse + paint + premul RGBA readback — exactly
//! what a host pays per commit) over a notch-scale scene, reporting
//! p50/p95/p99 wall-clock per frame.
//!
//! Usage:
//!   cargo run --release --example raster-bench -- \
//!     --scene <scene.json> --width 760 --height 560 \
//!     [--frames 600] [--warmup 60]
//!
//! Machine packet (schema_version 1) on stdout, human summary on stderr —
//! the evidence harness captures both; the JSON line is the recorded value.

use std::fs;
use std::time::Instant;

use tenun_skia_host::render_scene;

fn arg_value(flag: &str) -> Option<String> {
    let argv: Vec<String> = std::env::args().collect();
    argv.iter()
        .position(|a| a == flag)
        .and_then(|i| argv.get(i + 1))
        .cloned()
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    let idx = ((q / 100.0) * sorted.len() as f64).ceil() as usize;
    sorted[(idx.max(1) - 1).min(sorted.len() - 1)]
}

fn main() {
    let scene_path = arg_value("--scene").unwrap_or_else(|| {
        eprintln!("usage: raster-bench --scene <scene.json> --width W --height H [--frames N] [--warmup N]");
        std::process::exit(64);
    });
    let width: i32 = arg_value("--width")
        .map(|v| v.parse().expect("--width must be an integer"))
        .unwrap_or(760);
    let height: i32 = arg_value("--height")
        .map(|v| v.parse().expect("--height must be an integer"))
        .unwrap_or(560);
    let frames: usize = arg_value("--frames")
        .map(|v| v.parse().expect("--frames must be an integer"))
        .unwrap_or(600);
    let warmup: usize = arg_value("--warmup")
        .map(|v| v.parse().expect("--warmup must be an integer"))
        .unwrap_or(60);

    let scene_json =
        fs::read_to_string(&scene_path).unwrap_or_else(|e| panic!("read {}: {e}", scene_path));

    for _ in 0..warmup {
        render_scene(&scene_json, width, height)
            .unwrap_or_else(|e| panic!("warmup render failed: {e}"));
    }

    let mut samples: Vec<f64> = Vec::with_capacity(frames);
    for _ in 0..frames {
        let start = Instant::now();
        let pixels = render_scene(&scene_json, width, height)
            .unwrap_or_else(|e| panic!("render failed: {e}"));
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        debug_assert!(!pixels.is_empty());
        samples.push(elapsed);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).expect("no NaN durations"));

    let mean: f64 = samples.iter().sum::<f64>() / samples.len() as f64;
    let (p50, p95, p99) = (
        percentile(&samples, 50.0),
        percentile(&samples, 95.0),
        percentile(&samples, 99.0),
    );

    println!(
        "{}",
        serde_json::json!({
            "schema_version": 1,
            "bench": "skia-host-raster",
            "scene": scene_path,
            "surface_px": format!("{width}x{height}"),
            "frames": frames,
            "warmup": warmup,
            "unit": "ms_per_frame",
            "p50": (p50 * 1000.0).round() / 1000.0,
            "p95": (p95 * 1000.0).round() / 1000.0,
            "p99": (p99 * 1000.0).round() / 1000.0,
            "mean": (mean * 1000.0).round() / 1000.0,
            "min": (samples[0] * 1000.0).round() / 1000.0,
            "max": (samples[samples.len() - 1] * 1000.0).round() / 1000.0,
        })
    );
    eprintln!(
        "skia-host raster {width}x{height}: n={} p50={p50:.3}ms p95={p95:.3}ms p99={p99:.3}ms mean={mean:.3}ms max={:.3}ms",
        samples.len(),
        samples[samples.len() - 1],
    );
}

---
okf_version: 0.2
title: "TN-192: Companion latency harness — measured end-to-end event latency for the embedded runtime"
summary: "A measurement harness, not a numeric promise: instrument the tvremote vertical slice so one key press is timed from widget tap through the seam, protocol encode, socket write, and device echo, producing physical-device numbers per ADR-0019. The data decides whether interactive companion workloads fit the embedded-JS-runtime hypothesis or narrow it — the same discipline rendering already has."
type: issue
status: ready
issue_id: "TN-192"
priority: "P2"
depends_on:
  - "TN-188"
  - "TN-191"
---

# TN-192 — Companion latency harness

## Purpose

The falsification criteria ask whether the embedded JavaScript runtime's
costs erase the framework's advantage — answered for rendering with
frame pacing. Interactive companion apps add a second measurable: the
round trip from tap to bytes on the wire (and to a device-observed
effect). Today nothing measures the seam, so the class has no evidence
either way.

## Required outcome

1. Timestamps at four points per key event: widget press dispatched,
   capability call entered, `write()` resolved, device acknowledgement
   observed (the fake TV echoes; the physical set's state change is
   observed on the device gate).
2. A harness runner producing p50/p95/p99 and a per-segment breakdown
   (UI dispatch vs seam vs transport), writing a digest in the
   validation format of `08-validation/`.
3. Runs on both the preview shim (regression ceiling) and the physical
   device gate (the numbers that count, per ADR-0019/ADR-0022).

## Verification

- Harness itself is tested (synthetic delays produce expected
  percentiles); a first digest is recorded for tvremote on the device
  gate with environment noted (device, OS, Wi-Fi conditions).
- No threshold is declared passed or failed by this issue — it produces
  the evidence a later decision consumes.

## Out of scope

- Setting a latency budget (that is a decision issue that cites this
  harness's data), animation-frame measurement (exists), BLE latency
  (Polytron can adopt the harness later).

## Status note (2026-11-12, implemented — closing evidence gated on the hosted device run)

Implemented on `feat/tn-192-latency-harness`:

1. **Pure-TS harness (`examples/tvremote/src/latency.ts`)** — `LatencyRecorder` with the four timestamps (t0 widget press dispatched, t1 capability call entered, t2 `write()` resolved, t3 device acknowledgement observed), FIFO probe pairing (echoes return in write order over the serial transport; a frame with nothing pending is a no-op; unmatched probes stay visible via `pendingCount()`, never dropped), nearest-rank `percentile()`, `segmentsFor()` (uiDispatch/seam/transport/endToEnd), `summarizeLatencies()` digest (p50/p95/p99 per segment + min/max), `digestToJson()`. Injectable clock for deterministic tests; Date.now on-device (ms resolution). **No threshold is declared anywhere** — the module never compares against a budget.
2. **Runtime integration** — `TvRemoteRuntime.sendKey` instruments begin→capability→write-resolved when a `latency` recorder is injected; every incoming device frame completes the oldest pending probe (`handleRemoteFrame`). The preview fake TV now ECHOES key-inject frames back, so the browser preview produces real four-point samples (the regression ceiling).
3. **Headless tests (`examples/tvremote/test/latency.test.ts`, 8 tests)** — a hand-advanced clock proves synthetic delays produce EXACTLY the expected percentiles (20 events, transport 1..20 ms → p50=10, p95=19, p99=20; constant segments; endToEnd arithmetic), segment math, JSON digest stability, FIFO pairing, pending visibility, empty-recorder honesty, and two runtime-integration tests (single press + 25-press coalesced burst through the fake-TV echo).
4. **Device gate** — `tvremote_latency_fixture.js` compiles the PUBLIC TvRemoteRuntime + public net adapter (no facsimile); `TvRemoteLatencyTest` drives 100 key events through QuickJS → JNI → NetService → TCP → the runner-hosted byte-echo server (`tools/tn192_echo_server.mjs`, reachable at 10.0.2.2; plain TCP so the transport segment measures the socket round trip, not TLS), polls `pending → 0` (90 s), and asserts harness invariants only: 100/100 events complete, min ≤ p50 ≤ p95 ≤ p99 ≤ max, segments ≥ 0. The digest is printed as `TN192_LATENCY digest={...}` for the evidence packet. **The test deliberately asserts no latency threshold.**
5. **Digest recording** — the first digest is recorded in `08-validation/tvremote-latency-baseline.md` citing the CI run's printed numbers with environment noted; physical-set (MiTV-AXSO0) numbers remain future work per ADR-0019 (the physical journey stays a human hardware gate).

Evidence so far: typecheck clean across all six tsconfig projects (the fixture entry pulls the whole tvremote runtime into the gallery-bundle project); 861 bun tests pass; the isolated K2JVMCompiler rehearsal compiles the curated Kotlin set INCLUDING `TvRemoteLatencyTest` against the real `android-34/android.jar`; the fixture bundle builds (197 KB IIFE). **The hosted device run is the closing evidence — the issue moves to `closed` when that run is green and the digest doc records its numbers.**

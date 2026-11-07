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

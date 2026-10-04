---
okf_version: 0.2
title: "TN-136: Bound bundle evaluation with an interrupt handler and memory limit"
summary: "Syntactically valid bundle JS (while(true){} or unbounded allocation) hangs the UI thread indefinitely; QuickJS supports limits, the bridge sets none."
type: issue
status: ready
issue_id: "TN-136"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-029"
---

# TN-136 — Bound bundle evaluation with an interrupt handler and memory limit

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P1 |
| Dependencies | TN-029 (load and execute a verified bundle on Android) |
| Suggested size | One focused worktree and PR |
| Gate impact | UI-freeze / memory-exhaustion class from any hostile or buggy bundle |

## Purpose

Finding A3 of the 2026-09-28 Android host review
([record](../08-validation/android-host-review-2026-09-28.md)).
`tenun_android_bridge.c:119-168` evaluates the bundle synchronously with
no interrupt handler and no memory limit; `:223-256` dispatches actions
the same way; `TenunSurfaceView.kt:443-452` enters dispatch from the UI
thread. A syntactically valid packaged or signed OTA bundle containing
`while (true) {}` at init or in a tap handler hangs startup or
interaction indefinitely; unbounded allocation can exhaust the process.
QuickJS supports `JS_SetInterruptHandler` and `JS_SetMemoryLimit` — the
bridge sets neither.

## Required outcome

- Bundle evaluation and action dispatch are bounded: an interrupt
  handler plus a memory limit (budget values documented in the issue PR)
  turn an infinite loop or runaway allocation into a structured
  fail-visible error instead of a hang or OOM kill.
- Native bridge tests add the two review-missing cases: an
  init-time-loop bundle and a tap-handler-loop bundle both produce the
  bounded failure path (currently only the valid synchronous flow is
  covered).

## References

- [Android host review 2026-09-28, finding A3](../08-validation/android-host-review-2026-09-28.md)
- `embedders/android/app/src/main/cpp/tenun_android_bridge.c`

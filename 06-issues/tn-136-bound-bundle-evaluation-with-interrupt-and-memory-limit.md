---
okf_version: 0.2
title: "TN-136: Bound bundle evaluation with an interrupt handler and memory limit"
summary: "Syntactically valid bundle JS (while(true){} or unbounded allocation) hangs the UI thread indefinitely; QuickJS supports limits, the bridge sets none."
type: issue
status: closed
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

## Status note (2026-10-07, closed via PR #227)

`tenun_android_bridge.c` now installs, at runtime creation, an interrupt
handler and a per-engine memory limit, and re-arms a wall-clock deadline
before every `JS_Eval` (bundle boot) and every `JS_Call` (dispatch):

- **Time budget: 5000 ms per eval and per dispatch** (`CLOCK_MONOTONIC`
  deadline; the interrupt handler raises QuickJS's "interrupted"
  exception). A `while (true) {}` at init fails closed as the existing
  `stage=script_eval` boot diagnostic; in a handler it WARNs
  (`tenun dispatch action=… failed`) and leaves the last good scene —
  the host thread returns, bounded.
- **Memory limit: 32 MiB per engine runtime** (`JS_SetMemoryLimit`).
  A single `repeat(64 MiB)` allocation raises the structured out-of-
  memory exception and fails closed at boot.
- Test overrides (300 ms / 4 MiB) exist ONLY behind
  `TENUN_TEST_INJECTION`, mirroring the init-failure injection
  precedent; production and NDK builds compile them out.

Evidence: engine-loop section 12 — init-loop bundle (fails closed +
stage line), dispatch-loop bundle (last-good scene + WARN, both
captured), runaway allocation, and a healthy bundle under the
production budgets. Section watchdog `alarm(60)` turns any neutered
bound into a visible gate failure instead of a hung CI job. Local
mutation evidence: interrupt neutered (handler returns 0) → the harness
is SIGALRM-killed, exit 142; memory limit neutered (effective value
`SIZE_MAX`) → exactly the runaway-allocation check fails, exit 1.
Boundary: 5 s still blocks the UI thread for up to the budget on a
pathological dispatch — bounded, not pleasant; per-runway tuning is a
host-policy question, not a bridge one.

Review repair (2026-10-07): dispatch arms its deadline BEFORE handler
property lookup, since a getter can run application JS. Lookup exceptions
are consumed and WARNed. Regression cases prove normal dispatch after
an interrupted handler, a fresh getter budget after idle time, a bounded
looping getter, and subsequent recovery. The heap limit covers QuickJS
allocations, not host-native scene buffers or total process memory; the
wall-clock interrupt is cooperative and does not preempt native callbacks.

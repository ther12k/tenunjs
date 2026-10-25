---
okf_version: 0.2
title: "TN-151: Drain QuickJS pending jobs at every native entry point"
summary: "Nothing pumped QuickJS's job queue, so Promise continuations never ran on Android — async actions (including every capability call) could not settle; drain bounded by count and the TN-136 budgets, with unhandled rejections WARNed."
type: issue
status: closed
issue_id: "TN-151"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-029"
  - "TN-144"
---

# TN-151 — Drain QuickJS pending jobs at every native entry point

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P1 |
| Dependencies | TN-029 (bundle execution), TN-144 (TSX dev-loop gate that made async apps the norm) |
| Suggested size | One native PR (bridge + engine-loop legs) |
| Gate impact | Async actions and capability calls on device; prototype slice of TN-024's drain requirement |

## Purpose

Found by the 2026-10-25 framework review (reproduced in vendored
QuickJS): the bridge evaluated the bundle and called the dispatch
handler but never executed pending jobs, so `Promise.resolve().then(fn)`
never ran `fn`. Every async action — and after TN-141/TN-147 every
capability call, which are promise-shaped by contract — could start but
never settle or repaint on Android. The browser hosts drain naturally
via the event loop; the embedder is the event loop, so it must pump.

## Required outcome

- Bounded drain after bundle eval and after every dispatch handler run:
  each job under its own TN-136 time budget, a job-count cap, a job
  exception WARNed with the drain stopped (engine stays usable).
- Unhandled promise rejections are fail-visible: the host installs
  QuickJS's promise-rejection tracker and WARNs them (a `throw` inside
  `.then` rejects the derived promise — it does NOT fail the job, so
  without the tracker async action errors vanish silently).
- Engine-loop legs: boot-time continuation commits before create
  returns; dispatch-time continuation settles inside the dispatch
  entry; a rejecting job WARNs and the engine recovers.

## References

- `embedders/android/app/src/main/cpp/tenun_android_bridge.c` (`tenun_drain_pending_jobs`, rejection tracker)
- `embedders/android/src/test/cpp/test_engine_loop.c` (section 13)
- [TN-024](tn-024-implement-native-runtime-host-lifecycle.md) owns the full lifecycle contract; this is the embedder-prototype slice of its drain requirement.

## Status note (2026-10-25, closed)

Closed via PR #231: drain runs after eval and after both dispatch entry
points (1000-job cap, per-job TN-136 budgets), and
`JS_SetHostPromiseRejectionTracker` WARNs unhandled rejections
(`tenun unhandled promise rejection: …`). Section 13 pins boot-drain,
dispatch-drain, and reject-WARN + recovery; the TSX leg keeps proving
the real bundle. TN-024 stays open for the full engine-side lifecycle
contract — closing that requires the engine-workspace decision (TN-013).

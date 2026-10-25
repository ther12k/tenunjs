---
okf_version: 0.2
title: "TN-153: Run the controller load hook on fresh mounts"
summary: "ApplicationRuntime never invoked the public controller `load` hook, so apps with mount-time data (the launcher) sat on their loading surface until something else kicked them; the launcher also never showed launch failures."
type: issue
status: closed
issue_id: "TN-153"
milestone: "M3"
priority: "P1"
depends_on:
  - "TN-133"
---

# TN-153 — Run the controller load hook on fresh mounts

## Metadata

| Field | Value |
|---|---|
| Milestone | M3 — Application model and navigation (runtime surface) |
| Priority | P1 |
| Dependencies | TN-133 (execution contract) |
| Suggested size | One runtime+sample PR |
| Gate impact | Every app with mount-time data loads; 2026-10-25 review's #4 finding |

## Purpose

Found by the 2026-10-25 framework review (reproduced through
`installHostHandoff`). `ControllerDefinition.load` is public
`@tenunjs/core` API, but `ApplicationRuntime.mount` never called it —
and no runtime mechanism ran any mount-time action. The launcher sample
booted into `"loading"` and stayed there: `loadApps` had no caller
except the Retry button, which only exists after a failure. Its own
tests masked the gap by calling `press("loadApps")` explicitly. Adjacent
sample defect: a failed `launch()` set `failureKind` while leaving
`status:"ready"`, and the failure card keyed on `status` — so a failed
launch was invisible.

## Required outcome

- `ApplicationRuntime.mount` runs `controller.load` on FRESH mounts
  (constructor and first navigate); restore remounts are exempt (the
  snapshot is authoritative state). Async loads settle through the
  existing machinery: settlement fires `onStateInvalidation`, rejection
  routes to `onAsyncActionError` under the action name `"load"`.
- The launcher converts to a split screen whose `load` enumerates apps;
  `loadApps` remains as Retry; the failure card keys on `failureKind`
  so launch failures surface over a still-ready grid.
- Tests: fresh-mount load (sync + async + rejection), navigate-mount,
  restore-exemption (a restore remount must not re-enumerate), launcher
  boot-through-runtime (loading → ready with no kick action), and the
  visible launch-failure banner.

## References

- `packages/widgets/src/app-runtime.ts` (`mount`)
- `packages/core/src/index.ts` (`ControllerDefinition.load`)
- `examples/launcher/src/screens/home.screen.tsx`
- `packages/widgets/test/app-runtime.test.ts`, `examples/launcher/test/home.screen.test.ts`

## Status note (2026-10-25, closed)

Closed via PR #231: the runtime invokes `load` on fresh mounts with
restore-exemption; the launcher boots itself through the runtime
(loading → ready with zero host-side kicks), keeps Retry, and shows
"Launch failed (kind)" over the intact grid. On Android the async
settlement path now actually completes via TN-151's job drain — the
two fixes compose. `mountScreen` (example test-support) intentionally
does NOT invoke load: it drives the authoring model, and boot behavior
is the runtime's contract, pinned by the runtime-level tests.

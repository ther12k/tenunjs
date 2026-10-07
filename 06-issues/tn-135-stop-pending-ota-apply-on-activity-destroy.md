---
okf_version: 0.2
title: "TN-135: Stop a pending OTA apply on Activity destruction"
summary: "A finishing OTA download can boot a candidate into a dead surface after the Activity is destroyed or recreated."
type: issue
status: closed
issue_id: "TN-135"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-132"
---

# TN-135 — Stop a pending OTA apply on Activity destruction

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P1 |
| Dependencies | TN-132 (closed: installed Android run acceptance / OTA trial arc) |
| Suggested size | One focused worktree and PR |
| Gate impact | Orphaned engine / unconfirmed-trial state across launches |

## Purpose

Finding A2 of the 2026-09-28 Android host review
([record](../08-validation/android-host-review-2026-09-28.md)).
`OtaManager.kt:129-155` posts the apply on its own handler after
fetch/staging; `MainActivity.kt:418-424` removes only its own handler
callbacks, shuts the executor, and destroys the engine — it neither
stops the manager nor removes its posted apply. Destroy or recreate the
Activity while a download is finishing and the old Activity's
`applyOtaUpdate` (`:225-272`) can still boot a candidate and swap it
into a dead surface, leaving an unconfirmed trial and an orphaned engine
for the next launch.

## Required outcome

- The OTA apply pipeline is lifecycle-bound: on Activity destroy, the
  manager's pending apply (and in-flight fetch callbacks) is cancelled
  or completes without touching the destroyed surface/engine — no
  orphaned engines, no unconfirmed trials carried into the next launch.
- A targeted instrumentation test destroys/recreates the Activity around
  a completing download and asserts the invariant (no apply against the
  dead surface; next launch state is clean).

## References

- [Android host review 2026-09-28, finding A2](../08-validation/android-host-review-2026-09-28.md)
- `embedders/android/app/src/main/java/.../OtaManager.kt`, `MainActivity.kt`

## Status note (2026-10-07, closed via PR #226)

`OtaManager.stop()` is now terminal for the whole pipeline, not just the
dev loop: a `stopped` flag gates check entry (`checkNow` no-ops and
stays off the channel), the pre-staging point in `performCheck`
(verified bytes arriving after stop stage no trial), and posted-apply
run time (a stop landing between post and run abandons without
applying). Abandonment never quarantines — host death is not a bundle
defect; the release stays installable by the next launch.
`MainActivity.onDestroy()` calls `otaManager?.stop()` first, before its
own handler teardown and engine destroy.

Evidence: `OtaStopLifecycleTest` (instrumentation, runs in
`verify-android-device`) — three deterministic scenarios over a gated
loopback server. Baseline green on PR #226 (run 37568753851). Mutation
runs on throwaway branches via `workflow_dispatch` (no local device):

- pre-stage check neutered → `stopDuringManifestFetch…` AND
  `stopDuringBundleDownload…` FAIL (run 37569266971, job 112623985047);
- `checkNow` gate neutered → `checkAfterStopIsANoOpOnTheChannel` FAILS
  (run 37569270028, job 112623998801).

Honest boundaries, not claimed as proven: the posted-apply run-time
recheck is defense-in-depth whose neutering is not deterministically
observable (it requires a stop between post and run on the main
looper); the `onDestroy` wiring line is covered by the manager-level
stop contract and review, not by an automated test; Activity-level
destroy/recreate instrumentation is blocked by the asset-baked channel
(install-time trust anchor — a runtime-port loopback cannot be pointed
at a real Activity), so UI-level evidence stays in the manual
phone-test checklist, the boundary `OtaEngineJourneyTest` already
documents.

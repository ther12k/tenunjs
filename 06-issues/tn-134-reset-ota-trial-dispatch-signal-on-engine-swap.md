---
okf_version: 0.2
title: "TN-134: Reset the OTA trial dispatch signal on engine swap"
summary: "A pre-update tap satisfies the trial-dispatch criterion, so a broken OTA candidate can be confirmed with zero trial interactions."
type: issue
status: closed
issue_id: "TN-134"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-132"
---

# TN-134 — Reset the OTA trial dispatch signal on engine swap

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P1 |
| Dependencies | TN-132 (closed: installed Android run acceptance / OTA trial arc) |
| Suggested size | One focused worktree and PR |
| Gate impact | Weakens the OTA trial-health gate (fail-visible semantics) |

## Purpose

Finding A1 of the 2026-09-28 Android host review
([record](../08-validation/android-host-review-2026-09-28.md)).
`TenunSurfaceView.kt:162` records `dispatchedOnce` over the VIEW's
lifetime and `:447-456` fires the first-successful-dispatch hook only on
that first-ever TAP. `MainActivity.kt:256-264` swaps engines without
resetting the signal, and `:279-292` confirms the trial when
`firstSceneCommitted && firstDispatchObserved`.

Scenario: tap the packaged app once, then apply an OTA bundle — the
pre-update tap satisfies the dispatch criterion; after the uptime delay
the candidate is confirmed with zero trial interactions, so a broken
candidate can be persisted. The existing test suite never catches this
because `OtaEngineJourneyTest.kt:159-184` substitutes its own apply
callback and confirms trials manually — the Activity's trial-health
criterion is never exercised.

## Required outcome

- The dispatch-observation signal is scoped to the candidate engine's
  session (reset on every engine swap), so only interactions against the
  candidate count toward trial confirmation.
- A targeted instrumentation test drives the REAL Activity criterion:
  packaged-app interaction, then candidate apply, then assert the trial
  is NOT confirmed until the candidate itself observes a dispatch.
- Test gaps recorded in the review (Activity trial-health criterion
  unexercised) stay closed: the new test must fail on the unfixed code.

## References

- [Android host review 2026-09-28, finding A1](../08-validation/android-host-review-2026-09-28.md)
- `embedders/android/app/src/main/java/.../TenunSurfaceView.kt`, `MainActivity.kt`

## Status note (2026-10-05, fix executed)

The trial-confirm criterion is extracted into `TrialHealth`
(`app/src/main/kotlin/id/my/tenun/embedder/TrialHealth.kt`, JVM-testable
— the SceneHolder precedent: the Activity/SurfaceView cannot be
instantiated on the JVM). Evidence is session-scoped:
`onEngineSwapped()` clears both signals; `isHealthy()` requires the
CURRENT session's own scene commit AND dispatch.

Wiring:

- `TenunSurfaceView.engine` setter resets `dispatchedOnce`, so the
  first-successful-dispatch hook can fire again for each new engine
  (the view-lifetime flag was the root of A1).
- `MainActivity` feeds the real signals: boot scene (onCreate), swap +
  candidate scene (applyOtaUpdate), hot-reload swaps reset too
  (applyReload — a pending trial must not confirm on the old engine's
  evidence), and the surface dispatch hook. `scheduleTrialConfirm` now
  reads `trialHealth.isHealthy()`.

Test evidence (JVM, `TrialHealthTest`, 4 tests): the A1 regression —
packaged-session interaction, then swap + candidate scene, assert NOT
healthy until the candidate itself observes a dispatch — plus
swap-clears-both-halves, fresh-criterion, and repeated-swaps. Mutation
evidence recorded: with `onEngineSwapped()` neutered to the old
no-op-on-swap semantics, 3 of 4 tests FAIL including the A1 regression
(neutering verified by local run, then restored; gradle
`testDebugUnitTest` green 4/4, `compileDebugAndroidTestKotlin` green,
full local `run_android_test.sh` PASS: C engine loop, unit suite,
assembleDebug, NDK dual-ABI).

Known limit, unchanged from the review record: the full-Activity OTA
journey (real channel assets, 10 s trial uptime) stays engine-level in
the androidTest harness — the criterion logic itself is now
deterministically pinned, which is the layer the bug lived in.

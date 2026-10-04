---
okf_version: 0.2
title: "TN-134: Reset the OTA trial dispatch signal on engine swap"
summary: "A pre-update tap satisfies the trial-dispatch criterion, so a broken OTA candidate can be confirmed with zero trial interactions."
type: issue
status: ready
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

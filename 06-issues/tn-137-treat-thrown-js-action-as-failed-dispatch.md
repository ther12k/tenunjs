---
okf_version: 0.2
title: "TN-137: Treat a thrown JS action as a failed dispatch"
summary: "A JS_Call exception is logged but returns the previous scene as though dispatch succeeded, so a throwing trial bundle passes the dispatch criterion."
type: issue
status: ready
issue_id: "TN-137"
milestone: "M1"
priority: "P2"
depends_on:
  - "TN-029"
---

# TN-137 — Treat a thrown JS action as a failed dispatch

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P2 |
| Dependencies | TN-029 (load and execute a verified bundle on Android) |
| Suggested size | One focused worktree and PR (pairs with TN-134's test) |
| Gate impact | OTA trial-health false positive |

## Purpose

Finding A4 of the 2026-09-28 Android host review
([record](../08-validation/android-host-review-2026-09-28.md)).
`tenun_android_bridge.c:240-259` logs a `JS_Call` exception but returns
the previous scene as though dispatch succeeded; the surface then fires
the success hook. A trial bundle whose TAP handler throws can pass the
dispatch criterion and be confirmed after the uptime delay.

## Required outcome

- A dispatch that ends in a JS exception reports failure across the JNI
  boundary (distinct from "no scene committed"); the surface's
  dispatch-success hook does not fire for it.
- An instrumentation test (androidTest harness, per the review's
  disposition) drives a throwing tap handler through the REAL Activity
  trial criterion and asserts the trial does not confirm.

## References

- [Android host review 2026-09-28, finding A4](../08-validation/android-host-review-2026-09-28.md)
- `embedders/android/app/src/main/cpp/tenun_android_bridge.c`

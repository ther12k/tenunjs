---
okf_version: 0.2
title: "TN-138: Raise, never lower, the anti-replay floor on quarantine"
summary: "After the confirmed bundle is quarantined, acceptedSequence() returns -1 and an older still-valid signed bundle passes the sequence gate."
type: issue
status: ready
issue_id: "TN-138"
milestone: "M1"
priority: "P2"
depends_on:
  - "TN-132"
---

# TN-138 — Raise, never lower, the anti-replay floor on quarantine

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P2 |
| Dependencies | TN-132 (closed: installed Android run acceptance / OTA trial arc) |
| Suggested size | One focused worktree and PR |
| Gate impact | Anti-rollback guarantee of the OTA sequence gate |

## Purpose

Finding A5 of the 2026-09-28 Android host review
([record](../08-validation/android-host-review-2026-09-28.md)).
`UpdateStore.kt:46-54` returns `-1` from `acceptedSequence()` once the
confirmed bundle's backing files are deleted by quarantine;
`OtaManager.kt:115-121` compares new manifests only against that value.
After confirmed v5 is quarantined, an older, still-valid signed v4 that
was never quarantined passes the sequence gate and can be installed —
violating the monotonic anti-rollback floor quarantine is meant to raise.

## Required outcome

- Quarantine records the highest accepted sequence durably (independent
  of the quarantined bundle's backing files), so `acceptedSequence()`
  never regresses below a previously accepted value.
- An androidTest exercises the exact scenario: confirm v5, quarantine,
  offer signed v4 → rejected by the sequence gate.

## References

- [Android host review 2026-09-28, finding A5](../08-validation/android-host-review-2026-09-28.md)
- `embedders/android/app/src/main/java/.../UpdateStore.kt`, `OtaManager.kt`

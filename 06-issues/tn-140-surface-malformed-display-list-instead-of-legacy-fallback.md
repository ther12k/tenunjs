---
okf_version: 0.2
title: "TN-140: Surface a malformed display list instead of silently exiting display-list mode"
summary: "Missing ops and parse errors return null, the holder clears, and the surface falls back to stale legacy controls — incompatibility is never surfaced."
type: issue
status: ready
issue_id: "TN-140"
milestone: "M2"
priority: "P2"
depends_on:
  - "TN-042"
---

# TN-140 — Surface a malformed display list instead of silently exiting display-list mode

## Metadata

| Field | Value |
|---|---|
| Milestone | M2 — Native scene, layout, and Skia rendering |
| Priority | P2 |
| Dependencies | TN-042 (renderer-neutral display list) |
| Suggested size | One focused worktree and PR |
| Gate impact | Fail-visible contract for scene incompatibility |

## Purpose

Finding A7 of the 2026-09-28 Android host review
([record](../08-validation/android-host-review-2026-09-28.md)).
`DisplayListScene.kt:139-150` returns null for missing `ops` and
`:264-270` catches parse errors into null; `TenunSurfaceView.kt:342-351`
clears the scene holder on null and falls back to legacy/stale local
controls instead of surfacing incompatibility. (The browser twin of this
edge was hardened in #218 — the Android side kept the silent fallback.)

## Required outcome

- A malformed or incompatible display list produces a structured,
  visible failure state (consistent with the fail-visible panel used
  elsewhere), not a quiet legacy-UI fallback that hides the break.
- A Kotlin-side malformed-scene fixture test (the review's named gap for
  A7) pins the behavior: missing `ops`, parse error, and wrong-version
  shapes each surface the failure.

## References

- [Android host review 2026-09-28, finding A7](../08-validation/android-host-review-2026-09-28.md)
- `embedders/android/app/src/main/java/.../DisplayListScene.kt`, `TenunSurfaceView.kt`

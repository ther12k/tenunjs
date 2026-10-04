---
okf_version: 0.2
title: "TN-139: Free committed scenes when evaluation fails after commit"
summary: "A bundle that commits scenes and then throws leaks each committed scene on every attempted boot."
type: issue
status: ready
issue_id: "TN-139"
milestone: "M1"
priority: "P2"
depends_on:
  - "TN-029"
---

# TN-139 — Free committed scenes when evaluation fails after commit

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P2 |
| Dependencies | TN-029 (load and execute a verified bundle on Android) |
| Suggested size | One focused worktree and PR |
| Gate impact | Native leak on every attempted boot of such a bundle |

## Purpose

Finding A6 of the 2026-09-28 Android host review
([record](../08-validation/android-host-review-2026-09-28.md)).
`tenun_android_bridge.c:69-82` allocates `current_scene` on commit, but
the evaluation-error cleanup at `:169-216` frees the engine without
freeing that scene. A bundle whose boot commits one or more scenes and
then throws (`tenun_commit(...); throw ...`) leaks each committed scene
on every attempted boot.

## Required outcome

- The eval-failure cleanup path frees any scene committed during the
  failed evaluation (engine teardown owns everything allocated under
  it).
- A native test boots a commit-then-throw bundle repeatedly and asserts
  the bounded resource behavior (allocation count stable across
  iterations), per the review's disposition that A3/A6 need native test
  additions.

## References

- [Android host review 2026-09-28, finding A6](../08-validation/android-host-review-2026-09-28.md)
- `embedders/android/app/src/main/cpp/tenun_android_bridge.c`

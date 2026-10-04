---
okf_version: 0.2
title: "TN-144: Run a TSX-compiled example bundle in the Android QuickJS host as the dev-loop exit"
summary: "verify:android proves the embedder with a hand-authored tenun_app.js scene — not how anyone writes apps. Exit criterion: a TSX-compiled example bundle runs in the host, even with ugly widgets."
type: issue
status: ready
issue_id: "TN-144"
milestone: "M1"
priority: "P1"
depends_on:
  - "TN-023"
  - "TN-029"
---

# TN-144 — Run a TSX-compiled example bundle in the Android QuickJS host as the dev-loop exit

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P1 |
| Dependencies | TN-023 (bundle compiler — arbitrary-entry packaging), TN-029 (bundle execution on Android) |
| Suggested size | Packaging + gate PR |
| Gate impact | The dev-loop/host gap that lost the first external consumer to Kotlin |

## Purpose

Gap 1 of the VOTOL consumer feedback
([record](../08-validation/votol-consumer-feedback-2026-10-02.md)).
The VOTOL app ran beautifully in the browser host, but the Android gate
(`verify:android`) proves the embedder with a hand-authored scene
(`embedders/android/app/src/main/assets/tenun_app.js`) — not
representative of how anyone writes apps. The consumer build fell off
the framework at exactly this step and shipped native Kotlin. The
milestone exit outcome to push for: a TSX-compiled example bundle runs
in the Android QuickJS host — even with ugly widgets — BEFORE the
widget layer is polished.

## Required outcome

- The bundle compiler (TN-023 lineage) packages a real example entry
  (any sample's `src/main.tsx` composition) for the Android host, and
  the host boots it through the same public contract path a consumer
  uses — no hand-authored scene in the loop.
- A CI-visible gate (or verify:android leg) runs that bundle on the
  QuickJS host and asserts first scene commit + one dispatch, so the
  dev-loop claim is continuously proven, not asserted by README.
- Evidence discipline unchanged: no device-behavior claims beyond what
  the harness actually drives (ADR-0022).

## References

- [VOTOL consumer feedback, gap 1](../08-validation/votol-consumer-feedback-2026-10-02.md)
- `embedders/android/app/src/main/assets/tenun_app.js` (the hand-authored scene to retire)
- 04-api/external-consumer-guide.md (the app→host route this completes)

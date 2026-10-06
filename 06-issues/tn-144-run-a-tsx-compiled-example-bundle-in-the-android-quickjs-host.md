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

## Status note (2026-10-07, gate landed)

Executed as a `verify:android` engine-loop leg. The bundle compiler now
packages the counter sample (`examples/counter` defineScreen TSX + theme)
through the public host-handoff contract
(`tools/gallery-bundle/counter-entry.ts` + `build-counter.mjs`, with a
headless build smoke that fails the build on a mis-wired entry), and
`test_engine_loop --tsx` boots that bundle in the real vendored QuickJS
through the same C bridge a consumer host uses. Eleven checks: first
scene commit via the native `tenun_commit` binding, a TENUN_RESTORE
round trip with a host-carried snapshot (scene re-commits with the
restored state), a schema-tampered restore that must fail visible (WARN
on the host log) and non-fatally (engine still dispatches), plus the
boot assertions. Mutation evidence: bumping
`APPLICATION_STATE_SCHEMA` fails 4 of the 11 checks and exits 1.

Scope boundary kept: the packaged APK still boots the notes reference
app (`tenun_app.js`) because the TN-132 device-acceptance UI drives
that app; swapping the packaged default is a separate decision. The
tool tsconfig also entered the CI typecheck chain (its entries were
previously editor-only), and `bun install --frozen-lockfile` +
`setup-bun` back the new gate step.

---
okf_version: 0.2
title: "TN-171: Deliver the same-code device journey and README recording (TN-155 closure)"
summary: "Day Plan's compiled TSX bundle boots through the production Android embedder and completes the full user journey through real MotionEvents and the InputConnection; the README records Day Plan as the headline demo; TN-155 closes."
type: issue
status: ready
issue_id: "TN-171"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-157"
  - "TN-158"
  - "TN-160"
  - "TN-161"
  - "TN-169"
  - "TN-170"
---

# TN-171 — Deliver the same-code device journey and README recording

## Purpose

TN-155 requirement 7: "The same application code running through every
available embedder." The structural parity gate already proves scene
equality between the browser script host and real QuickJS; what is
missing is the SURFACE leg — the same Day Plan bundle driven through the
production Android view's real touch pipeline and IME on the device
gate — plus TN-155's closing requirement that the application becomes
the README's headline demo.

## Required outcome

1. The compiled Day Plan bundle is a committed androidTest asset
   (`framework_feel_app.js`, the `tenun_app.js` precedent: rebuilt from
   `examples/framework-feel` when the app changes).
2. A device-gate journey test boots the bundle in `TenunEngine`, lays
   out `TenunSurfaceView` at the app's design size, and completes the
   journey through REAL `MotionEvent`s and the `InputConnection`:
   complete a task, navigate with the host-evaluated transition (assert
   the transition block on the committed scene, wait for settle), return,
   toggle the runtime theme, focus and edit the plan title, drag the
   checklist scroll region, and keep tapping accurately afterwards.
3. The README records Day Plan as the headline demo with browser + CI
   run instructions.
4. TN-155 closes: all seven requirements have implementation and
   evidence; font/CJK coverage and the live soft-keyboard journey remain
   recorded limitations (pre-demonstration polish, TN-160 note).

## Verification

- `FrameworkFeelJourneyTest` green on the device gate (emulator).
- Existing parity/unit gates unchanged; full 8-gate CI.
- README renders the recorded demo instructions.

## Out of scope

- Packaging Day Plan as the launcher application (the embedder APK keeps
  its own asset; the bundle is reused, not the app identity).
- Physical-device evidence (ADR-0019 owns that boundary).

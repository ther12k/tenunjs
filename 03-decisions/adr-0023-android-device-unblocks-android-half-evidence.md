---
okf_version: 0.2
title: "ADR-0023: Android physical device in the dev loop; Android-half device evidence unblocked"
summary: "Partial unblock of ADR-0022: a physical Android phone participates in the development loop since 2026-09-30, so Android-only physical-device evidence work may start; the three M0 selection gates stay blocked pending matched iOS evidence."
type: decision
status: accepted
---

# ADR-0023: Android physical device in the dev loop; Android-half device evidence unblocked

## Context

ADR-0022 recorded the three M0 selection gates as BLOCKED_BY_ENVIRONMENT
on the premise that "no physical device is currently attached to this
project's workflow."

That premise changed on 2026-09-30: a physical Android phone is now in
the development loop over WiFi — the dev server with the `/apk` install
route (PR #215) serves the debug APK and hot-reload bundles to the
installed app on the phone. This is a real device exercising the real
installed-app path, not an emulator.

What has NOT changed:

- No iOS device is attached; `embedders/ios/` is still empty.
- The M0 selection gates (ADR-0005 engine language, ADR-0007 JS runtime,
  ADR-0008 layout) require **matched** evidence across iOS and Android.
- No device evidence has yet been captured as a governed evidence packet
  from the phone; the loop so far is development and rehearsal, not
  measurement.

## Decision

1. **Android-half physical-device evidence work is unblocked.** This
   covers, on Android only:
   - GH issue #142 item H4's Android half (startup, frame, list, bridge
     benchmarks on baseline Android hardware);
   - ADR-0005's Android vertical-slice measurements (re-run as written);
   - Android IME/accessibility automation (TN-112's Android side).
2. **The three M0 selection gates remain BLOCKED_BY_ENVIRONMENT** until
   matched iOS device evidence exists. An Android-only measurement is
   admissible input to a future selection, never a conclusion of one.
3. **Evidence labeling is mandatory.** Any packet captured from the
   phone must name the device and distinguish it from emulator-derived
   evidence; ADR-0022's "emulator evidence is not retroactively counted"
   rule is unchanged and extends to dev-loop observations, which do not
   count as measurements until captured under a governed protocol.
4. **Emulator gates stay as they are.** Nothing in this ADR weakens the
   KVM-backed `verify-android-device` acceptance gate or re-scopes any
   gate to the phone.

## Violated invariant (named, per the exception clause)

None. This ADR removes a blocker whose stated premise no longer holds;
it does not waive or weaken any invariant. The matched-evidence
invariant of ADR-0005/0007/0008 and ADR-0019 is explicitly preserved
(clause 2).

## Rollback plan

If the phone leaves the loop (hardware unavailable, environment reset),
ADR-0022's terms resume in full: Android-half evidence work returns to
BLOCKED_BY_ENVIRONMENT, and any in-flight Android-only measurements are
parked as inadmissible-for-selection input until a device returns.

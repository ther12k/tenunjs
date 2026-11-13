---
okf_version: 0.2
title: "TN-197: UI-Activity OTA journey — the whole flow with a user in the app"
summary: "The OTA tests used the engine directly with manual trial confirmation; none proved the whole Activity flow with user state. This adds OtaActivityJourneyTest: the REAL MainActivity on a device, a signed loopback channel injected through a debuggable-only intent seam, a user tapping/scrolling/editing a form through the system input pipeline, releases applying live and confirming through the REAL trial-health machinery, user state carried across a swap, stored-bundle re-verified boots, an idle release arriving at the real 60s-throttled foreground-return cadence, and a next-launch release boot-activated clean-state. The journey caught two real TN-196 defects before merge: bootEngine never considered a staged next-launch candidate when a confirmed bundle existed, and a fresh manager's check re-staged over a boot-activated in-flight trial."
type: issue
status: ready
issue_id: "TN-197"
priority: "P1"
depends_on:
  - "TN-132"
  - "TN-196"
---

# TN-197 — UI-Activity OTA journey

The P1 from the 2026-11-13 OTA review: "Pengujian OTA melalui aplikasi
yang benar-benar sedang digunakan".

## Purpose

Every OTA test drove the engine (or OtaManager) directly and confirmed
trials by hand. Nothing proved the layer the user actually lives in:
the Activity lifecycle, the real confirm criterion, real input, real
state, and recovery from background/close — the review's ask: "pengguna
mengisi form, melakukan scroll, memiliki koneksi TCP/TLS aktif, menerima
update, lalu aplikasi di-background atau ditutup".

## Required outcome

1. The REAL MainActivity runs its whole OTA stack against a signed
   loopback channel injected via intent extras (`tenun.ota.*`) — honored
   ONLY when the APK is debuggable, so a release build never accepts a
   channel (and thereby a signer key) from another app's intent.
2. The journey exercises, in one pass:
   - a live IMMEDIATE apply underneath a user mid-use (real system taps,
     a real scroll, a real form edit through the InputConnection);
   - the REAL trial confirm (scene + dispatch + uptime — no manual
     confirmTrial anywhere);
   - user state (completed task + edited title) carried across a live
     swap via the acknowledged restore;
   - a stored-bundle re-verified boot after recreate;
   - an IDLE release arriving at the real foreground-return cadence
     (out-waiting the 60s check throttle), staged by the resume check
     and applied by the resume activation;
   - a NEXT-LAUNCH release staying staged across resumes and
     boot-activating clean-state on the next recreate, then confirming
     itself;
   - companion connectivity: every served bundle opens a TCP session to
     the journey's probe at boot, present across every activation path.
3. The journey must be able to FAIL the production code — and it did,
   catching two real TN-196 defects before they shipped:
   - **boot-order defect**: `bootEngine`'s staged-activation block sat
     after the confirmed-bundle path, which returns on success — a
     staged next-launch release was never considered when a confirmed
     bundle existed. Fixed: the staged candidate is now evaluated FIRST.
   - **trial re-stage defect**: a boot-activated release sits in TRIAL
     (not yet accepted), so a fresh manager's check passed the sequence
     gate and RE-STAGED over the running trial, clobbering the state
     `confirmTrial` needs. Fixed: an in-flight trial of the served
     sequence is treated as up to date.

## Verification

- `OtaActivityJourneyTest.otaJourneyThroughTheRealActivity` — green on
  the local tenun-acceptance emulator (API 30): the full pass above,
  ~1m53s including the real 60s-throttle wait.
- Regression: `OtaEngineJourneyTest` + `OtaStopLifecycleTest` green on
  the same emulator after the two production fixes; JVM unit suites
  green; verify-manifest + verify-evidence PASS.

## Known limitation (documented, follow-up)

Window-focus loss ends a display text session on pause
(`onWindowFocusChanged(false)` → `endDisplayTextInput`), so a form can
never be "open" ACROSS a backgrounding — the idle gate's busy-deferral
branch is unreachable at Activity level with this signal (the mechanism
itself is engine-journey-proven with a synthetic gate). A meaningful
pause-surviving busyness signal would be live net sessions (process-level
NetService): an idle release deferring while a companion connection is
active. TLS legs likewise untested (plain TCP only; the keys-identity
pairing path exists but needs a cert-bearing probe server).

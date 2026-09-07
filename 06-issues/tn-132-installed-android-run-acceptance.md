---
okf_version: 0.2
title: "TN-132: Run the packaged Android application on an installed emulator or device"
summary: "Close the installed-run acceptance for the Android embedder foundation: install the debug APK, operate the application loop, observe JavaScript-only customization, and exercise production Unicode and lifecycle boundaries."
type: issue
status: ready
issue_id: "TN-132"
milestone: "M1"
priority: "P0"
depends_on:
  - "TN-131"
---

# TN-132 — Run the packaged Android application on an installed emulator or device

## Purpose

PR #173 integrated an experimental Android embedder foundation with host-tested QuickJS execution, Kotlin editing-model unit tests, native target builds, and debug APK packaging. That integration deliberately does not claim the first-runnable-app milestone: **the APK has never been installed, launched, or operated on Android.** This issue closes that gap with an actual installed run.

The immediate implementation path is a GitHub Actions `verify-android-device` job on a hosted `ubuntu-24.04` Linux runner (standard VM runner with KVM support), using GitHub's documented KVM permission setup. `ubuntu-slim` and additional job containers are not acceptable substitutes: `ubuntu-slim` is an unprivileged container without nested KVM.

A local emulator attempt on the development host was `BLOCKED_BY_ENVIRONMENT` (`/dev/kvm` absent; Android 11 `system_server` did not reach usable state under software QEMU emulation). That attempt is recorded for provenance; retrying the same software-emulation path is not a valid approach.

## Required acceptance evidence

### 1. Accelerated emulator on a hosted runner

- `verify-android-device` job runs on `ubuntu-24.04` (standard VM runner).
- GitHub-documented KVM permission setup applied; acceleration verified usable with the SDK emulator's `-accel-check` diagnostic before use.
- Emulator started with `-accel on` so an unavailable accelerator fails the job rather than silently falling back to slow software emulation.
- Headless mode (`-no-window -no-audio -no-boot-anim -gpu swiftshader_indirect`) is acceptable; ADB remains available for install, input, screenshots, and logcat.
- Record: runner image, system image (`system-images;android-XX;...;x86_64`), API level, ABI.

### 2. Installed application operation (main loop)

- Build the APK from the reviewed revision; record its exact SHA-256.
- Install via `adb install` (or `./gradlew :app:installDebug`) and launch `MainActivity`.
- Demonstrate the visible loop through **Android input** (instrumented test, or documented manual run):
  1. Initial scene visible.
  2. Tap title field; enter text (including Unicode sample `Note 😀`).
  3. Tap details field; enter text (including `チーム 🎉`).
  4. Tap `Add Entry`.
  5. Entry becomes visible; both inputs clear.
  6. Repeat successfully with a second entry.
- Record the input method used. Calling `InputConnection` methods directly establishes adapter behavior only and must not be presented as a real keyboard/IME session.
- CheckJNI remains enabled (default on emulators). Disabling it to obtain a pass is a review failure.
- Required: nonzero executed-test count (for instrumented runs) or a recording/screenshots (for manual runs). A missing emulator, failed installation, or build-only result is not an interaction pass.

### 3. JavaScript-only customization observed on screen

- Install an application-only variant of `tenun_app.js` (button label `"Submit Note"`, entry prefix `"[Task] "`).
- Observe the changed label and prefixed entry **on screen**, not only in committed scene JSON. No C/Kotlin implementation changes permitted.
- Record the variant APK's digest separately from the normal APK.

### 4. Production Unicode round-trip under CheckJNI

- The `Note 😀` / `チーム 🎉` samples must survive: Android/Kotlin `String` → production JNI input conversion → QuickJS action → committed scene → production JNI output conversion → Android/Kotlin `String` → visible text.
- Current host tests preserve these strings in scene JSON but do not exercise ART's CheckJNI validation; this step closes that boundary.

### 5. Real Activity/surface lifecycle transition

- Exercise actual recreation (e.g. `adb shell am stack` / rotation, or `ActivityScenario.recreate()` in an instrumented test). Manually calling `surfaceDestroyed`/`surfaceCreated` does not satisfy this.
- After recreation, editing and submission must still work without crashes or stale callbacks. A documented in-memory state reset is acceptable; accessing disposed state is not.

## Evidence to attach

- Source revision SHA and CI run ID for the executed job.
- Android environment: system image, API level, ABI, emulator version.
- Input method used for each scenario.
- Exact installed APK SHA-256 (normal and customization variant).
- Commands used and complete pass/fail summary with executed-test counts.
- Screenshots or recording of the visible interaction; relevant logcat excerpts (JNI/lifecycle failures must be absent).

## Out of scope

- Full TalkBack/accessibility coverage, broad keyboard compatibility, and physical-device gating (separate milestones: TN-112, TN-115).
- iOS (`NOT_EXERCISED` until a macOS/Xcode environment exists).
- Actual JavaScript-stall responsiveness measurement (TN-115).
- Production engine selection (ADR-0005 remains open; this issue must not conclude it).
- TSX/API surface expansion or widget catalog work.

## Acceptance criteria

- [ ] `verify-android-device` job exists, runs on `ubuntu-24.04`, and passes with `-accel on` (verified via `-accel-check`).
- [ ] APK from the reviewed revision is installed; digest recorded.
- [ ] Main application loop completed twice through Android input with visible results.
- [ ] JavaScript-only customization observed on screen; variant APK digest recorded separately.
- [ ] Unicode samples round-trip through the production JNI path under CheckJNI.
- [ ] Real Activity/surface recreation exercised; post-recreation interaction succeeds.
- [ ] Existing six CI checks remain green and unchanged.
- [ ] Only defects exposed by actual execution are fixed; no speculative refactors.

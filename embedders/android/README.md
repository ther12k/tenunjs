# Android embedder (experimental)

An experimental Android embedder foundation: an embedded QuickJS engine
(vendored C sources) executes the JavaScript application bundle, a JNI bridge
carries actions and committed scenes, and a `SurfaceView` renders the scene
and bridges the Android soft keyboard (`InputConnection`). CI installs and
operates the packaged application on a KVM-backed Android 11 emulator on
every run (`verify-android-device`).

**What is demonstrated** — and its exact boundary — is recorded in the
[project status](../../README.md#tenunjs) and
[TN-132](../../06-issues/tn-132-installed-android-run-acceptance.md):
the limited JavaScript-driven reference application (two text fields, an
"Add" button, an entry list) installs and operates on the tested emulator
configuration, with Unicode/quote text round-tripping through the production
JNI path under CheckJNI, real soft-keyboard input, and a JavaScript-only
customization observed on screen. Physical devices, screen readers,
animation/scrolling, a widget/TSX layer, and iOS are **not** covered.

## Prerequisites

- JDK 17 (Temurin works; the Kotlin build targets JVM 17).
- Android SDK with:
  - Platform 36 (`platforms;android-36`) and build-tools (Gradle picks them).
  - NDK `28.2.13676358` and CMake `3.22.1` (the native bridge compiles the
    vendored QuickJS sources for `arm64-v8a` and `x86_64`).
  - `platform-tools`, `emulator`, `cmdline-tools;latest`,
    `system-images;android-30;default;x86_64` for the emulator run.
- Point the tools at the SDK either way:
  - `ANDROID_HOME=/path/to/android/sdk` in the environment, **or**
  - `sdk.dir=/path/to/android/sdk` in `embedders/android/local.properties`
    (gitignored; Android Studio writes this for you).
- A KVM-capable Linux host for the emulator (see the known limitation below).

## 1. Host verification (no device needed)

```sh
cd embedders/android
export ANDROID_HOME=/path/to/android/sdk   # if not already set
./run_android_test.sh
```

Four steps, all enforced by the `verify-android` CI job:

1. Compiles the native bridge (with vendored QuickJS) plus the host test
   driver and runs the execution loop against the **real** `tenun_app.js`:
   invalid JavaScript fails closed, field dispatch, add-entry, emoji
   round-trips, and a JS-only customization with zero C changes.
2. Runs the JVM unit tests for the Kotlin editing model (composition
   replacement vs append, focus transfer, scene sync).
3. Assembles the debug APK via `./gradlew :app:assembleDebug` and prints its
   size and SHA-256.
4. Verifies NDK cross-compilation for both ABIs.

Expected final line: `ALL ANDROID VERIFICATIONS AND ARTIFACTS PASS`.

## 2. Run the application on an emulator

```sh
# One-time: create the AVD (same image CI uses)
"$ANDROID_HOME"/cmdline-tools/latest/bin/avdmanager create avd \
  --name tenun-dev --package "system-images;android-30;default;x86_64" \
  --device pixel --force
# The soft keyboard must be the input surface; a hardware-keyboard device
# suppresses the IME entirely (diagnosed in PR #174).
echo "hw.keyboard=no" >> "$HOME/.android/avd/tenun-dev.avd/config.ini"

# Every run: verify acceleration, then boot accelerated (fail-closed).
# CI boots headless (-no-window -no-audio -no-boot-anim -gpu
# swiftshader_indirect); for interactive use keep the window.
"$ANDROID_HOME"/emulator/emulator -accel-check
"$ANDROID_HOME"/emulator/emulator -avd tenun-dev -accel on -no-snapshot &

cd embedders/android
./gradlew :app:assembleDebug
"$ANDROID_HOME"/platform-tools/adb install -r \
  app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME"/platform-tools/adb shell am start \
  -n id.my.tenun.embedder/.MainActivity
```

Tap a field, type with the soft keyboard, tap **Add Entry** — the entry
appears in the list and both inputs clear.

**Known limitation:** without `/dev/kvm` the emulator cannot complete
Android 11 boot (software QEMU dies in `system_server`); this is an
environment failure, not an application failure. The CI gate runs on a
KVM-backed `ubuntu-24.04` runner for exactly this reason.

## 3. Change the application without touching framework internals

All application behavior lives in
[`app/src/main/assets/tenun_app.js`](app/src/main/assets/tenun_app.js):
edit the scene (button label, entry prefix, validation), then rebuild and
relaunch with the commands above. The application bundle is evaluated by the
embedded QuickJS engine at startup; no C or Kotlin changes are involved. CI
proves this leg continuously: the device job installs a JS-only variant
(label `"Submit Note"`, entry prefix `"[Task] "`) and asserts the changes on
screen.

## 4. The CI device gate

`verify-android-device` (see
[`run_device_acceptance.sh`](run_device_acceptance.sh) and the
[`ci.yml`](../../.github/workflows/ci.yml) job) boots the emulator with
verified KVM acceleration, enables CheckJNI deliberately (the AOSP image
defaults it off; it is never disabled), installs the APKs, and enforces:

- the standard instrumented suite: initial scene, the two-entry loop typed
  through **real LatinIME soft-key taps**, the Unicode/quote round-trip
  through the production JNI path, a real `ActivityScenario.recreate()`
  transition with a post-recreation interaction, and a screenshot baseline;
- the JS-only variant suite via `am instrument`, with the customization
  asserted on screen by pixel-diff against the standard APK's baseline;
- artifact identity: the APK digests recorded must equal the digests pulled
  back from the device (`pm path`), for both the standard and variant APKs;
- a clean application-window device log: JNI/CheckJNI aborts or fatal
  exceptions fail the run.

Failures are classified: exit 90 `DEVICE-ENVIRONMENT-FAILURE` (KVM, boot,
image) vs exit 1 `DEVICE-ACCEPTANCE-FAILURE` (install, launch, tests).
Screenshots, logs, test XMLs, and a `summary.json` are uploaded as the
`android-device-acceptance` artifact on every run.

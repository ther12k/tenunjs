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

## 5. The gallery device bundle (prototype)

`tools/gallery-bundle` builds a second, generated application bundle that
puts the real `@tenunjs-examples/gallery` showcase on the phone: the
screens' `initialState()`, typed actions, and JSX views run unchanged on
QuickJS through `@tenunjs/jsx-runtime`, and a prototype display-list
renderer draws them.

```bash
bun embedders/android/tools/gallery-bundle/build.mjs   # -> app/src/main/assets/gallery_app.js
cd embedders/android && ./gradlew :app:assembleDebug
```

- `MainActivity` prefers `gallery_app.js` and falls back to the notes
  reference bundle (`tenun_app.js`). The generated file is gitignored;
  without it, the APK is exactly the TN-132 acceptance application, so the
  device acceptance suite is unaffected.
- The JS side emits a display-list scene (`{"tenun":"display-list", ...}`:
  `rect`/`outline`/`text` ops plus tap regions whose payloads index into a
  JS callback table). `TenunSurfaceView` parses it (`DisplayListScene.kt`),
  paints it at a 720-unit design width, supports drag scrolling, and
  dispatches taps back as actions. Scenes without the marker keep using the
  legacy notes rendering path.
- Status: prototype-grade embedder glue (approximate text metrics, single
  clip, no reconciliation). It is not the widget-host contract — TN-034,
  TN-035, and the M4 widget layer own that. The notes application remains
  the only TN-132 acceptance surface.

## 6. Dev hot reload (prototype)

The gallery bundle supports Fast-Refresh-style reloads against a laptop
dev server — new code, old state:

```bash
# laptop: serve the bundle and keep rebuilding on source changes
bun embedders/android/tools/gallery-bundle/dev-server.ts          # :8898

# laptop: bake the dev server URL into the APK (once, before assembleDebug)
TENUN_DEV_SERVER=http://<laptop-ip>:8898 bun embedders/android/tools/gallery-bundle/build.mjs
cd embedders/android && ./gradlew :app:assembleDebug

# edit any screen / widget / runtime source — the phone picks it up
# within ~2.5s (polls /hash, fetches the bundle, restores screen state)
```

Mechanics: the JS side exports live screen state (`__TENUN_EXPORT`) before
the engine is destroyed; the fresh bundle is evaluated and the state is
restored (`TENUN_RESTORE`), so you keep your route, cart, and toggles.
QuickJS cannot patch code in place (no JIT class patching like Dart's VM),
so every reload is a real engine swap with state carried across — the same
semantic level Flutter hot reload provides, with different mechanics.
Without `dev_server.txt` the app never touches the network. Reloads are
skipped (last good bundle kept) if a rebuild fails on a half-saved file.

## 7. OTA bundle updates (prototype)

Because the whole application is a JavaScript bundle, "update the app
without a store" reduces to: download a new bundle, verify it, swap the
engine — live, with state carried over. That is the React Native /
CodePush delivery shape, and the distribution unit here is even simpler
(the whole app is one bundle). What does NOT fall out naturally is
everything CodePush-like infrastructure is actually made of: trust,
anti-replay, host compatibility, state-schema compatibility, activation,
rollback, crash recovery, key rotation, rollout, observability. This
prototype implements the first six in small, explicit form and leaves the
rest for later design.

```bash
# once: generate the channel keypair (keep the private key OUT of git —
# and never `git add -A` in a tree that holds it; stage explicit paths)
node embedders/android/tools/gallery-bundle/publish-update.mjs --init

# publish release v2 (signs the built gallery bundle)
bun embedders/android/tools/gallery-bundle/rebuild.ts
node embedders/android/tools/gallery-bundle/publish-update.mjs \
  --version 2 --base-url http://<laptop-ip>:8898
# -> examples/gallery-preview/.out/ota/{update-manifest.json,update-bundle.js,update_channel.json}

# bake the channel into the APK (once): copy update_channel.json to
# app/src/main/assets/ and assembleDebug — then run the dev server
bun embedders/android/tools/gallery-bundle/dev-server.ts   # serves /update-*
```

### Signed release envelope

The served manifest is `{ payload, signature }`: an ECDSA P-256 signature
over the EXACT bytes of the release metadata — no re-serialization, no
canonicalization. The app verifies the signature first, then parses those
same verified bytes. The signed metadata carries the security-relevant
contract, so replays and misattributed releases fail closed:

    schema, appId, channel,
    sequence          (monotonic; the anti-replay floor),
    hostApiMin/hostApiMax (an old APK refuses a bundle needing a newer host),
    stateSchema       (state carry across swaps only when equal),
    bundleFormat ("tenun-js-bundle-v1"), bundleSize, bundleSha256, bundleUrl

Gate order: signature → parse → app/channel/host match → sequence newer
than accepted and not quarantined → download → size/digest match → stage.

### Lifecycle and rollback

    staged → trial → confirmed (active pointer moves)

A trial is confirmed only after: first scene committed, first successful
dispatch, and minimum uptime. A process that dies before confirming leaves
the TRIAL on disk; the next start quarantines that sequence and boots the
last confirmed (or packaged) bundle. A failed apply quarantines the
sequence immediately — a bad release is never retried. Storage is
versioned directories (`bundles/<sequence>/`) with atomic temp-file
renames and one lock; pointers never point at partial state.

### Network posture

- HTTPS for production channels; release builds ship with a Network
  Security Config that forbids cleartext (`src/main/res/xml`); debug
  builds override it (`src/debug/res/xml`) so the LAN dev loop works.
- No certificate pinning: TLS provides transport confidentiality and
  server authentication; update AUTHENTICITY comes from the pinned
  signing key in the signed envelope, which survives even TLS-layer
  problems. (Android advises against pinning as a default because server
  cert changes can strand installed clients.)
- Polling: 30s loop ONLY on dev builds (dev_server.txt present);
  otherwise launch + foreground-resume checks, throttled. Perpetual
  short polling must not become an accidental production contract — the
  production shape is launch/resume + WorkManager or push.

### Scope and honesty

- **JS application bundles only; no DEX/JAR/native-library OTA.** The
  host only ever evaluates the declared JS bundle format; anything else
  is a normal APK install. (This matches the interpreted-code carve-out
  in Google Play policy — but "Play compliant OTA" is NOT claimed until a
  real release passes review.)
- Without the channel asset, OTA is completely dormant (no network use).
- Implementation status: verified at the prototype level. The JVM suite
  (protocol gates, store lifecycle/quarantine, channel/verifier) passes
  via `./gradlew test`; the on-device OtaEngineJourneyTest (signed
  update applies → restart keeps it → tampered rejected → boot-failing
  quarantined) runs in the CI device acceptance gate. Production
  operational maturity (WorkManager/push cadence, real channel ops) is
  still future work.

Logs: `adb logcat -s TenunOta TenunMainActivity TenunEngine`.

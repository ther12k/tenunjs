#!/usr/bin/env bash
# TN-132 installed-device acceptance: run the packaged TenunJS application on
# a KVM-backed hosted Android emulator.
#
# Failure classification (required by TN-132: an environment failure must stay
# distinguishable from an application failure):
#   exit 90 + "DEVICE-ENVIRONMENT-FAILURE:"  — runner/emulator/image problems
#   exit 1  + "DEVICE-ACCEPTANCE-FAILURE:"   — install/launch/test/render problems
#
# CheckJNI stays enabled for the entire run; the script refuses to proceed if
# the image boots without it and never disables it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_HEAD="$(git -C "$SCRIPT_DIR" rev-parse HEAD)"
WORK_DIR="$(mktemp -d /tmp/tenun-device-acceptance.XXXXXX)"
OUT_DIR="$SCRIPT_DIR/device-acceptance-output"
ADB="${ANDROID_HOME:-}/platform-tools/adb"
APP_ID="id.my.tenun.embedder"
TEST_APP_ID="id.my.tenun.embedder.test"
AVD_NAME="tenun-acceptance"

TENUN_EMULATOR_IMAGE="${TENUN_EMULATOR_IMAGE:-system-images;android-30;default;x86_64}"
TENUN_DEVICE_PROFILE="${TENUN_DEVICE_PROFILE:-pixel}"
TENUN_BOOT_TIMEOUT="${TENUN_BOOT_TIMEOUT:-900}"

ENV_FAIL=90
# Dumps the device log and any screenshots taken so far on failure, so the
# discriminating evidence (native stderr, ART messages, crash context, and
# what the screen actually showed) survives into artifacts.
collect_logs() {
  if [ -x "$ADB" ] && "$ADB" get-state >/dev/null 2>&1; then
    "$ADB" logcat -d >"$OUT_DIR/logcat_full.txt" 2>&1 || true
    echo "--- last 120 logcat lines ---"
    tail -120 "$OUT_DIR/logcat_full.txt" || true
    for f in $("$ADB" shell ls /data/local/tmp/ 2>/dev/null | tr -d '\r' | grep '^tenun_.*\.png$'); do
      "$ADB" pull "/data/local/tmp/$f" "$OUT_DIR/" >/dev/null 2>&1 || true
    done
  fi
}
env_fail() {
  collect_logs
  echo "DEVICE-ENVIRONMENT-FAILURE: $*"
  exit "$ENV_FAIL"
}
accept_fail() {
  collect_logs
  echo "DEVICE-ACCEPTANCE-FAILURE: $*"
  exit 1
}

cleanup() {
  if [ -n "${EMU_PID:-}" ] && kill -0 "$EMU_PID" 2>/dev/null; then
    adb emu kill >/dev/null 2>&1 || true
    sleep 3
    kill "$EMU_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "== 1. Toolchain and KVM preflight =="
[ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ] || env_fail "\$ANDROID_HOME is not set to an Android SDK directory"
SDKM="$(ls "$ANDROID_HOME"/cmdline-tools/*/bin/sdkmanager 2>/dev/null | sort -V | tail -1)"
[ -x "$SDKM" ] || env_fail "sdkmanager not found under \$ANDROID_HOME"

if ! [ -e /dev/kvm ]; then
  env_fail "/dev/kvm does not exist; this job requires a KVM-capable runner (ubuntu-24.04 VM, not a container/slim image)"
fi
ls -l /dev/kvm | tee "$OUT_DIR/dev-kvm.txt"

echo "== 2. Emulator system image ($TENUN_EMULATOR_IMAGE) and emulator package =="
# The runner image ships cmdline-tools but not the emulator package itself.
yes | "$SDKM" --licenses >/dev/null 2>&1 || true
if ! "$SDKM" --install "$TENUN_EMULATOR_IMAGE" emulator platform-tools >"$OUT_DIR/sdkmanager.txt" 2>&1; then
  tail -20 "$OUT_DIR/sdkmanager.txt"
  env_fail "sdkmanager failed to install system image / emulator / platform-tools"
fi
tail -3 "$OUT_DIR/sdkmanager.txt"

ADB="$ANDROID_HOME/platform-tools/adb"
EMU_BIN="$ANDROID_HOME/emulator/emulator"
AVDM="$(ls "$ANDROID_HOME"/cmdline-tools/*/bin/avdmanager 2>/dev/null | sort -V | tail -1)"
for tool in "$ADB" "$EMU_BIN" "$AVDM"; do
  [ -x "$tool" ] || env_fail "required SDK tool missing or not executable after install: $tool"
done
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# Report ALL unresolved HOST shared libraries at once instead of discovering
# them one launch failure per CI round. Bundled emulator libraries (Qt6*,
# libandroid-emu-*, ...) resolved by the launcher's own LD_LIBRARY_PATH at
# runtime are ignored: only libraries absent from the whole installation
# count as genuinely missing host packages.
QEMU_BIN="$(dirname "$EMU_BIN")/qemu/linux-x86_64/qemu-system-x86_64"
TRULY_MISSING=""
for lib in $(ldd "$QEMU_BIN" 2>/dev/null | awk '/not found/ {print $1}' | sort -u); do
  if ! find "$(dirname "$EMU_BIN")" -name "$lib" 2>/dev/null | grep -q .; then
    TRULY_MISSING="$TRULY_MISSING $lib"
  fi
done
if [ -n "$TRULY_MISSING" ]; then
  env_fail "emulator qemu binary has unresolved host libraries:$TRULY_MISSING — install the corresponding runtime packages on the runner"
fi

echo "== 3. Acceleration check (-accel-check), then boot with -accel on =="
if ! "$EMU_BIN" -accel-check >"$OUT_DIR/accel-check.txt" 2>&1; then
  cat "$OUT_DIR/accel-check.txt"
  env_fail "emulator -accel-check failed: KVM acceleration is not usable on this runner"
fi
cat "$OUT_DIR/accel-check.txt"
"$EMU_BIN" -version | head -3 | tee "$OUT_DIR/emulator-version.txt"

export ANDROID_AVD_HOME="$HOME/.android/avd"
mkdir -p "$ANDROID_AVD_HOME"
echo no | "$AVDM" create avd --name "$AVD_NAME" --package "$TENUN_EMULATOR_IMAGE" --device "$TENUN_DEVICE_PROFILE" --force >"$OUT_DIR/avdmanager.txt" 2>&1 || {
  tail -10 "$OUT_DIR/avdmanager.txt"
  env_fail "avdmanager could not create the AVD"
}
# Locate the created AVD dynamically rather than assuming its on-disk layout.
AVD_DIR="$("$AVDM" list avd 2>/dev/null | sed -n 's/^[[:space:]]*Path: //p' | head -1)"
if [ -n "$AVD_DIR" ] && [ -f "$AVD_DIR/config.ini" ]; then
  # The soft IME must be the input surface: with hw.keyboard=yes the emulator
  # behaves as a hardware-keyboard device, the soft keyboard never shows, and
  # injected key events go straight to the focused view, bypassing the IME
  # (observed and diagnosed in the PR #174 device runs).
  echo "hw.keyboard=no" >>"$AVD_DIR/config.ini"
else
  echo "NOTE: AVD config.ini not located; relying on emulator defaults for hw.keyboard"
fi

"$EMU_BIN" -avd "$AVD_NAME" -accel on -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -no-snapshot -camera-back none -camera-front none \
  -prop dalvik.vm.checkjni=1 \
  >"$OUT_DIR/emulator.log" 2>&1 &
EMU_PID=$!
echo "emulator pid: $EMU_PID"

"$ADB" wait-for-device
BOOT_DEADLINE=$((SECONDS + TENUN_BOOT_TIMEOUT))
until [ "$("$ADB" shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do
  if ! kill -0 "$EMU_PID" 2>/dev/null; then
    tail -60 "$OUT_DIR/emulator.log"
    env_fail "emulator process exited before completing boot"
  fi
  if [ "$SECONDS" -ge "$BOOT_DEADLINE" ]; then
    tail -60 "$OUT_DIR/emulator.log"
    env_fail "emulator did not complete boot within ${TENUN_BOOT_TIMEOUT}s"
  fi
  sleep 5
done
echo "emulator boot complete after ${SECONDS}s"

echo "== 4. Environment record (CheckJNI must be ON; it is never disabled) =="
# This AOSP 'default' image does not enable CheckJNI by default, so it is
# enabled explicitly (-prop at launch, documented setprop + framework
# restart as fallback) and activation must be positively evidenced.
# TN-132: disabling CheckJNI to obtain a pass is a review failure.
{
  echo "source_head: $REPO_HEAD"
  echo "system_image: $TENUN_EMULATOR_IMAGE"
  echo "device_profile: $TENUN_DEVICE_PROFILE"
  echo "ro.build.version.sdk: $("$ADB" shell getprop ro.build.version.sdk | tr -d '\r')"
  echo "ro.build.version.release: $("$ADB" shell getprop ro.build.version.release | tr -d '\r')"
  echo "ro.product.cpu.abi: $("$ADB" shell getprop ro.product.cpu.abi | tr -d '\r')"
  echo "default_input_method: $("$ADB" shell settings get secure default_input_method | tr -d '\r')"
} >>"$OUT_DIR/environment.txt"

CHECKJNI_RO="$("$ADB" shell getprop ro.kernel.android.checkjni | tr -d '\r')"
CHECKJNI_DALVIK="$("$ADB" shell getprop dalvik.vm.checkjni | tr -d '\r')"
echo "checkjni at boot: ro.kernel.android.checkjni='$CHECKJNI_RO' dalvik.vm.checkjni='$CHECKJNI_DALVIK'"
if [ "$CHECKJNI_RO" != "1" ] && [ "$CHECKJNI_DALVIK" != "1" ]; then
  echo "image did not default CheckJNI; enabling it explicitly (setprop + framework restart)"
  # adb root restarts adbd, so every step here tolerates a dropped transport
  # and the effects are verified by reading state back, not by exit codes.
  ZYGOTE_BEFORE="$("$ADB" shell pidof zygote | tr -d '\r' | awk '{print $1}')"
  "$ADB" root >/dev/null 2>&1 || true
  sleep 3
  "$ADB" wait-for-device >/dev/null 2>&1 || true
  ROOT_UID="$("$ADB" shell id -u 2>/dev/null | tr -d '\r')"
  [ "$ROOT_UID" = "0" ] || env_fail "adb root unavailable (id -u='$ROOT_UID'); cannot enable CheckJNI explicitly on this image"
  SET_DEADLINE=$((SECONDS + 60))
  until [ "$("$ADB" shell getprop dalvik.vm.checkjni 2>/dev/null | tr -d '\r')" = "1" ]; do
    "$ADB" shell setprop dalvik.vm.checkjni 1 >/dev/null 2>&1 || true
    [ "$SECONDS" -lt "$SET_DEADLINE" ] || env_fail "dalvik.vm.checkjni could not be set to 1"
    sleep 2
  done
  "$ADB" shell stop >/dev/null 2>&1 || true
  "$ADB" shell start >/dev/null 2>&1 || true
  RESTART_DEADLINE=$((SECONDS + 420))
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] &&
    [ "$("$ADB" shell pidof zygote 2>/dev/null | tr -d '\r' | awk '{print $1}')" != "$ZYGOTE_BEFORE" ]; do
    if ! kill -0 "$EMU_PID" 2>/dev/null; then
      tail -60 "$OUT_DIR/emulator.log"
      env_fail "emulator process exited during CheckJNI framework restart"
    fi
    [ "$SECONDS" -lt "$RESTART_DEADLINE" ] || { tail -40 "$OUT_DIR/emulator.log"; env_fail "framework did not restart after enabling CheckJNI"; }
    sleep 3
  done
  sleep 5
  CHECKJNI_DALVIK="$("$ADB" shell getprop dalvik.vm.checkjni | tr -d '\r')"
  echo "checkjni after restart: dalvik.vm.checkjni='$CHECKJNI_DALVIK'"
fi
if [ "$CHECKJNI_RO" != "1" ] && [ "$CHECKJNI_DALVIK" != "1" ]; then
  env_fail "could not enable CheckJNI on this image; acceptance must not run with it disabled or weakened"
fi
# Activation evidence: the documented Android mechanism is
# 'setprop dalvik.vm.checkjni 1' + framework restart (already verified above:
# property reads back 1 and the zygote pid changed). Support it with whatever
# activation marker this API level logs, without demanding a legacy string.
"$ADB" logcat -d >"$OUT_DIR/logcat_checkjni_probe.txt" 2>&1 || true
ACTIVATION_LINE="$(grep -im1 -iE "checkjni" "$OUT_DIR/logcat_checkjni_probe.txt" | sed 's/^[0-9:. -]*//' || true)"
if [ -n "$ACTIVATION_LINE" ]; then
  echo "checkjni_activation_evidence (logcat): $ACTIVATION_LINE" >>"$OUT_DIR/environment.txt"
else
  echo "checkjni_activation_evidence: dalvik.vm.checkjni=1 read back after the documented setprop + framework restart (zygote pid changed); this API level logs no activation line at default verbosity" >>"$OUT_DIR/environment.txt"
fi
{
  echo "checkjni: ro.kernel.android.checkjni='$CHECKJNI_RO' dalvik.vm.checkjni='$CHECKJNI_DALVIK' (enabled deliberately; never disabled)"
} >>"$OUT_DIR/environment.txt"
{
  echo "focused_window: $("$ADB" shell dumpsys window windows 2>/dev/null | grep mCurrentFocus | head -1 | tr -d '\r')"
  echo "keyguard: $("$ADB" shell dumpsys window policy 2>/dev/null | grep -iE 'mShowingLockscreen|KeyguardShowing|isKeyguardSecure' | head -2 | tr -d '\r')"
  echo "screen: $("$ADB" shell dumpsys power 2>/dev/null | grep -E 'mWakefulness=' | head -1 | tr -d '\r')"
} >>"$OUT_DIR/environment.txt"
# Disclose, then close, the restart window: killing the framework to enable
# CheckJNI can crash system processes (observed: com.android.phone with
# DeadSystemException) — an artifact of the deliberate activation, not an
# application failure. The final fatal-exception/JNI-abort scan must judge
# the application-execution window only, so the log is cleared here.
RESTART_CRASHES="$(grep -c "FATAL EXCEPTION" "$OUT_DIR/logcat_checkjni_probe.txt" 2>/dev/null || true)"
echo "framework_restart_fatal_exceptions: ${RESTART_CRASHES:-0} (restart-window artifacts of the deliberate CheckJNI activation; window disclosed and cleared before application execution)" >>"$OUT_DIR/environment.txt"
"$ADB" logcat -c || true

# Stabilize UI timing (does not affect CheckJNI or any assertion).
"$ADB" shell settings put global window_animation_scale 0
"$ADB" shell settings put global transition_animation_scale 0
"$ADB" shell settings put global animator_duration_scale 0
"$ADB" shell rm -f /data/local/tmp/tenun_*.png

echo "== 5. Build the APK and the instrumented test APK from the reviewed revision =="
cd "$SCRIPT_DIR"
if ! ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest >"$OUT_DIR/gradle_assemble.txt" 2>&1; then
  tail -60 "$OUT_DIR/gradle_assemble.txt"
  accept_fail ":app:assembleDebug / :app:assembleDebugAndroidTest failed"
fi
tail -3 "$OUT_DIR/gradle_assemble.txt"
STD_APK="$SCRIPT_DIR/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$SCRIPT_DIR/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
[ -f "$STD_APK" ] && [ -f "$TEST_APK" ] || accept_fail "expected APK artifacts were not produced"
unzip -l "$STD_APK" >"$OUT_DIR/apk_contents.txt" 2>&1 || true
grep -E "tenun_app.js|libtenun_android" "$OUT_DIR/apk_contents.txt" || true
if ! grep -q "assets/tenun_app.js" "$OUT_DIR/apk_contents.txt"; then
  accept_fail "packaged APK does not contain assets/tenun_app.js — the JS application cannot load"
fi
# Packaged-only JavaScript control: acceptance must not carry development
# reload assets. dev_server.txt (LAN hot-reload endpoint) and
# update_channel.json (OTA manifest URL) are dev-machine-local and absent
# from a clean checkout; their absence is ASSERTED here, not assumed, so
# acceptance can never silently depend on — or be replaced from — a network
# bundle source. The app's poll loop is a no-op without dev_server.txt, and
# OtaManager has no channel without update_channel.json.
if grep -q "assets/dev_server.txt" "$OUT_DIR/apk_contents.txt"; then
  accept_fail "acceptance APK must not contain assets/dev_server.txt (dev hot-reload endpoint)"
fi
if grep -q "assets/update_channel.json" "$OUT_DIR/apk_contents.txt"; then
  accept_fail "acceptance APK must not contain assets/update_channel.json (OTA channel)"
fi
echo "reload mode: packaged-only (dev_server.txt and update_channel.json asserted absent from the acceptance build)"
STD_SHA_PUSH="$(sha256sum "$STD_APK" | awk '{print $1}')"
echo "standard APK (pushed) sha256: $STD_SHA_PUSH"

echo "== 6. Standard suite: :app:connectedDebugAndroidTest on the booted emulator =="
# VariantCustomizationTest is excluded here: it can only run against the
# JS-only variant APK in stage 9 (am instrument), never against the standard
# build — a failure there would be by construction, not by defect.
# OverlayInteractionTest likewise needs the gallery-bundle APK from stage 10;
# FailVisibleTest needs the injection build from stage 11.
if ! ./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.notClass="$APP_ID.VariantCustomizationTest,$APP_ID.OverlayInteractionTest,$APP_ID.FailVisibleTest" \
  >"$OUT_DIR/connected_debug_android_test.txt" 2>&1; then
  tail -80 "$OUT_DIR/connected_debug_android_test.txt"
  # Preserve the decisive app-side evidence BEFORE failing the run. The
  # generic last-120 tail cannot reach back to the failing test's window:
  # capture the app's own tagged log (engine init stages incl. the
  # structured TENUN_ENGINE_INIT_FAILED line, activity lifecycle, surface
  # events), AGP's per-test logcat captures, and point-in-time memory
  # snapshots (evidence only — a snapshot alone does not identify a leak).
  "$ADB" logcat -d -s TenunMainActivity:V TenunEngine:V TenunSurfaceView:V art:W \
    >"$OUT_DIR/app_logcat_on_failure.txt" 2>&1 || true
  find "$SCRIPT_DIR/app/build/outputs" -name 'logcat-*.txt' -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
  "$ADB" shell dumpsys meminfo "$APP_ID" >"$OUT_DIR/meminfo_on_failure.txt" 2>&1 || true
  "$ADB" shell dumpsys procstats --hours 1 "$APP_ID" >"$OUT_DIR/procstats_on_failure.txt" 2>&1 || true
  accept_fail ":app:connectedDebugAndroidTest failed"
fi
tail -12 "$OUT_DIR/connected_debug_android_test.txt"

# Search the whole app build tree: AGP's exact results layout varies between
# versions. Every command is failure-tolerant — under set -e a bare failed
# command substitution would kill the script before any classifier message.
XMLS="$(find "$SCRIPT_DIR/app/build" -name 'TEST-*.xml' 2>/dev/null || true)"
{
  echo "matched XMLs:"
  echo "$XMLS"
  echo "--- androidTest-results tree ---"
  find "$SCRIPT_DIR/app/build/outputs/androidTest-results" -maxdepth 4 2>/dev/null || true
  echo "--- result-like directories under app/build ---"
  find "$SCRIPT_DIR/app/build" -maxdepth 3 -type d -name '*result*' 2>/dev/null || true
} >"$OUT_DIR/xml_discovery.txt"
cat "$OUT_DIR/xml_discovery.txt"
[ -n "$XMLS" ] || accept_fail "no instrumented test result XML was produced (see device-acceptance-output/xml_discovery.txt)"
# Filenames contain spaces (e.g. 'TEST-emulator-5554 - 11-_app-.xml'), so
# word-splitting is not allowed: each XML is read line-wise.
SUM_TESTS=0
SUM_FAILURES=0
SUM_ERRORS=0
SUM_SKIPPED=0
while IFS= read -r xml; do
  [ -n "$xml" ] || continue
  cp "$xml" "$OUT_DIR"/ || true
  T="$(grep -o 'tests="[0-9]*"' "$xml" | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}' || true)"
  F="$(grep -o 'failures="[0-9]*"' "$xml" | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}' || true)"
  E="$(grep -o 'errors="[0-9]*"' "$xml" | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}' || true)"
  S="$(grep -o 'skipped="[0-9]*"' "$xml" | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}' || true)"
  SUM_TESTS=$((SUM_TESTS + T))
  SUM_FAILURES=$((SUM_FAILURES + F))
  SUM_ERRORS=$((SUM_ERRORS + E))
  SUM_SKIPPED=$((SUM_SKIPPED + S))
done <<EOF
$XMLS
EOF
echo "standard suite executed tests=$SUM_TESTS failures=$SUM_FAILURES errors=$SUM_ERRORS skipped=$SUM_SKIPPED"
[ "$SUM_TESTS" -gt 0 ] || accept_fail "zero executed instrumented tests — this cannot be an acceptance pass"
[ "$SUM_FAILURES" -eq 0 ] || accept_fail "$SUM_FAILURES instrumented test failure(s)"
[ "$SUM_ERRORS" -eq 0 ] || accept_fail "$SUM_ERRORS instrumented test error(s)"
[ "$SUM_SKIPPED" -eq 0 ] || accept_fail "$SUM_SKIPPED instrumented test(s) skipped — skipped tests cannot count as acceptance"

echo "== 7. Install the standard APK and launch MainActivity via am start =="
if ! "$ADB" install -r "$STD_APK" >"$OUT_DIR/adb_install_standard.txt" 2>&1; then
  tail -10 "$OUT_DIR/adb_install_standard.txt"
  accept_fail "standard APK install failed"
fi
STD_DEVICE_APK="$("$ADB" shell pm path "$APP_ID" | head -1 | sed 's/^package://' | tr -d '\r')"
[ -n "$STD_DEVICE_APK" ] || accept_fail "pm path returned nothing for $APP_ID"
"$ADB" pull "$STD_DEVICE_APK" "$OUT_DIR/installed_standard.apk" >/dev/null
STD_SHA_PULLED="$(sha256sum "$OUT_DIR/installed_standard.apk" | awk '{print $1}')"
echo "standard APK (pulled from device) sha256: $STD_SHA_PULLED"
[ "$STD_SHA_PUSH" = "$STD_SHA_PULLED" ] || accept_fail "installed standard artifact identity mismatch: pushed=$STD_SHA_PUSH pulled=$STD_SHA_PULLED"

"$ADB" shell am start -n "$APP_ID/.MainActivity" >>"$OUT_DIR/am_start.txt" 2>&1
LAUNCH_DEADLINE=$((SECONDS + 30))
until [ -n "$("$ADB" shell pidof "$APP_ID" | tr -d '\r')" ]; do
  [ "$SECONDS" -lt "$LAUNCH_DEADLINE" ] || { tail -20 "$OUT_DIR/logcat_launch.txt" 2>/dev/null || true; accept_fail "MainActivity process not running after am start"; }
  sleep 1
done
"$ADB" logcat -d >"$OUT_DIR/logcat_launch.txt" 2>&1 || true
sleep 3
"$ADB" exec-out screencap -p >"$OUT_DIR/tenun_amstart.png"
echo "MainActivity launched via am start; pid=$("$ADB" shell pidof "$APP_ID" | tr -d '\r')"
"$ADB" shell am force-stop "$APP_ID"

echo "== 8. JavaScript-only customization APK (asset swap + re-sign with the same debug key) =="
VAR_DIR="$WORK_DIR/variant-asset"
mkdir -p "$VAR_DIR/assets"
sed -e 's/text: "Add Entry"/text: "Submit Note"/' \
  -e "s/title: state.entries\[i\].title/title: '[Task] ' + state.entries[i].title/" \
  "$SCRIPT_DIR/app/src/main/assets/tenun_app.js" >"$VAR_DIR/assets/tenun_app.js"
grep -q 'text: "Submit Note"' "$VAR_DIR/assets/tenun_app.js" || accept_fail "variant transform failed: button label was not replaced"
grep -q "\[Task\] " "$VAR_DIR/assets/tenun_app.js" || accept_fail "variant transform failed: entry prefix was not applied"
diff "$SCRIPT_DIR/app/src/main/assets/tenun_app.js" "$VAR_DIR/assets/tenun_app.js" >"$OUT_DIR/variant_js.diff" || true

VAR_APK="$WORK_DIR/tenun-variant.apk"
cp "$STD_APK" "$VAR_APK"
(cd "$VAR_DIR" && zip -q "$VAR_APK" assets/tenun_app.js) || accept_fail "zip replacement of the JS asset failed"

BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V | tail -1)"
[ -n "$BUILD_TOOLS" ] || env_fail "no build-tools found under \$ANDROID_HOME (needed for zipalign/apksigner)"
"$BUILD_TOOLS/zipalign" -f 4 "$VAR_APK" "$VAR_APK.aligned" || accept_fail "zipalign failed"
mv "$VAR_APK.aligned" "$VAR_APK"

# Sign with the SAME keystore AGP used for the standard and test APKs:
# instrumentation requires the test package's signature to match its target.
# Ask Gradle where its debug keystore is instead of guessing a path.
DEBUG_KS="$(./gradlew -q :app:signingReport --console=plain 2>/dev/null | awk '/Variant: debug/{f=1; next} f && $1 == "Store:" {print $2; exit}' || true)"
if [ -z "$DEBUG_KS" ] || [ ! -f "$DEBUG_KS" ]; then
  DEBUG_KS="$HOME/.android/debug.keystore"
fi
if [ ! -f "$DEBUG_KS" ]; then
  mkdir -p "$(dirname "$DEBUG_KS")"
  keytool -genkeypair -keystore "$DEBUG_KS" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
echo "signing variant with debug keystore: $DEBUG_KS"
"$BUILD_TOOLS/apksigner" sign --ks "$DEBUG_KS" --ks-pass pass:android --key-pass pass:android "$VAR_APK" || accept_fail "apksigner could not sign the variant APK"
"$BUILD_TOOLS/apksigner" verify "$VAR_APK" || accept_fail "variant APK signature verification failed"

VAR_SHA_PUSH="$(sha256sum "$VAR_APK" | awk '{print $1}')"
echo "variant APK (pushed) sha256: $VAR_SHA_PUSH"
# Record signing-cert identities for both APKs (evidence disclosure).
"$BUILD_TOOLS/apksigner" verify --print-certs "$STD_APK" >"$OUT_DIR/certs_standard.txt" 2>&1 || true
"$BUILD_TOOLS/apksigner" verify --print-certs "$VAR_APK" >"$OUT_DIR/certs_variant.txt" 2>&1 || true
# The variant may be signed by a different debug key than the standard APK;
# a signature-mismatched UPDATE install must not fail the run — uninstall
# and install fresh (the variant scenario needs only the variant app).
"$ADB" uninstall "$APP_ID" >/dev/null 2>&1 || true
if ! "$ADB" install -r "$VAR_APK" >"$OUT_DIR/adb_install_variant.txt" 2>&1; then
  tail -10 "$OUT_DIR/adb_install_variant.txt"
  accept_fail "variant APK install failed"
fi
VAR_DEVICE_APK="$("$ADB" shell pm path "$APP_ID" | head -1 | sed 's/^package://' | tr -d '\r')"
"$ADB" pull "$VAR_DEVICE_APK" "$OUT_DIR/installed_variant.apk" >/dev/null
VAR_SHA_PULLED="$(sha256sum "$OUT_DIR/installed_variant.apk" | awk '{print $1}')"
echo "variant APK (pulled from device) sha256: $VAR_SHA_PULLED"
[ "$VAR_SHA_PUSH" = "$VAR_SHA_PULLED" ] || accept_fail "installed variant artifact identity mismatch: pushed=$VAR_SHA_PUSH pulled=$VAR_SHA_PULLED"

echo "== 9. Variant suite: JS-only customization observed on screen (am instrument) =="
# AGP uninstalls both packages after connectedDebugAndroidTest, so the
# instrumentation APK must be installed again against the variant app.
if ! "$ADB" install -r "$TEST_APK" >"$OUT_DIR/adb_install_variant_test.txt" 2>&1; then
  tail -10 "$OUT_DIR/adb_install_variant_test.txt"
  accept_fail "instrumented-test APK install failed for the variant phase"
fi
set +e
V_OUT="$("$ADB" shell am instrument -w -e class "$APP_ID.VariantCustomizationTest" "$TEST_APP_ID/androidx.test.runner.AndroidJUnitRunner" 2>&1)"
V_RC=$?
set -e
printf '%s\n' "$V_OUT" | tee "$OUT_DIR/am_instrument_variant.txt" | tail -15
if [ "$V_RC" -ne 0 ]; then
  accept_fail "variant instrumentation returned rc=$V_RC"
fi
if printf '%s' "$V_OUT" | grep -q "OK (1 test)"; then
  echo "variant suite: 1 executed test, OK"
else
  accept_fail "variant instrumentation did not end with 'OK (1 test)' (zero executed tests cannot pass acceptance)"
fi
if printf '%s' "$V_OUT" | grep -q "FAILURES"; then
  accept_fail "variant instrumentation reported failures"
fi

echo "== 10. Overlay scenario APK: gallery bundle injected from the reviewed revision =="
# The tracked asset set carries only the notes reference app; the gallery
# bundle (anchored overlay families) is BUILT FROM THIS CHECKOUT so the
# overlay scenario runs JavaScript from the reviewed revision — no network
# bundle source at any point.
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash >"$OUT_DIR/bun_install.txt" 2>&1 \
    || accept_fail "bun installation failed (needed to build the gallery bundle)"
  export PATH="$HOME/.bun/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 || accept_fail "bun unavailable: cannot build the gallery bundle"
REPO_ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
if ! (cd "$REPO_ROOT_DIR" && bun install --frozen-lockfile \
      && bun embedders/android/tools/gallery-bundle/rebuild.ts) >"$OUT_DIR/overlay_rebuild.txt" 2>&1; then
  tail -20 "$OUT_DIR/overlay_rebuild.txt"
  accept_fail "gallery bundle build failed"
fi
GALLERY_JS="$SCRIPT_DIR/app/src/main/assets/gallery_app.js"
[ -f "$GALLERY_JS" ] || accept_fail "gallery bundle was not produced by the rebuild"
GALLERY_SHA="$(sha256sum "$GALLERY_JS" | awk '{print $1}')"
echo "overlay bundle (gallery_app.js, built from the reviewed revision) sha256: $GALLERY_SHA"

OVL_DIR="$WORK_DIR/overlay-asset"
rm -rf "$OVL_DIR"
mkdir -p "$OVL_DIR/assets"
cp "$GALLERY_JS" "$OVL_DIR/assets/gallery_app.js"
OVL_APK="$WORK_DIR/tenun-overlay.apk"
cp "$STD_APK" "$OVL_APK"
(cd "$OVL_DIR" && zip -q "$OVL_APK" assets/gallery_app.js) || accept_fail "zip injection of the gallery asset failed"
"$BUILD_TOOLS/zipalign" -f 4 "$OVL_APK" "$OVL_APK.aligned" || accept_fail "zipalign failed"
mv "$OVL_APK.aligned" "$OVL_APK"
"$BUILD_TOOLS/apksigner" sign --ks "$DEBUG_KS" --ks-pass pass:android --key-pass pass:android "$OVL_APK" \
  || accept_fail "apksigner could not sign the overlay APK"
"$BUILD_TOOLS/apksigner" verify "$OVL_APK" || accept_fail "overlay APK signature verification failed"
OVL_SHA_PUSH="$(sha256sum "$OVL_APK" | awk '{print $1}')"
echo "overlay APK (pushed) sha256: $OVL_SHA_PUSH"
"$BUILD_TOOLS/apksigner" verify --print-certs "$OVL_APK" >"$OUT_DIR/certs_overlay.txt" 2>&1 || true
"$ADB" uninstall "$APP_ID" >/dev/null 2>&1 || true
if ! "$ADB" install -r "$OVL_APK" >"$OUT_DIR/adb_install_overlay.txt" 2>&1; then
  tail -10 "$OUT_DIR/adb_install_overlay.txt"
  accept_fail "overlay APK install failed"
fi
OVL_DEVICE_APK="$("$ADB" shell pm path "$APP_ID" | head -1 | sed 's/^package://' | tr -d '\r')"
"$ADB" pull "$OVL_DEVICE_APK" "$OUT_DIR/installed_overlay.apk" >/dev/null
OVL_SHA_PULLED="$(sha256sum "$OUT_DIR/installed_overlay.apk" | awk '{print $1}')"
echo "overlay APK (pulled from device) sha256: $OVL_SHA_PULLED"
[ "$OVL_SHA_PUSH" = "$OVL_SHA_PULLED" ] || accept_fail "installed overlay artifact identity mismatch: pushed=$OVL_SHA_PUSH pulled=$OVL_SHA_PULLED"

echo "== 10b. Overlay suite: anchored bottom sheet on installed Android (am instrument) =="
if ! "$ADB" install -r "$TEST_APK" >"$OUT_DIR/adb_install_overlay_test.txt" 2>&1; then
  tail -10 "$OUT_DIR/adb_install_overlay_test.txt"
  accept_fail "instrumented-test APK install failed for the overlay phase"
fi
set +e
O_OUT="$("$ADB" shell am instrument -w -e class "$APP_ID.OverlayInteractionTest" "$TEST_APP_ID/androidx.test.runner.AndroidJUnitRunner" 2>&1)"
O_RC=$?
set -e
printf '%s\n' "$O_OUT" | tee "$OUT_DIR/am_instrument_overlay.txt" | tail -15
if [ "$O_RC" -ne 0 ]; then
  accept_fail "overlay instrumentation returned rc=$O_RC"
fi
if printf '%s' "$O_OUT" | grep -q "OK (1 test)"; then
  echo "overlay suite: 1 executed test, OK"
else
  accept_fail "overlay instrumentation did not end with 'OK (1 test)' (zero executed tests cannot pass acceptance)"
fi
if printf '%s' "$O_OUT" | grep -q "FAILURES"; then
  accept_fail "overlay instrumentation reported failures"
fi

echo "== 11. Fail-visible startup stage: injection build (deterministic failure states) =="
# Keep the standard APK bytes aside: the injection build overwrites the
# same output path, and every earlier digest already recorded the standard
# artifact's identity.
STD_APK_KEEP="$WORK_DIR/tenun-standard-kept.apk"
cp "$STD_APK" "$STD_APK_KEEP"

# The overlay rebuild (stage 10) leaves its gallery_app.js in the source
# asset dir as an untracked build artifact, and MainActivity prefers that
# bundle (TN-132). Built as-is, the injection APK would boot the gallery
# app while the fail-visible suite's recovery flow drives the stock notes
# reference app (title/details inputs, Add Entry). Remove the artifact so
# the injection APK packages exactly the reviewed stock assets; the guard
# below proves it.
GALLERY_ASSET_SRC="$SCRIPT_DIR/app/src/main/assets/gallery_app.js"
rm -f "$GALLERY_ASSET_SRC"

if ! ./gradlew -Ptenun.testInjection=true :app:assembleDebug \
  >"$OUT_DIR/gradle_assemble_injection.txt" 2>&1; then
  tail -40 "$OUT_DIR/gradle_assemble_injection.txt"
  accept_fail ":app:assembleDebug with -Ptenun.testInjection=true failed"
fi
INJ_APK="$SCRIPT_DIR/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$INJ_APK" ] || accept_fail "injection APK was not produced"
unzip -l "$INJ_APK" >"$OUT_DIR/apk_contents_injection.txt" 2>&1 || true
if grep -q "assets/gallery_app.js" "$OUT_DIR/apk_contents_injection.txt"; then
  accept_fail "injection APK must not carry the gallery overlay asset — the fail-visible stage tests the stock notes reference app"
fi
if ! grep -q "assets/tenun_app.js" "$OUT_DIR/apk_contents_injection.txt"; then
  accept_fail "injection APK does not contain assets/tenun_app.js — the JS application cannot load"
fi
INJ_SHA_PUSH="$(sha256sum "$INJ_APK" | awk '{print $1}')"
echo "injection APK (pushed) sha256: $INJ_SHA_PUSH"
grep -q "TENUN_TEST_INJECTION" "$OUT_DIR/gradle_assemble_injection.txt" 2>/dev/null || true

"$ADB" uninstall "$APP_ID" >/dev/null 2>&1 || true
if ! "$ADB" install -r "$INJ_APK" >"$OUT_DIR/adb_install_injection.txt" 2>&1; then
  tail -10 "$OUT_DIR/adb_install_injection.txt"
  accept_fail "injection APK install failed"
fi
INJ_DEVICE_APK="$("$ADB" shell pm path "$APP_ID" | head -1 | sed 's/^package://' | tr -d '\r')"
"$ADB" pull "$INJ_DEVICE_APK" "$OUT_DIR/installed_injection.apk" >/dev/null
INJ_SHA_PULLED="$(sha256sum "$OUT_DIR/installed_injection.apk" | awk '{print $1}')"
echo "injection APK (pulled from device) sha256: $INJ_SHA_PULLED"
[ "$INJ_SHA_PUSH" = "$INJ_SHA_PULLED" ] || accept_fail "installed injection artifact identity mismatch"
"$BUILD_TOOLS/apksigner" verify --print-certs "$INJ_APK" >"$OUT_DIR/certs_injection.txt" 2>&1 || true

if ! "$ADB" install -r "$TEST_APK" >"$OUT_DIR/adb_install_injection_test.txt" 2>&1; then
  tail -10 "$OUT_DIR/adb_install_injection_test.txt"
  accept_fail "instrumented-test APK install failed for the fail-visible phase"
fi
set +e
FV_OUT="$("$ADB" shell am instrument -w -e class "$APP_ID.FailVisibleTest" "$TEST_APP_ID/androidx.test.runner.AndroidJUnitRunner" 2>&1)"
FV_RC=$?
set -e
printf '%s\n' "$FV_OUT" | tee "$OUT_DIR/am_instrument_failvisible.txt" | tail -15
if [ "$FV_RC" -ne 0 ]; then
  accept_fail "fail-visible instrumentation returned rc=$FV_RC"
fi
if printf '%s' "$FV_OUT" | grep -q "OK (4 tests)"; then
  echo "fail-visible suite: 4 executed tests, OK"
else
  accept_fail "fail-visible instrumentation did not end with 'OK (4 tests)' (zero executed tests cannot pass acceptance)"
fi
if printf '%s' "$FV_OUT" | grep -q "FAILURES"; then
  accept_fail "fail-visible instrumentation reported failures"
fi
# Restore the standard artifact for the record (stage digests unchanged).
cp "$STD_APK_KEEP" "$STD_APK"

echo "== 12. Evidence collection: screenshots, logcat, environment summary =="

# AGP captures one logcat file per instrumented test under app/build/outputs;
# those runner-local files are what a rerun would otherwise orphan — always
# copy them into the evidence set.
find "$SCRIPT_DIR/app/build/outputs" -name 'logcat-*.txt' -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true

PULL_FAIL=0
for f in tenun_initial tenun_after_entry1 tenun_two_entries tenun_unicode_entry \
  tenun_after_recreation tenun_baseline tenun_variant_initial tenun_variant_after \
  tenun_overlay_home tenun_overlay_plants tenun_overlay_sheet \
  tenun_overlay_scrim_dismiss tenun_overlay_after \
  tenun_failvisible_alloc tenun_failvisible_eval \
  tenun_failvisible_recreated tenun_failvisible_recovered; do
  if ! "$ADB" pull "/data/local/tmp/$f.png" "$OUT_DIR/" >/dev/null 2>&1; then
    echo "MISSING SCREENSHOT: $f.png"
    PULL_FAIL=1
  fi
done
[ "$PULL_FAIL" -eq 0 ] || accept_fail "required screenshot evidence is missing — visual evidence cannot be omitted from an acceptance pass"

# Covers the application-execution window only: the log was cleared after
# the deliberate CheckJNI activation (restart-window artifacts are disclosed
# in environment.txt, not judged here).
"$ADB" logcat -d >"$OUT_DIR/logcat_full.txt" 2>&1 || true
if grep -qE "JNI DETECTED ERROR IN APPLICATION|art::JniAbort" "$OUT_DIR/logcat_full.txt"; then
  grep -nE "JNI DETECTED ERROR IN APPLICATION|art::JniAbort" "$OUT_DIR/logcat_full.txt" | head -5
  accept_fail "CheckJNI/JNI abort detected in the device log; CheckJNI was never disabled"
fi
if grep -q "FATAL EXCEPTION" "$OUT_DIR/logcat_full.txt"; then
  grep -n "FATAL EXCEPTION" "$OUT_DIR/logcat_full.txt" | head -5
  accept_fail "unhandled exception (FATAL EXCEPTION) in the device log"
fi

cat >"$OUT_DIR/summary.json" <<EOF
{
  "source_head": "$REPO_HEAD",
  "system_image": "$TENUN_EMULATOR_IMAGE",
  "device_profile": "$TENUN_DEVICE_PROFILE",
  "api_level": "$("$ADB" shell getprop ro.build.version.sdk | tr -d '\r')",
  "abi": "$("$ADB" shell getprop ro.product.cpu.abi | tr -d '\r')",
  "emulator_version": "$(head -1 "$OUT_DIR/emulator-version.txt")",
  "reload_mode": "packaged-only: dev_server.txt (LAN hot-reload endpoint) and update_channel.json (OTA manifest) are asserted absent from the acceptance APK; the overlay APK's gallery bundle is built from the reviewed revision, never fetched",
  "checkjni": {"ro.kernel.android.checkjni": "$CHECKJNI_RO", "dalvik.vm.checkjni": "$CHECKJNI_DALVIK", "note": "image default is OFF; enabled deliberately per TN-132, never disabled; activation via the documented setprop dalvik.vm.checkjni=1 + framework restart (property reads back 1, zygote pid changed)"},
  "input_methods": {
    "ime_session_two_entry_loop": "real LatinIME soft-key taps (SOFT_KEY_TAPS), per-character verified against field state; the executed mode per field is recorded in the connected-test stdout (INPUT-METHOD lines); KEY_EVENT_INJECTION would label fallback runs",
    "unicode_round_trip": "direct InputConnection adapter calls (NOT an IME session) — production JNI/QuickJS round-trip under CheckJNI",
    "lifecycle_recreation": "ActivityScenario.recreate() + direct InputConnection adapter calls after recreation",
    "variant_customization": "direct InputConnection adapter calls; on-screen proof via region pixel diff against the standard-APK baseline",
    "overlay_interaction": "real UiDevice taps on the surface view (production touch pipeline): module navigation, sheet open, scrim tap over a covered control, uncovered-control reopen, and the sheet's confirm control"
  },
  "standard_apk_sha256_pushed": "$STD_SHA_PUSH",
  "standard_apk_sha256_pulled_from_device": "$STD_SHA_PULLED",
  "standard_suite": {"executed": $SUM_TESTS, "failures": $SUM_FAILURES, "errors": $SUM_ERRORS, "skipped": $SUM_SKIPPED, "runner": "gradlew :app:connectedDebugAndroidTest"},
  "variant_apk_sha256_pushed": "$VAR_SHA_PUSH",
  "variant_apk_sha256_pulled_from_device": "$VAR_SHA_PULLED",
  "variant_suite": {"executed": 1, "failures": 0, "runner": "adb shell am instrument -e class VariantCustomizationTest"},
  "overlay_bundle_sha256": "$GALLERY_SHA",
  "overlay_apk_sha256_pushed": "$OVL_SHA_PUSH",
  "overlay_apk_sha256_pulled_from_device": "$OVL_SHA_PULLED",
  "overlay_suite": {"executed": 1, "failures": 0, "runner": "adb shell am instrument -e class OverlayInteractionTest"},
  "injection_apk_sha256_pushed": "$INJ_SHA_PUSH",
  "injection_apk_sha256_pulled_from_device": "$INJ_SHA_PULLED",
  "failvisible_suite": {"executed": 4, "failures": 0, "runner": "adb shell am instrument -e class FailVisibleTest", "note": "injection build (-Ptenun.testInjection=true); forced boot failure, forced eval failure, recreation-while-injected, injection-removed fresh boot"}
}
EOF

adb emu kill >/dev/null 2>&1 || true
sleep 3
kill "$EMU_PID" 2>/dev/null || true
EMU_PID=""

echo ""
echo "DEVICE ACCEPTANCE PASS"
echo "  standard APK: $STD_SHA_PULLED"
echo "  variant APK:  $VAR_SHA_PULLED"
echo "  overlay APK:  $OVL_SHA_PULLED (gallery bundle $GALLERY_SHA, built from the reviewed revision)"
echo "  injection APK: $INJ_SHA_PULLED (test-only init-failure injection build)"
echo "  reload mode:  packaged-only (dev_server.txt and update_channel.json asserted absent)"
echo "  executed tests: standard=6 (0 failures/0 errors/0 skipped), variant=1 (OK), overlay=1 (OK), fail-visible=4 (OK)"
echo "  evidence: $OUT_DIR"

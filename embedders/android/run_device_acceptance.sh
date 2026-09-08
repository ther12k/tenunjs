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
APP_ID="id.my.tenun.embedder"
TEST_APP_ID="id.my.tenun.embedder.test"
AVD_NAME="tenun-acceptance"

TENUN_EMULATOR_IMAGE="${TENUN_EMULATOR_IMAGE:-system-images;android-30;default;x86_64}"
TENUN_DEVICE_PROFILE="${TENUN_DEVICE_PROFILE:-pixel}"
TENUN_BOOT_TIMEOUT="${TENUN_BOOT_TIMEOUT:-900}"

ENV_FAIL=90
env_fail() {
  echo "DEVICE-ENVIRONMENT-FAILURE: $*"
  exit "$ENV_FAIL"
}
accept_fail() {
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

# Report ALL unresolved qemu shared libraries at once instead of discovering
# them one launch failure per CI round.
QEMU_BIN="$(dirname "$EMU_BIN")/qemu/linux-x86_64/qemu-system-x86_64"
MISSING_LIBS="$(ldd "$QEMU_BIN" 2>/dev/null | awk '/not found/ {print $1}' | sort -u || true)"
if [ -n "$MISSING_LIBS" ]; then
  env_fail "emulator qemu binary has unresolved shared libraries: $(echo "$MISSING_LIBS" | tr '\n' ' ') — install the corresponding runtime packages on the runner"
fi

echo "== 3. Acceleration check (-accel-check), then boot with -accel on =="
if ! "$EMU_BIN" -accel-check >"$OUT_DIR/accel-check.txt" 2>&1; then
  cat "$OUT_DIR/accel-check.txt"
  env_fail "emulator -accel-check failed: KVM acceleration is not usable on this runner"
fi
cat "$OUT_DIR/accel-check.txt"
"$EMU_BIN" -version | head -3 | tee "$OUT_DIR/emulator-version.txt"

echo no | "$AVDM" create avd --name "$AVD_NAME" --package "$TENUN_EMULATOR_IMAGE" --device "$TENUN_DEVICE_PROFILE" --force >"$OUT_DIR/avdmanager.txt" 2>&1 || {
  tail -10 "$OUT_DIR/avdmanager.txt"
  env_fail "avdmanager could not create the AVD"
}
# Physical-style key events must reach the IME through the input pipeline.
echo "hw.keyboard=yes" >>"$HOME/.android/avd/$AVD_NAME.avd/config.ini"

"$EMU_BIN" -avd "$AVD_NAME" -accel on -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -no-snapshot -camera-back none -camera-front none \
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
{
  echo "source_head: $REPO_HEAD"
  echo "system_image: $TENUN_EMULATOR_IMAGE"
  echo "device_profile: $TENUN_DEVICE_PROFILE"
  echo "ro.build.version.sdk: $("$ADB" shell getprop ro.build.version.sdk | tr -d '\r')"
  echo "ro.build.version.release: $("$ADB" shell getprop ro.build.version.release | tr -d '\r')"
  echo "ro.product.cpu.abi: $("$ADB" shell getprop ro.product.cpu.abi | tr -d '\r')"
  echo "ro.kernel.android.checkjni: $("$ADB" shell getprop ro.kernel.android.checkjni | tr -d '\r')"
  echo "dalvik.vm.checkjni: $("$ADB" shell getprop dalvik.vm.checkjni | tr -d '\r')"
  echo "default_input_method: $("$ADB" shell settings get secure default_input_method | tr -d '\r')"
} | tee "$OUT_DIR/environment.txt"
CHECKJNI="$("$ADB" shell getprop ro.kernel.android.checkjni | tr -d '\r')"
if [ "$CHECKJNI" != "1" ]; then
  env_fail "CheckJNI is not enabled on this emulator image (ro.kernel.android.checkjni='$CHECKJNI'); acceptance must not run with it disabled or weakened"
fi

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
STD_SHA_PUSH="$(sha256sum "$STD_APK" | awk '{print $1}')"
echo "standard APK (pushed) sha256: $STD_SHA_PUSH"

echo "== 6. Standard suite: :app:connectedDebugAndroidTest on the booted emulator =="
if ! ./gradlew :app:connectedDebugAndroidTest >"$OUT_DIR/connected_debug_android_test.txt" 2>&1; then
  tail -80 "$OUT_DIR/connected_debug_android_test.txt"
  accept_fail ":app:connectedDebugAndroidTest failed"
fi
tail -12 "$OUT_DIR/connected_debug_android_test.txt"

XMLS="$(find app/build/outputs/androidTest-results -name 'TEST-*.xml' 2>/dev/null)"
[ -n "$XMLS" ] || accept_fail "no instrumented test result XML was produced"
cp $XMLS "$OUT_DIR"/ || true
SUM_TESTS="$(cat $XMLS | grep -o 'tests="[0-9]*"' | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')"
SUM_FAILURES="$(cat $XMLS | grep -o 'failures="[0-9]*"' | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')"
SUM_ERRORS="$(cat $XMLS | grep -o 'errors="[0-9]*"' | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')"
SUM_SKIPPED="$(cat $XMLS | grep -o 'skipped="[0-9]*"' | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')"
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

DEBUG_KS="$HOME/.android/debug.keystore"
if [ ! -f "$DEBUG_KS" ]; then
  mkdir -p "$HOME/.android"
  keytool -genkeypair -keystore "$DEBUG_KS" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
"$BUILD_TOOLS/apksigner" sign --ks "$DEBUG_KS" --ks-pass pass:android --key-pass pass:android "$VAR_APK" || accept_fail "apksigner could not sign the variant APK"
"$BUILD_TOOLS/apksigner" verify "$VAR_APK" || accept_fail "variant APK signature verification failed"

VAR_SHA_PUSH="$(sha256sum "$VAR_APK" | awk '{print $1}')"
echo "variant APK (pushed) sha256: $VAR_SHA_PUSH"
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

echo "== 10. Evidence collection: screenshots, logcat, environment summary =="
PULL_FAIL=0
for f in tenun_amstart tenun_initial tenun_after_entry1 tenun_two_entries tenun_unicode_entry \
  tenun_after_recreation tenun_baseline tenun_variant_initial tenun_variant_after; do
  if ! "$ADB" pull "/data/local/tmp/$f.png" "$OUT_DIR/" >/dev/null 2>&1; then
    echo "MISSING SCREENSHOT: $f.png"
    PULL_FAIL=1
  fi
done
[ "$PULL_FAIL" -eq 0 ] || accept_fail "required screenshot evidence is missing — visual evidence cannot be omitted from an acceptance pass"

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
  "checkjni": {"ro.kernel.android.checkjni": "$CHECKJNI", "dalvik.vm.checkjni": "$("$ADB" shell getprop dalvik.vm.checkjni | tr -d '\r')"},
  "input_methods": {
    "ime_session_two_entry_loop": "real soft-IME session (LatinIME) driven by synthetic hardware-key events (input text) through the active InputMethodSession",
    "unicode_round_trip": "direct InputConnection adapter calls (NOT an IME session) — production JNI/QuickJS round-trip under CheckJNI",
    "lifecycle_recreation": "ActivityScenario.recreate() + direct InputConnection adapter calls after recreation",
    "variant_customization": "direct InputConnection adapter calls; on-screen proof via region pixel diff against the standard-APK baseline"
  },
  "standard_apk_sha256_pushed": "$STD_SHA_PUSH",
  "standard_apk_sha256_pulled_from_device": "$STD_SHA_PULLED",
  "standard_suite": {"executed": $SUM_TESTS, "failures": $SUM_FAILURES, "errors": $SUM_ERRORS, "skipped": $SUM_SKIPPED, "runner": "gradlew :app:connectedDebugAndroidTest"},
  "variant_apk_sha256_pushed": "$VAR_SHA_PUSH",
  "variant_apk_sha256_pulled_from_device": "$VAR_SHA_PULLED",
  "variant_suite": {"executed": 1, "failures": 0, "runner": "adb shell am instrument -e class VariantCustomizationTest"}
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
echo "  executed tests: standard=$SUM_TESTS (0 failures/0 errors/0 skipped), variant=1 (OK)"
echo "  evidence: $OUT_DIR"

#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="/tmp/tenun-android-test"

mkdir -p "$WORK_DIR"

echo "== 1. Compiling Android native bridge with embedded QuickJS =="
cc -std=c11 -O2 -D_GNU_SOURCE -DTENUN_TEST_INJECTION -DCONFIG_VERSION=\"2024-01-13\" -DCONFIG_BIGNUM \
  -Wall -Wextra -Werror -Wno-sign-compare -Wno-unused-parameter -Wno-implicit-fallthrough \
  -I"$SCRIPT_DIR/app/src/main/cpp" \
  -I"$SCRIPT_DIR/app/src/main/cpp/quickjs" \
  "$SCRIPT_DIR/app/src/main/cpp/tenun_android_bridge.c" \
  "$SCRIPT_DIR/app/src/main/cpp/quickjs/quickjs.c" \
  "$SCRIPT_DIR/app/src/main/cpp/quickjs/cutils.c" \
  "$SCRIPT_DIR/app/src/main/cpp/quickjs/libbf.c" \
  "$SCRIPT_DIR/app/src/main/cpp/quickjs/libregexp.c" \
  "$SCRIPT_DIR/app/src/main/cpp/quickjs/libunicode.c" \
  "$SCRIPT_DIR/src/test/cpp/test_engine_loop.c" \
  -lm -lpthread \
  -o "$WORK_DIR/test_engine_loop"

echo "== 2. Running Android engine execution loop test with real tenun_app.js =="
"$WORK_DIR/test_engine_loop" "$SCRIPT_DIR/app/src/main/assets/tenun_app.js"

# 2b. TN-144: compile the counter sample (TSX) through the bundle
# compiler and boot it in the SAME real QuickJS engine loop — the gate
# that keeps the TSX->QuickJS dev-loop route continuously proven.
command -v bun >/dev/null 2>&1 || {
  echo "FAIL: bun is required to build the TN-144 TSX bundle (verify:android)"
  exit 1
}
(cd "$REPO_ROOT" && bun install --frozen-lockfile)
(cd "$REPO_ROOT" && bun "$SCRIPT_DIR/tools/gallery-bundle/build-counter.mjs" "$WORK_DIR/tsx_counter_app.js")
"$WORK_DIR/test_engine_loop" --tsx "$WORK_DIR/tsx_counter_app.js"

# 2c. TN-154: compile the Polytron Wash companion bundle and boot it
# in the SAME native QuickJS engine loop with the JNI Host Service Bridge.
(cd "$REPO_ROOT" && bun "$SCRIPT_DIR/tools/gallery-bundle/build-polytron.mjs" "$WORK_DIR/polytron_app.js")
"$WORK_DIR/test_engine_loop" --polytron "$WORK_DIR/polytron_app.js"

# 2d. TN-157: the milestone's SAME bundle executes through a browser-protocol
# script driver and the real native QuickJS bridge. Compare complete committed
# scene structure after an identical action sequence. This is execution and
# scene parity evidence, not a device rendering/IME or host-resize claim.
(cd "$REPO_ROOT" && bun examples/framework-feel/scripts/build-host.ts "$WORK_DIR/framework_feel_app.js")
(cd "$REPO_ROOT" && bun examples/framework-feel/scripts/check-host-parity.ts prepare \
  "$WORK_DIR/framework_feel_app.js" "$WORK_DIR/framework_feel_actions.tsv" "$WORK_DIR/framework_feel_browser.jsonl")
"$WORK_DIR/test_engine_loop" --framework-feel "$WORK_DIR/framework_feel_app.js" \
  "$WORK_DIR/framework_feel_actions.tsv" "$WORK_DIR/framework_feel_native.jsonl"
(cd "$REPO_ROOT" && bun examples/framework-feel/scripts/check-host-parity.ts compare \
  "$WORK_DIR/framework_feel_browser.jsonl" "$WORK_DIR/framework_feel_native.jsonl")

ANDROID_SDK="${ANDROID_HOME:-/home/ther12k/Android/Sdk}"
NDK_DIR=$(find "$ANDROID_SDK/ndk" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1 || true)

# 3. If Gradle wrapper and Android SDK are present, test Kotlin IME and assemble APK
if [ -x "$SCRIPT_DIR/gradlew" ] && [ -d "$ANDROID_SDK" ]; then
  echo "== 3. Running Android Gradle unit tests (IME composition & scene sync) =="
  (cd "$SCRIPT_DIR" && export ANDROID_HOME="$ANDROID_SDK" && ./gradlew test)

  # 3b. The :offline-ble module (TN-177) is part of `./gradlew test`
  # above: the PRODUCTION PolytronBleService + GattWriteLedger against
  # hand-written android.* fakes on a virtual-time scheduler.

  echo "== 4. Building packaged Android debug APK (:app:assembleDebug) =="
  (cd "$SCRIPT_DIR" && export ANDROID_HOME="$ANDROID_SDK" && ./gradlew :app:assembleDebug)

  APK_PATH="$SCRIPT_DIR/app/build/outputs/apk/debug/app-debug.apk"
  if [ -f "$APK_PATH" ]; then
    echo "Packaged APK: $APK_PATH ($(ls -lh "$APK_PATH" | awk '{print $5}'))"
    echo "APK SHA-256: $(sha256sum "$APK_PATH" | awk '{print $1}')"
  fi
fi

# 5. Verify NDK cross-compilation for both arm64 and x86_64 targets
if [ -n "$NDK_DIR" ] && [ -d "$NDK_DIR" ]; then
  echo "== 5. Testing Android NDK dual-ABI build ($NDK_DIR) =="
  NDK_CLANG="$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/bin/clang"
  if [ -x "$NDK_CLANG" ]; then
    echo "Using NDK clang: $NDK_CLANG"

    # aarch64 (device target)
    "$NDK_CLANG" --target=aarch64-linux-android26 \
      -std=c11 -O2 -D_GNU_SOURCE -DCONFIG_VERSION=\"2024-01-13\" -DCONFIG_BIGNUM \
      -Wall -Wextra -Werror -Wno-sign-compare -Wno-unused-parameter \
      -fPIC -shared \
      -I"$SCRIPT_DIR/app/src/main/cpp" \
      -I"$SCRIPT_DIR/app/src/main/cpp/quickjs" \
      "$SCRIPT_DIR/app/src/main/cpp/tenun_android_bridge.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/quickjs.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/cutils.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/libbf.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/libregexp.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/libunicode.c" \
      -lm \
      -o "$WORK_DIR/libtenun_android_arm64.so"
    echo "Android NDK arm64 compilation PASS: $WORK_DIR/libtenun_android_arm64.so"

    # x86_64 (emulator target)
    "$NDK_CLANG" --target=x86_64-linux-android26 \
      -std=c11 -O2 -D_GNU_SOURCE -DCONFIG_VERSION=\"2024-01-13\" -DCONFIG_BIGNUM \
      -Wall -Wextra -Werror -Wno-sign-compare -Wno-unused-parameter \
      -fPIC -shared \
      -I"$SCRIPT_DIR/app/src/main/cpp" \
      -I"$SCRIPT_DIR/app/src/main/cpp/quickjs" \
      "$SCRIPT_DIR/app/src/main/cpp/tenun_android_bridge.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/quickjs.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/cutils.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/libbf.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/libregexp.c" \
      "$SCRIPT_DIR/app/src/main/cpp/quickjs/libunicode.c" \
      -lm \
      -o "$WORK_DIR/libtenun_android_x86_64.so"
    echo "Android NDK x86_64 compilation PASS: $WORK_DIR/libtenun_android_x86_64.so"
  fi
fi

echo "ALL ANDROID VERIFICATIONS AND ARTIFACTS PASS"

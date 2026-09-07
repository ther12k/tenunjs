#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="/tmp/tenun-android-test"

mkdir -p "$WORK_DIR"

ANDROID_SDK="${ANDROID_HOME:-/home/ther12k/Android/Sdk}"
NDK_DIR=$(find "$ANDROID_SDK/ndk" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1 || true)
NDK_INCLUDE=""
if [ -n "$NDK_DIR" ]; then
  NDK_INCLUDE="-I$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/include"
fi

JAVA_HOME_DIR="${JAVA_HOME:-$(dirname $(dirname $(readlink -f $(which java 2>/dev/null || echo "/usr/bin/java"))))}"

echo "== 1. Compiling Android native bridge loop test for host =="
cc -std=c11 -Wall -Wextra -Werror \
  -I"$SCRIPT_DIR/app/src/main/cpp" \
  "$SCRIPT_DIR/app/src/main/cpp/tenun_android_bridge.c" \
  "$SCRIPT_DIR/src/test/cpp/test_engine_loop.c" \
  -lpthread \
  -o "$WORK_DIR/test_engine_loop"

echo "== 2. Running Android engine execution loop test =="
"$WORK_DIR/test_engine_loop"

# 3. If Android NDK is detected, verify NDK cross-compilation for Android targets
ANDROID_SDK="${ANDROID_HOME:-/home/ther12k/Android/Sdk}"
NDK_DIR=$(find "$ANDROID_SDK/ndk" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1 || true)

if [ -n "$NDK_DIR" ] && [ -d "$NDK_DIR" ]; then
  echo "== 3. Testing Android NDK build ($NDK_DIR) =="
  NDK_CLANG="$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/bin/clang"
  if [ -x "$NDK_CLANG" ]; then
    echo "Using NDK clang: $NDK_CLANG"

    # aarch64 (device)
    "$NDK_CLANG" --target=aarch64-linux-android26 \
      -std=c11 -Wall -Wextra -Werror -fPIC -shared \
      -I"$SCRIPT_DIR/app/src/main/cpp" \
      "$SCRIPT_DIR/app/src/main/cpp/tenun_android_bridge.c" \
      -o "$WORK_DIR/libtenun_android_arm64.so"
    echo "Android NDK arm64 compilation PASS: $WORK_DIR/libtenun_android_arm64.so"

    # x86_64 (emulator)
    "$NDK_CLANG" --target=x86_64-linux-android26 \
      -std=c11 -Wall -Wextra -Werror -fPIC -shared \
      -I"$SCRIPT_DIR/app/src/main/cpp" \
      "$SCRIPT_DIR/app/src/main/cpp/tenun_android_bridge.c" \
      -o "$WORK_DIR/libtenun_android_x86_64.so"
    echo "Android NDK x86_64 compilation PASS: $WORK_DIR/libtenun_android_x86_64.so"
  fi
fi

echo "ANDROID EMBEDDER VERIFICATION PASS"

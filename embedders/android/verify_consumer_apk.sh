#!/usr/bin/env bash
# Exercises a clean external consumer on an already-booted test emulator.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'usage: %s OUTPUT_DIR\n' "$0" >&2
  exit 2
fi
mkdir -p -- "$1"
OUT_DIR="$(cd -- "$1" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADB="${ADB:-adb}"
APP_ID=id.my.tenun.embedder.pilot

if [ "$("$ADB" shell getprop ro.kernel.qemu | tr -d '\r')" != 1 ]; then
  printf 'Consumer APK verification requires a test emulator.\n' >&2
  exit 1
fi

"$SCRIPT_DIR/../../.github/scripts/verify-consumer.sh" --android-output "$OUT_DIR" \
  2>&1 | tee "$OUT_DIR/consumer-build.log"

cd "$SCRIPT_DIR"
for variant in stock modified; do
  bundle="$OUT_DIR/consumer-$variant.js"
  tasks=(:app:assembleDebug)
  if [ "$variant" = stock ]; then
    tasks+=(:app:assembleDebugAndroidTest)
  fi
  ./gradlew "${tasks[@]}" -Ptenun.pilotBundle="$bundle" --console=plain \
    2>&1 | tee "$OUT_DIR/$variant-gradle.log"
  apk=app/build/outputs/apk/debug/app-debug.apk
  python3 -I - "$apk" "$bundle" <<'PY'
from pathlib import Path
from sys import argv
from zipfile import ZipFile

with ZipFile(argv[1]) as apk:
    assets = sorted(name for name in apk.namelist() if name.startswith("assets/"))
    if assets != ["assets/tenun_app.js"] or apk.read(assets[0]) != Path(argv[2]).read_bytes():
        raise SystemExit("Consumer APK does not contain exactly the selected application bundle")
PY
  "$ADB" install -r "$apk"
  if [ "$variant" = stock ]; then
    "$ADB" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
  fi
  "$ADB" shell am instrument -w \
    -e class id.my.tenun.embedder.ConsumerApkJourneyTest -e consumerVariant "$variant" \
    "$APP_ID.test/androidx.test.runner.AndroidJUnitRunner" | tee "$OUT_DIR/$variant-instrumentation.log"
  grep -Fxq 'OK (1 test)' "$OUT_DIR/$variant-instrumentation.log" || {
    printf 'Expected one passing installed consumer test (%s).\n' "$variant" >&2
    exit 1
  }
done

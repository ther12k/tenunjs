#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/home/ther12k/jdks/jdk-21.0.12.1+1/bin:$PATH"
POLYTRON_DIR="$(dirname "$HERE")"
BUILD_DIR="$HERE/build"
SDK_DIR="${ANDROID_HOME:-/home/ther12k/Android/Sdk}"
BUILD_TOOLS="$SDK_DIR/build-tools/36.1.0"
PLATFORM_JAR="$SDK_DIR/platforms/android-36/android.jar"

echo "=== 1. Bundling Polytron Web App with Bun ==="
mkdir -p "$HERE/assets" "$BUILD_DIR/gen" "$BUILD_DIR/compiled_res" "$BUILD_DIR/obj"
cd "$POLYTRON_DIR"
bun build preview.ts --target=browser --format=esm --outfile="$HERE/assets/preview.js"
cp "$POLYTRON_DIR/index.html" "$HERE/assets/index.html"

echo "=== 2. Compiling Android Resources with aapt2 ==="
"$BUILD_TOOLS/aapt2" compile --dir "$HERE/res" -o "$BUILD_DIR/compiled_res"

echo "=== 3. Linking APK with aapt2 ==="
"$BUILD_TOOLS/aapt2" link \
    -I "$PLATFORM_JAR" \
    --manifest "$HERE/AndroidManifest.xml" \
    --java "$BUILD_DIR/gen" \
    -o "$BUILD_DIR/unaligned.apk" \
    "$BUILD_DIR/compiled_res"/*.flat

echo "=== 4. Compiling Java Sources ==="
javac -encoding UTF-8 -source 17 -target 17 \
    -cp "$PLATFORM_JAR" \
    -d "$BUILD_DIR/obj" \
    "$BUILD_DIR/gen/com/polytron/wash/R.java" \
    "$HERE/src/com/polytron/wash/PolytronBle.java" \
    "$HERE/src/com/polytron/wash/MainActivity.java"

echo "=== 5. Desugaring and generating classes.dex with d8 ==="
"$BUILD_TOOLS/d8" \
    --lib "$PLATFORM_JAR" \
    --output "$BUILD_DIR" \
    "$BUILD_DIR/obj/com/polytron/wash"/*.class

echo "=== 6. Packaging APK ==="
cd "$BUILD_DIR"
cp unaligned.apk staged.apk
"$BUILD_TOOLS/aapt" add staged.apk classes.dex
cd "$HERE"
"$BUILD_TOOLS/aapt" add "$BUILD_DIR/staged.apk" assets/index.html assets/preview.js

echo "=== 7. Aligning and Signing APK ==="
"$BUILD_TOOLS/zipalign" -f -p 4 "$BUILD_DIR/staged.apk" "$POLYTRON_DIR/polytron-wash.apk"

# Generate debug keystore if not present
DEBUG_KEYSTORE="$BUILD_DIR/debug.keystore"
if [ ! -f "$DEBUG_KEYSTORE" ]; then
    keytool -genkey -v -keystore "$DEBUG_KEYSTORE" -storepass android -alias androiddebugkey \
        -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Android Debug,O=Android,C=US"
fi

"$BUILD_TOOLS/apksigner" sign \
    --ks "$DEBUG_KEYSTORE" \
    --ks-pass pass:android \
    --key-pass pass:android \
    --ks-key-alias androiddebugkey \
    --v1-signing-enabled true \
    --v2-signing-enabled true \
    --v3-signing-enabled true \
    "$POLYTRON_DIR/polytron-wash.apk"

echo "=== Build Complete! ==="
ls -lh "$POLYTRON_DIR/polytron-wash.apk"
"$BUILD_TOOLS/apksigner" verify --verbose "$POLYTRON_DIR/polytron-wash.apk"

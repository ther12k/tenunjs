#!/usr/bin/env bash
# TN-185 (ADR-0026 stage 3): cross-build the framework-owned Skia
# rasterizer (engine/render/skia-host) into the app's jniLibs so the
# device gate can dual-render committed scenes through both painters.
#
# rust-skia ships prebuilt binding artifacts for android targets, so this
# takes seconds, not a from-source Skia build.
#
# Usage: build-android.sh <android-triple>...   (default: both ABIs)
# Requires cargo-ndk (cargo install cargo-ndk --locked) and an NDK
# (ANDROID_NDK_HOME, NDK_HOME, or ~/Android/Sdk/ndk/<newest>).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
crate="$repo_root/engine/render/skia-host"
out_root="$repo_root/embedders/android/app/src/main/jniLibs"

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  targets=(aarch64-linux-android x86_64-linux-android)
fi

ndk="${ANDROID_NDK_HOME:-${NDK_HOME:-}}"
if [ -z "$ndk" ]; then
  candidate="$(ls -d "${ANDROID_HOME:-$HOME/Android/Sdk}/ndk/"* 2>/dev/null | sort | tail -1 || true)"
  if [ -n "$candidate" ]; then ndk="$candidate"; fi
fi
if [ -z "$ndk" ]; then
  echo "skia-host build: no NDK found (set ANDROID_NDK_HOME)" >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64) host_tag="linux-x86_64" ;;
  aarch64) host_tag="linux-aarch64" ;;
  *) echo "skia-host build: unsupported host $(uname -m)" >&2; exit 1 ;;
esac

command -v cargo ndk >/dev/null 2>&1 || cargo ndk --version >/dev/null 2>&1 || {
  echo "skia-host build: cargo-ndk missing (cargo install cargo-ndk --locked)" >&2
  exit 1
}

abi_for_triple() {
  case "$1" in
    aarch64-linux-android) echo "arm64-v8a" ;;
    x86_64-linux-android) echo "x86_64" ;;
    *) echo "UNKNOWN" ;;
  esac
}

cd "$crate"
for triple in "${targets[@]}"; do
  abi="$(abi_for_triple "$triple")"
  if [ "$abi" = "UNKNOWN" ]; then
    echo "skia-host build: unsupported target $triple" >&2
    exit 1
  fi
  echo "== skia-host: $triple -> jniLibs/$abi =="
  ANDROID_NDK_HOME="$ndk" cargo ndk -t "$triple" -o "$out_root" build --release
  test -f "$out_root/$abi/libtenun_skia_host.so"
done
echo "skia-host build OK: ${targets[*]}"

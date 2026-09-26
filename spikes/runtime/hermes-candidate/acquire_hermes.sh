#!/usr/bin/env bash
# Acquires and builds the pinned Hermes tree for the slice-1 candidate.
# Pinned: tag v0.13.0 -> commit 4b3bf912cc0f705b51b71ce1a5b8bd79b93a451b.
# (The v0.13.0 tag's CMake still declares project version 0.12.0 and its
# bytecode header defines HBC 96 — the banner mismatch is a property of
# the tagged source; the commit pin is authoritative. Do not patch it.)
#
# Effective build configuration (recorded per review 2026-09-22):
#   -DHERMES_ENABLE_INTL=OFF disables the JavaScript Intl FEATURE.
#   It does NOT remove native ICU dependencies: on this Linux host the
#   build links the system libicuuc.so.74 / libicui18n.so.74 /
#   libicudata (CMake found the release libraries; only the -dev
#   pkg-config metadata was absent). "Intl feature off" != "ICU-free".
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.hermes"
SRC="$ROOT/hermes-src"
BUILD="$ROOT/hermes-build"

if [ ! -x "$BUILD/bin/hermes" ]; then
  mkdir -p "$ROOT"
  if [ ! -d "$SRC/.git" ]; then
    git clone --depth 1 --branch v0.13.0 https://github.com/facebook/hermes.git "$SRC"
  fi
  ACTUAL="$(git -C "$SRC" rev-parse HEAD)"
  EXPECTED="4b3bf912cc0f705b51b71ce1a5b8bd79b93a451b"
  [ "$ACTUAL" = "$EXPECTED" ] || { echo "pin mismatch: $ACTUAL"; exit 1; }
  cmake -S "$SRC" -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DHERMES_ENABLE_INTL=OFF -DHERMES_BUILD_TOOLS=ON
  # RECORDED SOURCE PATCHES (GCC 13 libstdc++ needs explicit includes the
  # clang-built upstream omits; two lines, applied by this script):
  #   1) API/hermes/cdp/DomainState.cpp: +#include <memory>/<string>/<utility>
  #   2) API/hermes/cdp/DomainState.h:   +#include <string>
  grep -q "include <utility>" "$SRC/API/hermes/cdp/DomainState.cpp" || \
    sed -i 's/#include <cassert>/#include <cassert>\n#include <memory>\n#include <string>\n#include <utility>/' "$SRC/API/hermes/cdp/DomainState.cpp"
  grep -q "#include <string>" "$SRC/API/hermes/cdp/DomainState.h" || \
    sed -i 's/#include <optional>/#include <optional>\n#include <string>/' "$SRC/API/hermes/cdp/DomainState.h"
  (cd "$BUILD" && nice -n 10 ninja hermes libhermes)
  echo "RECORDED: $(git -C "$SRC" rev-parse HEAD) $(grep CMAKE_BUILD_TYPE: "$BUILD/CMakeCache.txt") $(grep HERMES_ENABLE_INTL: "$BUILD/CMakeCache.txt")"
  echo "RECORDED-LINKS: $(ldd "$BUILD/bin/hermes" | grep -o 'libicu[a-z]*\.so\.[0-9]*' | sort -u | tr '\n' ' ')"
fi
echo "hermes tree ready: $BUILD"

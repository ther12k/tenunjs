#!/usr/bin/env sh
# Trusted cold-replay chain for quickjs-spike-v3 (never taken from packets).
set -eu

# Deterministic build environment (review-5 strict artifacts): remap every
# environment-specific absolute path to a canonical placeholder so rebuilds
# on different machines produce byte-identical cdylibs.
export RUSTUP_TOOLCHAIN=1.98.0
export RUSTFLAGS="--remap-path-prefix=$PWD=/build --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$(rustc --print sysroot)=/rustc -C link-arg=-Wl,--build-id=none"
export CFLAGS="-g0 -fno-ident -ffile-prefix-map=$PWD=/build"
export CXXFLAGS="-g0 -fno-ident -ffile-prefix-map=$PWD=/build"
cd spikes/runtime/quickjs-candidate
cargo build --release
./target/release/spike-runner
cd ../../..
cc -std=c11 -Wall -Werror -Wextra -Ispikes/runtime \
  spikes/runtime/quickjs-candidate/abi_smoke.c \
  -Lspikes/runtime/quickjs-candidate/target/release -ltenun_js_quickjs \
  -ldl -lm -lpthread \
  -o spikes/runtime/quickjs-candidate/target/release/abi_smoke_c
LD_LIBRARY_PATH=spikes/runtime/quickjs-candidate/target/release \
  spikes/runtime/quickjs-candidate/target/release/abi_smoke_c
bun run benchmarks/architecture/run.ts --label quickjs-spike-v3 \
  --step release-build "cd spikes/runtime/quickjs-candidate && cargo build --release" \
  --step conformance-runner "cd spikes/runtime/quickjs-candidate && ./target/release/spike-runner" \
  --step abi-smoke-compile "cc -std=c11 -Wall -Werror -Wextra -Ispikes/runtime spikes/runtime/quickjs-candidate/abi_smoke.c -Lspikes/runtime/quickjs-candidate/target/release -ltenun_js_quickjs -ldl -lm -lpthread -o spikes/runtime/quickjs-candidate/target/release/abi_smoke_c" \
  --step abi-smoke-run "LD_LIBRARY_PATH=spikes/runtime/quickjs-candidate/target/release spikes/runtime/quickjs-candidate/target/release/abi_smoke_c" \
  --artifact spikes/runtime/quickjs-candidate/target/release/libtenun_js_quickjs.so

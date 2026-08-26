#!/usr/bin/env sh
# Trusted cold-replay chain for quickjs-spike-v3 (never taken from packets).
set -eu
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

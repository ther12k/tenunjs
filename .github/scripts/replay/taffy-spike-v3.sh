#!/usr/bin/env sh
# Trusted cold-replay chain for taffy-spike-v3.
set -eu

# Deterministic build environment (review-5 strict artifacts): remap every
# environment-specific absolute path to a canonical placeholder so rebuilds
# on different machines produce byte-identical cdylibs.
export RUSTFLAGS="--remap-path-prefix=$PWD=/build --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$(rustc --print sysroot)=/rustc -C link-arg=-Wl,--build-id=none"
export CFLAGS="-g0 -fno-ident -ffile-prefix-map=$PWD=/build"
export CXXFLAGS="-g0 -fno-ident -ffile-prefix-map=$PWD=/build"
(cd spikes/layout/taffy-candidate && cargo build --release)
cc -std=c11 -Wall -Werror -Wextra -O2 -Ispikes/layout spikes/layout/run_corpus.c \
  -ldl -lm -pthread -o spikes/layout/taffy-candidate/target/release/run_corpus
bun spikes/layout/export-corpus.ts > spikes/layout/taffy-candidate/target/release/corpus_flat.txt
spikes/layout/taffy-candidate/target/release/run_corpus \
  spikes/layout/taffy-candidate/target/release/corpus_flat.txt \
  spikes/layout/taffy-candidate/target/release/libtenun_layout_taffy.so
bun run benchmarks/architecture/run.ts --label taffy-spike-v3 \
  --step build-lib '(cd spikes/layout/taffy-candidate && cargo build --release)' \
  --step shared-c-driver "cc -std=c11 -Wall -Werror -Wextra -O2 -Ispikes/layout spikes/layout/run_corpus.c -ldl -lm -o spikes/layout/taffy-candidate/target/release/run_corpus && bun spikes/layout/export-corpus.ts > spikes/layout/taffy-candidate/target/release/corpus_flat.txt && spikes/layout/taffy-candidate/target/release/run_corpus spikes/layout/taffy-candidate/target/release/corpus_flat.txt spikes/layout/taffy-candidate/target/release/libtenun_layout_taffy.so" \
  --artifact spikes/layout/taffy-candidate/target/release/libtenun_layout_taffy.so

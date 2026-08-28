#!/usr/bin/env sh
# Trusted cold-replay chain for yoga-spike-v3.
set -eu

# Deterministic build environment (review-5 strict artifacts): remap every
# environment-specific absolute path to a canonical placeholder so rebuilds
# on different machines produce byte-identical cdylibs.
export RUSTUP_TOOLCHAIN=1.98.0
export RUSTFLAGS="--remap-path-prefix=$PWD=/build --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$(rustc --print sysroot)=/rustc -C link-arg=-Wl,--build-id=none"
export CFLAGS="-g0 -fno-ident -ffile-prefix-map=$PWD=/build"
export CXXFLAGS="-g0 -fno-ident -ffile-prefix-map=$PWD=/build"
(cd spikes/layout/yoga-candidate && \
  echo "DBG rustc: $(rustc -vV | grep host) $(rustc -vV | grep release)" && \
  echo "DBG toolchain: ${RUSTUP_TOOLCHAIN:-unset}" && \
  echo "DBG bindgen args: BINDGEN=(${BINDGEN_EXTRA_CLANG_ARGS:-unset}) LIBCLANG=(${LIBCLANG_PATH:-unset})" && \
  BINDGEN_EXTRA_CLANG_ARGS="-I$(gcc -print-file-name=include)" cargo build --release) || { \
    echo "DBG build failed; YGUndefined line:"; \
    grep -o 'YGUndefined[^;]*;' spikes/layout/yoga-candidate/target/release/build/yoga-*/out/bindings.rs | head -1; \
    echo "DBG active rustc: $(rustc -vV | grep release)"; exit 101; }
cc -std=c11 -Wall -Werror -Wextra -O2 -Ispikes/layout spikes/layout/run_corpus.c \
  -ldl -lm -pthread -o spikes/layout/yoga-candidate/target/release/run_corpus
bun spikes/layout/export-corpus.ts > spikes/layout/yoga-candidate/target/release/corpus_flat.txt
spikes/layout/yoga-candidate/target/release/run_corpus \
  spikes/layout/yoga-candidate/target/release/corpus_flat.txt \
  spikes/layout/yoga-candidate/target/release/libtenun_layout_yoga.so
bun run benchmarks/architecture/run.ts --label yoga-spike-v3 \
  --step build-lib '(cd spikes/layout/yoga-candidate && BINDGEN_EXTRA_CLANG_ARGS="-I$(gcc -print-file-name=include)" cargo build --release)' \
  --step shared-c-driver "cc -std=c11 -Wall -Werror -Wextra -O2 -Ispikes/layout spikes/layout/run_corpus.c -ldl -lm -o spikes/layout/yoga-candidate/target/release/run_corpus && bun spikes/layout/export-corpus.ts > spikes/layout/yoga-candidate/target/release/corpus_flat.txt && spikes/layout/yoga-candidate/target/release/run_corpus spikes/layout/yoga-candidate/target/release/corpus_flat.txt spikes/layout/yoga-candidate/target/release/libtenun_layout_yoga.so" \
  --artifact spikes/layout/yoga-candidate/target/release/libtenun_layout_yoga.so

#!/usr/bin/env sh
# Trusted cold-replay chain for yoga-spike-v3.
set -eu
(cd spikes/layout/yoga-candidate && \
  BINDGEN_EXTRA_CLANG_ARGS="-I$(gcc -print-file-name=include)" cargo build --release)
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

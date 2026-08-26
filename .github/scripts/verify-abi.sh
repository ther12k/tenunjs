#!/usr/bin/env bash
# Builds release cdylibs and runs the real C and C++ consumers against them.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== build release cdylibs =="
(cd spikes/layout/yoga-candidate && cargo build --release)
(cd spikes/layout/taffy-candidate && cargo build --release)
(cd spikes/runtime/quickjs-candidate && cargo build --release)

QJS=spikes/runtime/quickjs-candidate

echo "== abi_smoke as C11 =="
cc -std=c11 -Wall -Werror -Wextra -I"$QJS/.." "$QJS/abi_smoke.c" \
  -L"$QJS/target/release" -ltenun_js_quickjs -ldl -lm -lpthread \
  -Wl,-rpath,"$PWD/$QJS/target/release" -o /tmp/abi_smoke_c
/tmp/abi_smoke_c

echo "== abi_smoke as C++17 (extern \"C\" guard proof) =="
cc -std=c++17 -Wall -Werror -Wextra -I"$QJS/.." -x c++ "$QJS/abi_smoke.c" \
  -L"$QJS/target/release" -ltenun_js_quickjs -ldl -lm -lpthread \
  -Wl,-rpath,"$PWD/$QJS/target/release" -o /tmp/abi_smoke_cpp
/tmp/abi_smoke_cpp

echo "== shared layout corpus driver vs both candidates =="
bun spikes/layout/export-corpus.ts > /tmp/corpus_flat.txt
cc -std=c11 -Wall -Werror -Wextra -O2 -Ispikes/layout spikes/layout/run_corpus.c -ldl -lm -pthread -o /tmp/run_corpus
/tmp/run_corpus /tmp/corpus_flat.txt spikes/layout/yoga-candidate/target/release/libtenun_layout_yoga.so
/tmp/run_corpus /tmp/corpus_flat.txt spikes/layout/taffy-candidate/target/release/libtenun_layout_taffy.so

echo "verify-abi PASS"

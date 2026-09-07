#!/usr/bin/env sh
set -eu

out_dir=${1:-/tmp/tenun-native-probe}
mkdir -p "$out_dir"

# CI and local verification must fail if any candidate or assertion fails.
# This is a headless contract probe, not a platform-integration claim.
cc -std=c11 -Wall -Wextra -Werror -Ispikes \
  spikes/native-integration-probe.c -o "$out_dir/probe-c"
c++ -std=c++17 -Wall -Wextra -Werror -Ispikes \
  spikes/native-integration-probe.cc -o "$out_dir/probe-cpp"
rustc --edition=2021 -D warnings spikes/native-integration-probe.rs \
  -o "$out_dir/probe-rust"

for candidate in c cpp rust; do
  echo "== candidate: $candidate =="
  "$out_dir/probe-$candidate"
done

echo "PLATFORM ios=NOT_EXERCISED android=NOT_EXERCISED"
echo "NATIVE INTEGRATION PROBE PASS headless_only=true"

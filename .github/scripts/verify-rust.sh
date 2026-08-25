#!/usr/bin/env bash
# fmt + clippy(-D warnings) + test for every Rust spike crate.
set -euo pipefail
cd "$(dirname "$0")/../.."
for crate in spikes/layout/taffy-candidate spikes/layout/yoga-candidate spikes/runtime/quickjs-candidate; do
  echo "== verify-rust: $crate =="
  (cd "$crate"
    cargo fmt --all --check
    cargo clippy --all-targets -- -D warnings
    cargo test
  )
done
echo "verify-rust PASS"

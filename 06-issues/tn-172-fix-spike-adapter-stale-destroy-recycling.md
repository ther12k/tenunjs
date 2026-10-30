---
okf_version: 0.2
title: "TN-172: Fix the spike adapter's stale-destroy slot recycling"
summary: "registry_release removes the slot's thread-map entry BEFORE checking the generation, so a stale destroy of a recycled slot strips the replacement VM's ownership and leaks it — the 2026-10-27 review's P1 #6."
type: issue
status: ready
issue_id: "TN-172"
milestone: "M1"
priority: "P2"
depends_on:
  - "TN-133"
---

# TN-172 — Fix the spike adapter's stale-destroy slot recycling

## Purpose

The 2026-10-27 review's last unfixed finding (P1 #6, spike-only — the
Android embedder uses the vendored C QuickJS, not this adapter):
`registry_release` in `spikes/runtime/quickjs-candidate/src/lib.rs`
calls `OWNER_VMS.remove(&slot)` and only THEN matches the generation:

```rust
match map.remove(&slot) {
    Some(owned) if owned.generation == generation => Some(owned),
    _ => None, // stale handle — no-op
}
```

When a destroyed slot is recycled (create A → destroy A → create B
reuses the slot with a bumped generation), a late stale `destroy(A)`
removes **B's** entry first and then reports a no-op. B is leaked from
the thread map (never deferred), subsequent resolves of B fail with
ERR_AFFINITY on its own owner thread, and the review's callback-case
probe aborted (134) downstream. The remove-before-check ordering is the
entire defect.

## Required outcome

1. `registry_release` verifies the occupant's generation BEFORE removing
   it; a stale handle leaves the current occupant untouched (true no-op).
2. A regression test through the public adapter API: create A, destroy
   A, create B (slot recycled, generation bumped), stale-destroy A, then
   prove B still evaluates successfully on its owner thread.

## Verification

- The new spike test fails on the pre-fix ordering and passes after.
- `verify:rust` (fmt + clippy + tests) green.
- Because any `spikes/` change stales the inputs digest, all three
  evidence packets are replayed from the main checkout after the source
  commit and `verify:evidence` passes.

## Out of scope

- Any change to shipped Android/C bridge paths (the adapter is the
  evaluation spike only).
- The deferred-VM parking policy itself (unchanged).

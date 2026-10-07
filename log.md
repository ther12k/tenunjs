---
okf_version: 0.2
title: "TenunJS Design Log"
summary: "Chronological record of material design changes."
type: log
status: accepted
---

# Design log

## v0.3 — consumer-feedback arc (2026-10)

- Promoted `examples/votol` to the first-class sample app (PR #215) and formalized the external consumer feedback as a validation record.
- Reordered execution contracts-first as a roadmap overlay: capability-seam contracts (TN-141, PR #221), host-to-runtime push channel (TN-142, PR #222), and a TSX-compiled example bundle in the `verify:android` engine loop (TN-144, PR #224) — the dev-loop exit the first consumer fell off.
- Issue lifecycle statuses are now governed: a closed issue requires an evidence status note, enforced by the manifest gate; twelve issues backfilled closed with evidence.
- ADR-0023: a physical Android phone entered the dev loop (2026-09-30); Android-half device evidence work is unblocked while the M0 selection gates stay blocked on matched iOS evidence.

## v0.2 — native Skia correction

- Reclassified TenunJS as a mobile-native framework rather than an HTML-first web framework.
- Made Skia a mandatory v0.x renderer.
- Kept TypeScript + TSX as the public application language.
- Removed Rust as a predetermined engine requirement.
- Added matched C++/Rust, QuickJS-NG/Hermes, and Yoga/Taffy architecture gates.
- Added iOS/Android IME, accessibility, platform-view, packaging, and store-release work.
- Replaced HTTP/DOM patch semantics with typed local actions and atomic native mutation transactions.

## v0.1 — superseded baseline

The earlier HTML/hypermedia design is retained only as historical context and must not guide mobile implementation.

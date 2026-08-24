---
okf_version: 0.2
title: "TenunJS Design Log"
summary: "Chronological record of material design changes."
type: log
status: accepted
---

# Design log

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

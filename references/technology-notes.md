---
okf_version: 0.2
title: "Technology Notes and Primary References"
summary: "Primary technology facts that informed the architecture gates."
type: reference
status: accepted
---

# Technology notes

This pack deliberately avoids treating implementation candidates as product identity.

## Skia

Skia is a native C++ 2D graphics library used across multiple operating systems and GPU backends. This makes C++ the shortest direct integration path, but not automatically the lowest total maintenance cost.

## rust-skia

Rust bindings provide a credible Rust route to Skia, including GPU/mobile use. The M0 spike must measure binding build cost, symbolication, platform packaging, and contributor experience rather than assuming safety benefits are free.

## Yoga and Taffy

Yoga offers a C/C++-friendly Flexbox-oriented engine with a public C interface. Taffy is a Rust layout library supporting Flexbox, Grid, and Block. TenunJS exposes neither; conformance and integration evidence select the first backend.

## QuickJS-NG and Hermes

QuickJS-NG is designed as a small embeddable JavaScript engine. Hermes is optimized around React Native/mobile concerns and bytecode/startup behavior. TenunJS evaluates both through its own host contract and representative controller/reconciliation workloads.

## Platform text and accessibility

Editable text must participate in UIKit and Android input-method protocols. Accessibility must expose semantics through VoiceOver and TalkBack platform APIs. Canvas pixels alone do not satisfy these contracts.

Primary source URLs should be pinned with retrieval dates in the repository’s dependency/architecture evidence during TN-003 and the M0 spike issues.

---
okf_version: 0.2
title: "Language Strategy"
summary: "How languages are selected by subsystem without exposing them to application authors."
type: architecture
status: accepted
---

# Language strategy

## Fixed language

TypeScript and TSX are fixed for application code, the public API, compiler tooling, controller logic, and most developer-facing packages.

## Evidence-selected native core

The shared native engine begins only after matched C++20 and Rust spikes implement the same vertical slice:

- Embedded JS host
- TSX-driven `View`, `Text`, and `Pressable`
- Layout
- Skia surface and frame
- Touch event round trip
- iOS and Android physical-device build
- Symbolized intentional crash
- Incremental rebuild measurement
- Sanitizer/static-analysis run

The scorecard weights total development cost:

| Dimension | Weight |
|---|---:|
| iOS/Android integration effort | 20% |
| Skia/runtime/layout integration | 15% |
| Correctness and memory safety | 15% |
| Debugging and crash diagnosis | 15% |
| Build reproducibility and CI time | 10% |
| Runtime performance and memory | 10% |
| Contributor learning/maintenance | 10% |
| Ecosystem and long-term risk | 5% |

C++ is the provisional integration front-runner because Skia is natively C++ and several candidate dependencies expose C/C++ interfaces. Rust is the safety challenger and may win if its binding/build cost remains controlled. The ADR records evidence; this document does not preselect the winner.

## Platform languages

Swift/Objective-C++ and Kotlin/JNI remain thin platform layers even if the shared engine is Rust. Duplicating the full engine in Swift and Kotlin is explicitly rejected.

## Tooling

Bun may power package management, TS compilation, tests, CLI execution, and development tooling. Bun is not assumed to be the embedded mobile JavaScript runtime.

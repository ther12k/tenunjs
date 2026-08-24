---
okf_version: 0.2
title: "Supported iOS and Android Baseline Matrix"
summary: "Frozen OS, CPU, GPU API, device, and toolchain support matrix for TenunJS v0.x (TN-003)."
type: requirement
status: accepted
issue_id: "TN-003"
---

# Supported iOS and Android baseline matrix

Frozen 2026-08-24. This matrix is the contract every M0+ issue tests against. Anything below the minimum is unsupported: the embedder must refuse to initialize the engine surface with an attributable error code rather than degrade silently. The GLES fallback path is an explicit, measured exception defined by `platform-requirements.md`, not silent degradation.

## OS and device support

| Dimension | Minimum supported | Dev/test targets | Explicitly out |
| --- | --- | --- | --- |
| iOS deployment target | iOS 16.0 | iOS 17–26 | iOS < 16 |
| Android minSdk | 26 (Android 8.0) | API 30–36 devices | API < 26 |
| Android compile/targetSdk | 36 | — | — |
| CPU architectures | arm64 only (device), x86_64 (simulator/emulator) | arm64 physical | armeabi-v7a, i386, 32-bit |
| Physical test gate | iPhone SE 2nd gen class (A13) or newer; Pixel 4a class or newer | Per ADR-0019 release gates | Tablet-specific layouts in v0.x |

## GPU APIs

| Platform | Preferred | Fallback | Unsupported |
| --- | --- | --- | --- |
| iOS | Metal | — | OpenGL ES (deprecated by Apple; never targeted) |
| Android | Vulkan 1.1 | OpenGL ES 3.0 with measured policy | GLES 2.0, SwiftShader in release builds |

Devices without any listed API fail closed at surface creation.

## Toolchain (CI pins exact versions; minimums frozen here)

| Tool | Minimum at freeze | Pinned reference |
| --- | --- | --- |
| Xcode | 26.x (26.6 / 17F113 at freeze) | recorded per milestone gate |
| Swift | 6.2 (ships with Xcode 26) | with Xcode pin |
| macOS build host | Sequoia 15.6+ (Xcode 26 requirement) | CI runner image |
| Android Gradle Plugin | 8.13+ (Gradle 8.13+) | version catalog |
| Android NDK | r27d LTS (27.3.13750724) | version catalog |
| JDK | 17 | CI runner image |

Exact CI pins live in the build configuration introduced by TN-018/TN-019 and are updated only through PRs referencing this file. A toolchain bump that changes evidence comparability requires an evidence-regeneration note in the PR body.

## Consequences

- Benchmark scenarios (TN-005) run on minimum-class physical devices so evidence reflects the floor, not the ceiling.
- Simulator/emulator-only results are insufficient wherever an issue's test matrix names physical devices.
- Supporting more OS versions later is additive and does not need a superseding ADR; narrowing support after beta requires one.

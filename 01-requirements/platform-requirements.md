---
okf_version: 0.2
title: "Mobile Platform Requirements"
summary: "Required iOS and Android platform integration."
type: requirement
status: accepted
---

# Mobile platform requirements

The frozen OS, device, GPU, and toolchain baseline for both platforms lives in [supported-baseline-matrix.md](supported-baseline-matrix.md); this file defines required platform integration, the matrix defines what must run.

## iOS

- Metal-backed Skia surface on supported devices.
- UIKit/Swift lifecycle integration.
- `UITextInput`-class integration for editable text and IME composition.
- VoiceOver semantics, actions, focus, traits, and dynamic text settings.
- Safe-area, keyboard inset, appearance, clipboard, permission, and lifecycle events.
- XCFramework-compatible packaging and symbol distribution.

## Android

- Vulkan-backed Skia surface where supported, with a measured fallback policy.
- Kotlin/Android lifecycle integration.
- `InputConnection`-class integration for editable text and IME composition.
- TalkBack semantics, actions, focus, content descriptions, and text scaling.
- Window insets, back handling, clipboard, permission, configuration, and lifecycle events.
- AAR-compatible packaging and native-symbol distribution.

## Shared

The engine API shall not assume identical OS behavior. Shared widgets define user intent; embedders implement platform contracts and expose documented differences where necessary.

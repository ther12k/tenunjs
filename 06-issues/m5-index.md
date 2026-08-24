---
okf_version: 0.2
title: "M5: Accessibility, native capabilities, and packaging"
summary: "Integrate platform semantics, modules, views, and reusable native artifacts."
type: index
status: accepted
---

# M5 — Accessibility, native capabilities, and packaging

Integrate platform semantics, modules, views, and reusable native artifacts.

| Issue | Priority | Dependencies | Required outcome |
| --- | --- | --- | --- |
| [TN-089](tn-089-implement-semantics-node-model-and-scene-projection.md) | P0 | TN-039, TN-069, TN-073, TN-079, TN-081, TN-088 | Roles, labels, values, states, actions, bounds, order, and merging form a stable semantics tree. |
| [TN-090](tn-090-implement-ios-voiceover-bridge-and-focus-synchronization.md) | P0 | TN-026, TN-077, TN-089 | Core widgets, navigation, dialogs, actions, and live announcements work with VoiceOver. |
| [TN-091](tn-091-implement-android-talkback-bridge-and-focus-synchronization.md) | P0 | TN-027, TN-078, TN-089 | Core widgets, navigation, dialogs, actions, and announcements work with TalkBack. |
| [TN-092](tn-092-implement-text-scaling-high-contrast-inputs-and-reduced-motion-policy.md) | P0 | TN-068, TN-075, TN-086, TN-089, TN-090, TN-091 | System accessibility settings affect layout, theme, and motion without critical clipping. |
| [TN-093](tn-093-implement-locale-rtl-bidi-layout-and-localized-resource-hooks.md) | P1 | TN-040, TN-068, TN-075, TN-089 | Locale changes, mirrored layout, mixed-direction text, and formatted resources pass fixtures. |
| [TN-094](tn-094-specify-platform-view-lifecycle-and-composition-contract.md) | P0 | TN-043, TN-044, TN-047, TN-081, TN-089 | Creation, layout, z-order, clipping, input, accessibility, surface loss, and destruction are explicit. |
| [TN-095](tn-095-implement-webview-platform-view-adapter.md) | P1 | TN-094 | A bounded WebView example integrates layout, focus, navigation policy, and accessibility. |
| [TN-096](tn-096-implement-map-or-camera-platform-view-reference-adapter.md) | P1 | TN-094 | A graphics-heavy native view proves surface/lifecycle and interaction limits. |
| [TN-097](tn-097-specify-native-module-idl-and-compatibility-manifest.md) | P0 | TN-025, TN-030 | Typed methods, events, errors, thread affinity, permissions, cancellation, and versions are canonical. |
| [TN-098](tn-098-generate-typescript-engine-swift-kotlin-and-mock-native-module-bindings.md) | P0 | TN-019, TN-097 | One schema generates compileable bindings and compatibility tests. |
| [TN-099](tn-099-implement-permission-and-application-lifecycle-services.md) | P0 | TN-026, TN-027, TN-097, TN-098 | Permission requests and foreground/background/memory events have typed, race-safe behavior. |
| [TN-100](tn-100-implement-clipboard-storage-network-status-and-secure-storage-reference-modules.md) | P1 | TN-098, TN-099 | Core service modules prove sync/async/events/errors/permissions and mockability. |
| [TN-101](tn-101-implement-asset-font-locale-and-application-service-registration.md) | P1 | TN-022, TN-046, TN-075, TN-093, TN-098 | Application resources and services resolve deterministically through manifest-backed registries. |
| [TN-102](tn-102-implement-ios-framework-packaging-symbols-and-sample-app-assembly.md) | P0 | TN-028, TN-043, TN-077, TN-090, TN-098 | Reusable iOS artifact and sample archive build without compiling engine dependencies in the app. |
| [TN-103](tn-103-implement-android-library-packaging-symbols-and-sample-app-assembly.md) | P0 | TN-029, TN-044, TN-078, TN-091, TN-098 | Reusable Android artifact and sample APK/AAB build with native symbols. |
| [TN-104](tn-104-close-accessible-mobile-application-foundation-gate.md) | P0 | TN-072, TN-079, TN-080, TN-084, TN-085, TN-088, TN-090, TN-091, TN-092, TN-093, TN-095, TN-096, TN-100, TN-101, TN-102, TN-103 | Reference app passes form, list, navigation, text input, accessibility, module, and platform-view journeys. |

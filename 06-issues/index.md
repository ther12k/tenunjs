---
okf_version: 0.2
title: "Implementation Issue Index"
summary: "All 130 dependency-ordered, agent-sized implementation tasks."
type: index
status: accepted
---

# Implementation issues

Issues are intentionally small enough for one focused worktree/PR. Dependencies are normative.

## M0 — Architecture and technology gates

Close product identity and select engine language, JS runtime, and layout backend with matched evidence.

| Issue | Priority | Depends on | Title |
| --- | --- | --- | --- |
| [TN-001](tn-001-clear-product-name-package-scope-and-repository-identity.md) | P0 | — | Clear product name, package scope, and repository identity |
| [TN-002](tn-002-freeze-product-charter-target-workload-and-non-goals.md) | P0 | TN-001 | Freeze product charter, target workload, and non-goals |
| [TN-003](tn-003-define-supported-ios-and-android-baseline-matrix.md) | P0 | TN-002 | Define supported iOS and Android baseline matrix |
| [TN-004](tn-004-create-monorepo-skeleton-licensing-ownership-and-contribution-rules.md) | P0 | TN-001, TN-002 | Create monorepo skeleton, licensing, ownership, and contribution rules |
| [TN-005](tn-005-create-architecture-spike-benchmark-and-evidence-harness.md) | P0 | TN-003, TN-004 | Create architecture spike benchmark and evidence harness |
| [TN-006](tn-006-freeze-the-minimal-native-engine-and-embedder-spike-contract.md) | P0 | TN-002, TN-003 | Freeze the minimal native engine and embedder spike contract |
| [TN-007](tn-007-implement-c-20-ios-and-android-skia-vertical-slice.md) | P0 | TN-005, TN-006 | Implement C++20 iOS and Android Skia vertical slice |
| [TN-008](tn-008-implement-rust-ios-and-android-skia-vertical-slice.md) | P0 | TN-005, TN-006 | Implement Rust iOS and Android Skia vertical slice |
| [TN-009](tn-009-score-and-select-the-initial-native-engine-language.md) | P0 | TN-007, TN-008 | Score and select the initial native engine language |
| [TN-010](tn-010-freeze-the-javascript-runtime-host-adapter.md) | P0 | TN-006 | Freeze the JavaScript runtime host adapter |
| [TN-011](tn-011-implement-quickjs-ng-runtime-spike.md) | P0 | TN-005, TN-010 | Implement QuickJS-NG runtime spike |
| [TN-012](tn-012-implement-hermes-runtime-spike.md) | P0 | TN-005, TN-010 | Implement Hermes runtime spike |
| [TN-013](tn-013-select-the-initial-embedded-javascript-runtime.md) | P0 | TN-011, TN-012 | Select the initial embedded JavaScript runtime |
| [TN-014](tn-014-freeze-the-layout-backend-adapter-and-conformance-corpus.md) | P0 | TN-006 | Freeze the layout backend adapter and conformance corpus |
| [TN-015](tn-015-implement-yoga-layout-spike.md) | P0 | TN-005, TN-014 | Implement Yoga layout spike |
| [TN-016](tn-016-implement-taffy-layout-spike.md) | P0 | TN-005, TN-014 | Implement Taffy layout spike |
| [TN-017](tn-017-select-the-initial-layout-backend-and-close-m0.md) | P0 | TN-009, TN-013, TN-015, TN-016 | Select the initial layout backend and close M0 |

## M1 — Executable toolchain and mobile embedders

Compile TSX and execute a verified application bundle inside iOS and Android hosts.

| Issue | Priority | Depends on | Title |
| --- | --- | --- | --- |
| [TN-018](tn-018-create-selected-native-engine-build-workspace.md) | P0 | TN-017 | Create selected native engine build workspace |
| [TN-019](tn-019-create-typescript-package-workspace-and-strict-configuration.md) | P0 | TN-004, TN-017 | Create TypeScript package workspace and strict configuration |
| [TN-020](tn-020-implement-custom-jsx-jsxs-fragment-runtime.md) | P0 | TN-019 | Implement custom jsx/jsxs/Fragment runtime |
| [TN-021](tn-021-implement-project-configuration-schema-and-loader.md) | P1 | TN-019 | Implement project configuration schema and loader |
| [TN-022](tn-022-implement-module-graph-and-asset-manifest-builder.md) | P0 | TN-019, TN-021 | Implement module graph and asset manifest builder |
| [TN-023](tn-023-implement-runtime-compatible-bundle-or-bytecode-compiler.md) | P0 | TN-013, TN-020, TN-022 | Implement runtime-compatible bundle or bytecode compiler |
| [TN-024](tn-024-implement-native-runtime-host-lifecycle.md) | P0 | TN-013, TN-018 | Implement native runtime host lifecycle |
| [TN-025](tn-025-implement-bounded-host-value-and-callback-abi.md) | P0 | TN-018, TN-024 | Implement bounded host value and callback ABI |
| [TN-026](tn-026-implement-ios-application-embedder-shell.md) | P0 | TN-003, TN-018 | Implement iOS application embedder shell |
| [TN-027](tn-027-implement-android-application-embedder-shell.md) | P0 | TN-003, TN-018 | Implement Android application embedder shell |
| [TN-028](tn-028-load-and-execute-a-verified-application-bundle-on-ios.md) | P0 | TN-023, TN-024, TN-025, TN-026 | Load and execute a verified application bundle on iOS |
| [TN-029](tn-029-load-and-execute-a-verified-application-bundle-on-android.md) | P0 | TN-023, TN-024, TN-025, TN-027 | Load and execute a verified application bundle on Android |
| [TN-030](tn-030-implement-cross-layer-structured-error-codes-and-crash-boundaries.md) | P0 | TN-024, TN-028, TN-029 | Implement cross-layer structured error codes and crash boundaries |
| [TN-031](tn-031-implement-unified-development-log-transport.md) | P1 | TN-028, TN-029, TN-030 | Implement unified development log transport |
| [TN-032](tn-032-close-the-executable-runtime-and-embedder-gate.md) | P0 | TN-020, TN-028, TN-029, TN-030, TN-031 | Close the executable runtime and embedder gate |

## M2 — Native scene, layout, and Skia rendering

Establish the validated transaction-to-frame path and deterministic headless engine.

| Issue | Priority | Depends on | Title |
| --- | --- | --- | --- |
| [TN-033](tn-033-implement-generation-safe-node-ids-and-arenas.md) | P0 | TN-018, TN-032 | Implement generation-safe node IDs and arenas |
| [TN-034](tn-034-implement-host-widget-kind-and-property-schema-registry.md) | P0 | TN-020, TN-033 | Implement host widget kind and property schema registry |
| [TN-035](tn-035-specify-mutation-transaction-binary-format.md) | P0 | TN-025, TN-033, TN-034 | Specify mutation transaction binary format |
| [TN-036](tn-036-implement-mutation-encoder-in-typescript.md) | P0 | TN-020, TN-035 | Implement mutation encoder in TypeScript |
| [TN-037](tn-037-implement-fail-closed-native-transaction-validator.md) | P0 | TN-033, TN-035 | Implement fail-closed native transaction validator |
| [TN-038](tn-038-implement-atomic-scene-tree-transaction-application.md) | P0 | TN-033, TN-034, TN-037 | Implement atomic scene-tree transaction application |
| [TN-039](tn-039-implement-scene-dirty-state-propagation.md) | P1 | TN-038 | Implement scene dirty-state propagation |
| [TN-040](tn-040-implement-selected-layout-adapter.md) | P0 | TN-017, TN-034, TN-038 | Implement selected layout adapter |
| [TN-041](tn-041-implement-intrinsic-measurement-callbacks.md) | P0 | TN-040 | Implement intrinsic measurement callbacks |
| [TN-042](tn-042-implement-renderer-neutral-display-list.md) | P0 | TN-034, TN-038 | Implement renderer-neutral display list |
| [TN-043](tn-043-implement-ios-skia-gpu-surface-and-lifecycle.md) | P0 | TN-026, TN-042 | Implement iOS Skia GPU surface and lifecycle |
| [TN-044](tn-044-implement-android-skia-gpu-surface-and-fallback-policy.md) | P0 | TN-027, TN-042 | Implement Android Skia GPU surface and fallback policy |
| [TN-045](tn-045-implement-skia-display-list-playback.md) | P0 | TN-042, TN-043, TN-044 | Implement Skia display-list playback |
| [TN-046](tn-046-implement-image-resource-decode-upload-and-cache-lifecycle.md) | P1 | TN-039, TN-045 | Implement image resource decode, upload, and cache lifecycle |
| [TN-047](tn-047-implement-hit-testing-across-transforms-and-clips.md) | P0 | TN-038, TN-040 | Implement hit testing across transforms and clips |
| [TN-048](tn-048-implement-frame-scheduler-and-immutable-frame-snapshots.md) | P0 | TN-039, TN-045 | Implement frame scheduler and immutable frame snapshots |
| [TN-049](tn-049-implement-renderer-mock-and-deterministic-clock.md) | P0 | TN-042, TN-048 | Implement renderer mock and deterministic clock |
| [TN-050](tn-050-close-scene-layout-render-vertical-slice-gate.md) | P0 | TN-036, TN-037, TN-041, TN-045, TN-046, TN-047, TN-048, TN-049 | Close scene-layout-render vertical slice gate |

## M3 — TSX reconciliation, controllers, actions, and navigation

Deliver the complete application programming model without React.

| Issue | Priority | Depends on | Title |
| --- | --- | --- | --- |
| [TN-051](tn-051-implement-function-widget-execution-and-child-normalization.md) | P0 | TN-020, TN-034, TN-050 | Implement function-widget execution and child normalization |
| [TN-052](tn-052-implement-keyed-reconciliation-identity-rules.md) | P0 | TN-036, TN-051 | Implement keyed reconciliation identity rules |
| [TN-053](tn-053-implement-property-diffing-and-event-handle-registration.md) | P0 | TN-034, TN-036, TN-052 | Implement property diffing and event-handle registration |
| [TN-054](tn-054-implement-root-scheduling-and-bounded-reconciliation.md) | P0 | TN-052, TN-053 | Implement root scheduling and bounded reconciliation |
| [TN-055](tn-055-implement-controller-definition-and-typed-state-initialization.md) | P0 | TN-019, TN-054 | Implement controller definition and typed state initialization |
| [TN-056](tn-056-implement-typed-action-definition-and-dispatch.md) | P0 | TN-053, TN-055 | Implement typed action definition and dispatch |
| [TN-057](tn-057-implement-atomic-controller-state-transactions.md) | P0 | TN-054, TN-055, TN-056 | Implement atomic controller state transactions |
| [TN-058](tn-058-implement-cancellable-async-effects-and-concurrency-policies.md) | P0 | TN-056, TN-057 | Implement cancellable async effects and concurrency policies |
| [TN-059](tn-059-implement-one-file-screen-tsx-normalization.md) | P0 | TN-022, TN-055, TN-056 | Implement one-file .screen.tsx normalization |
| [TN-060](tn-060-implement-split-controller-view-screen-normalization.md) | P0 | TN-022, TN-055, TN-059 | Implement split controller/view screen normalization |
| [TN-061](tn-061-implement-controller-and-widget-error-boundaries.md) | P1 | TN-030, TN-054, TN-058 | Implement controller and widget error boundaries |
| [TN-062](tn-062-specify-typed-route-and-navigation-state-model.md) | P0 | TN-002, TN-055 | Specify typed route and navigation state model |
| [TN-063](tn-063-implement-stack-navigation-and-screen-lifecycle.md) | P0 | TN-058, TN-060, TN-062 | Implement stack navigation and screen lifecycle |
| [TN-064](tn-064-implement-deep-link-parsing-and-invalid-route-policy.md) | P1 | TN-062, TN-063 | Implement deep-link parsing and invalid-route policy |
| [TN-065](tn-065-implement-android-back-and-ios-interactive-navigation-hooks.md) | P1 | TN-063 | Implement Android back and iOS interactive navigation hooks |
| [TN-066](tn-066-implement-versioned-navigation-and-controller-state-restoration.md) | P1 | TN-055, TN-062, TN-063 | Implement versioned navigation and controller state restoration |
| [TN-067](tn-067-close-controller-action-navigation-gate.md) | P0 | TN-051, TN-052, TN-057, TN-058, TN-059, TN-060, TN-061, TN-063, TN-064, TN-065, TN-066 | Close controller-action-navigation gate |

## M4 — Core widgets, text input, scrolling, and animation

Make ordinary mobile UI usable and responsive on both platforms.

| Issue | Priority | Depends on | Title |
| --- | --- | --- | --- |
| [TN-068](tn-068-implement-theme-tokens-and-inherited-widget-context.md) | P1 | TN-051, TN-067 | Implement theme tokens and inherited widget context |
| [TN-069](tn-069-implement-view-text-fragment-and-spacer-host-widgets.md) | P0 | TN-041, TN-045, TN-053, TN-068 | Implement View, Text, Fragment, and Spacer host widgets |
| [TN-070](tn-070-implement-row-column-expanded-and-flexible-widgets.md) | P0 | TN-040, TN-069 | Implement Row, Column, Expanded, and Flexible widgets |
| [TN-071](tn-071-implement-stack-positioned-align-and-center-widgets.md) | P1 | TN-040, TN-069 | Implement Stack, Positioned, Align, and Center widgets |
| [TN-072](tn-072-implement-safearea-scaffold-appbar-and-page-shell-widgets.md) | P0 | TN-043, TN-044, TN-068, TN-070 | Implement SafeArea, Scaffold, AppBar, and page shell widgets |
| [TN-073](tn-073-implement-pressable-button-iconbutton-and-interaction-states.md) | P0 | TN-047, TN-056, TN-068, TN-069 | Implement Pressable, Button, IconButton, and interaction states |
| [TN-074](tn-074-implement-image-icon-card-divider-badge-and-progress-widgets.md) | P1 | TN-046, TN-068, TN-069 | Implement Image, Icon, Card, Divider, Badge, and progress widgets |
| [TN-075](tn-075-implement-text-shaping-paragraph-layout-and-font-fallback-service.md) | P0 | TN-041, TN-045, TN-068 | Implement text shaping, paragraph layout, and font fallback service |
| [TN-076](tn-076-implement-editable-text-model-and-revision-protocol.md) | P0 | TN-055, TN-075 | Implement editable text model and revision protocol |
| [TN-077](tn-077-implement-ios-text-input-and-ime-adapter.md) | P0 | TN-026, TN-043, TN-076 | Implement iOS text input and IME adapter |
| [TN-078](tn-078-implement-android-text-input-and-ime-adapter.md) | P0 | TN-027, TN-044, TN-076 | Implement Android text input and IME adapter |
| [TN-079](tn-079-implement-textfield-textarea-validation-and-form-widgets.md) | P0 | TN-056, TN-068, TN-076, TN-077, TN-078 | Implement TextField, TextArea, validation, and form widgets |
| [TN-080](tn-080-implement-clipboard-caret-selection-handles-and-text-commands.md) | P1 | TN-076, TN-077, TN-078 | Implement clipboard, caret, selection handles, and text commands |
| [TN-081](tn-081-implement-native-focus-tree-scopes-traversal-and-restoration.md) | P0 | TN-047, TN-069, TN-073, TN-076 | Implement native focus tree, scopes, traversal, and restoration |
| [TN-082](tn-082-implement-gesture-arena-and-core-recognizers.md) | P0 | TN-047, TN-073 | Implement gesture arena and core recognizers |
| [TN-083](tn-083-implement-native-scroll-node-and-platform-physics.md) | P0 | TN-048, TN-082 | Implement native scroll node and platform physics |
| [TN-084](tn-084-implement-scrollview-widget-and-nested-scroll-policy.md) | P0 | TN-070, TN-071, TN-081, TN-083 | Implement ScrollView widget and nested-scroll policy |
| [TN-085](tn-085-implement-lazy-listview-builder-and-recycling-window.md) | P0 | TN-052, TN-069, TN-083, TN-084 | Implement lazy ListView builder and recycling window |
| [TN-086](tn-086-implement-native-animation-graph-curves-and-springs.md) | P0 | TN-048, TN-068 | Implement native animation graph, curves, and springs |
| [TN-087](tn-087-implement-animated-widgets-transitions-and-layout-invalidation-rules.md) | P1 | TN-054, TN-069, TN-086 | Implement animated widgets, transitions, and layout invalidation rules |
| [TN-088](tn-088-implement-overlay-dialog-sheet-toast-and-modal-focus-behavior.md) | P0 | TN-063, TN-072, TN-073, TN-081, TN-087 | Implement Overlay, Dialog, Sheet, Toast, and modal focus behavior |

## M5 — Accessibility, native capabilities, and packaging

Integrate platform semantics, modules, views, and reusable native artifacts.

| Issue | Priority | Depends on | Title |
| --- | --- | --- | --- |
| [TN-089](tn-089-implement-semantics-node-model-and-scene-projection.md) | P0 | TN-039, TN-069, TN-073, TN-079, TN-081, TN-088 | Implement semantics node model and scene projection |
| [TN-090](tn-090-implement-ios-voiceover-bridge-and-focus-synchronization.md) | P0 | TN-026, TN-077, TN-089 | Implement iOS VoiceOver bridge and focus synchronization |
| [TN-091](tn-091-implement-android-talkback-bridge-and-focus-synchronization.md) | P0 | TN-027, TN-078, TN-089 | Implement Android TalkBack bridge and focus synchronization |
| [TN-092](tn-092-implement-text-scaling-high-contrast-inputs-and-reduced-motion-policy.md) | P0 | TN-068, TN-075, TN-086, TN-089, TN-090, TN-091 | Implement text scaling, high-contrast inputs, and reduced-motion policy |
| [TN-093](tn-093-implement-locale-rtl-bidi-layout-and-localized-resource-hooks.md) | P1 | TN-040, TN-068, TN-075, TN-089 | Implement locale, RTL, bidi layout, and localized resource hooks |
| [TN-094](tn-094-specify-platform-view-lifecycle-and-composition-contract.md) | P0 | TN-043, TN-044, TN-047, TN-081, TN-089 | Specify platform-view lifecycle and composition contract |
| [TN-095](tn-095-implement-webview-platform-view-adapter.md) | P1 | TN-094 | Implement WebView platform-view adapter |
| [TN-096](tn-096-implement-map-or-camera-platform-view-reference-adapter.md) | P1 | TN-094 | Implement map or camera platform-view reference adapter |
| [TN-097](tn-097-specify-native-module-idl-and-compatibility-manifest.md) | P0 | TN-025, TN-030 | Specify native module IDL and compatibility manifest |
| [TN-098](tn-098-generate-typescript-engine-swift-kotlin-and-mock-native-module-bindings.md) | P0 | TN-019, TN-097 | Generate TypeScript, engine, Swift, Kotlin, and mock native-module bindings |
| [TN-099](tn-099-implement-permission-and-application-lifecycle-services.md) | P0 | TN-026, TN-027, TN-097, TN-098 | Implement permission and application lifecycle services |
| [TN-100](tn-100-implement-clipboard-storage-network-status-and-secure-storage-reference-modules.md) | P1 | TN-098, TN-099 | Implement clipboard, storage, network-status, and secure-storage reference modules |
| [TN-101](tn-101-implement-asset-font-locale-and-application-service-registration.md) | P1 | TN-022, TN-046, TN-075, TN-093, TN-098 | Implement asset, font, locale, and application-service registration |
| [TN-102](tn-102-implement-ios-framework-packaging-symbols-and-sample-app-assembly.md) | P0 | TN-028, TN-043, TN-077, TN-090, TN-098 | Implement iOS framework packaging, symbols, and sample app assembly |
| [TN-103](tn-103-implement-android-library-packaging-symbols-and-sample-app-assembly.md) | P0 | TN-029, TN-044, TN-078, TN-091, TN-098 | Implement Android library packaging, symbols, and sample app assembly |
| [TN-104](tn-104-close-accessible-mobile-application-foundation-gate.md) | P0 | TN-072, TN-079, TN-080, TN-084, TN-085, TN-088, TN-090, TN-091, TN-092, TN-093, TN-095, TN-096, TN-100, TN-101, TN-102, TN-103 | Close accessible mobile application foundation gate |

## M6 — Developer experience, hardening, and public alpha

Ship the CLI, test stack, diagnostics, security, benchmarks, and alpha evidence.

| Issue | Priority | Depends on | Title |
| --- | --- | --- | --- |
| [TN-105](tn-105-implement-create-tenun-and-project-generation-cli.md) | P0 | TN-019, TN-021, TN-102, TN-103 | Implement create-tenun and project generation CLI |
| [TN-106](tn-106-implement-unified-build-run-device-log-test-and-package-commands.md) | P0 | TN-031, TN-105 | Implement unified build, run, device, log, test, and package commands |
| [TN-107](tn-107-implement-development-bundle-server-and-fast-refresh-protocol.md) | P0 | TN-023, TN-024, TN-054, TN-106 | Implement development bundle server and fast refresh protocol |
| [TN-108](tn-108-implement-source-maps-and-cross-layer-development-error-overlay.md) | P0 | TN-023, TN-030, TN-031, TN-107 | Implement source maps and cross-layer development error overlay |
| [TN-109](tn-109-implement-controller-action-and-effect-unit-test-harness.md) | P0 | TN-055, TN-056, TN-058 | Implement controller, action, and effect unit-test harness |
| [TN-110](tn-110-implement-headless-reconciler-layout-scene-and-semantics-test-host.md) | P0 | TN-049, TN-052, TN-089, TN-109 | Implement headless reconciler, layout, scene, and semantics test host |
| [TN-111](tn-111-implement-skia-golden-rendering-and-controlled-update-workflow.md) | P1 | TN-045, TN-075, TN-110 | Implement Skia golden rendering and controlled update workflow |
| [TN-112](tn-112-implement-physical-device-ime-and-accessibility-automation-plus-manual-scripts.md) | P0 | TN-077, TN-078, TN-090, TN-091, TN-106 | Implement physical-device IME and accessibility automation plus manual scripts |
| [TN-113](tn-113-fuzz-mutation-protocol-resource-inputs-deep-links-and-native-module-codecs.md) | P0 | TN-037, TN-046, TN-064, TN-097, TN-110 | Fuzz mutation protocol, resource inputs, deep links, and native-module codecs |
| [TN-114](tn-114-complete-threat-model-release-mode-hardening-and-capability-audit.md) | P0 | TN-030, TN-097, TN-099, TN-108, TN-113 | Complete threat model, release-mode hardening, and capability audit |
| [TN-115](tn-115-implement-physical-device-startup-frame-list-bridge-and-js-stall-benchmarks.md) | P0 | TN-050, TN-067, TN-085, TN-086, TN-106 | Implement physical-device startup, frame, list, bridge, and JS-stall benchmarks |
| [TN-116](tn-116-implement-memory-leak-lifecycle-and-long-run-soak-suite.md) | P0 | TN-046, TN-058, TN-063, TN-083, TN-094, TN-100, TN-106 | Implement memory, leak, lifecycle, and long-run soak suite |
| [TN-117](tn-117-implement-inspector-frame-timeline-transaction-viewer-and-diagnostics-export.md) | P1 | TN-039, TN-048, TN-054, TN-089, TN-108 | Implement inspector, frame timeline, transaction viewer, and diagnostics export |
| [TN-118](tn-118-close-public-alpha-release-gate.md) | P0 | TN-104, TN-105, TN-106, TN-107, TN-108, TN-109, TN-110, TN-111, TN-112, TN-113, TN-114, TN-115, TN-116, TN-117 | Close public alpha release gate |

## M7 — Pilot, stabilization, and beta

Validate the framework in a real application and freeze a credible beta surface.

| Issue | Priority | Depends on | Title |
| --- | --- | --- | --- |
| [TN-119](tn-119-build-full-reference-business-application.md) | P0 | TN-118 | Build full reference business application |
| [TN-120](tn-120-select-and-instrument-a-real-pilot-application.md) | P0 | TN-118 | Select and instrument a real pilot application |
| [TN-121](tn-121-migrate-pilot-vertical-slices-and-record-framework-gaps.md) | P0 | TN-119, TN-120 | Migrate pilot vertical slices and record framework gaps |
| [TN-122](tn-122-review-and-simplify-public-api-from-pilot-evidence.md) | P0 | TN-121 | Review and simplify public API from pilot evidence |
| [TN-123](tn-123-freeze-package-boundaries-versioning-and-compatibility-policy.md) | P0 | TN-122 | Freeze package boundaries, versioning, and compatibility policy |
| [TN-124](tn-124-publish-application-tutorial-and-architecture-guide.md) | P1 | TN-119, TN-122, TN-123 | Publish application tutorial and architecture guide |
| [TN-125](tn-125-publish-widget-native-module-and-platform-view-author-guides.md) | P1 | TN-098, TN-094, TN-122, TN-123 | Publish widget, native-module, and platform-view author guides |
| [TN-126](tn-126-complete-independent-accessibility-review-and-remediation.md) | P0 | TN-121, TN-124, TN-125 | Complete independent accessibility review and remediation |
| [TN-127](tn-127-close-performance-and-memory-acceptance-budgets.md) | P0 | TN-121, TN-115, TN-116, TN-122 | Close performance and memory acceptance budgets |
| [TN-128](tn-128-produce-store-installable-ios-and-android-release-candidates.md) | P0 | TN-102, TN-103, TN-114, TN-123, TN-127 | Produce store-installable iOS and Android release candidates |
| [TN-129](tn-129-run-beta-stabilization-compatibility-upgrade-and-rollback-campaign.md) | P0 | TN-123, TN-126, TN-127, TN-128 | Run beta stabilization, compatibility, upgrade, and rollback campaign |
| [TN-130](tn-130-close-beta-gate-and-publish-evidence-index.md) | P0 | TN-124, TN-125, TN-126, TN-127, TN-128, TN-129 | Close beta gate and publish evidence index |

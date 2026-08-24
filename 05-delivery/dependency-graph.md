---
okf_version: 0.2
title: "Dependency Graph"
summary: "Canonical issue prerequisites and critical sequencing."
type: plan
status: accepted
---

# Dependency graph

The graph was machine-validated as acyclic.

| Issue | Depends on | Outcome |
| --- | --- | --- |
| TN-001 | — | Clear product name, package scope, and repository identity |
| TN-002 | TN-001 | Freeze product charter, target workload, and non-goals |
| TN-003 | TN-002 | Define supported iOS and Android baseline matrix |
| TN-004 | TN-001, TN-002 | Create monorepo skeleton, licensing, ownership, and contribution rules |
| TN-005 | TN-003, TN-004 | Create architecture spike benchmark and evidence harness |
| TN-006 | TN-002, TN-003 | Freeze the minimal native engine and embedder spike contract |
| TN-007 | TN-005, TN-006 | Implement C++20 iOS and Android Skia vertical slice |
| TN-008 | TN-005, TN-006 | Implement Rust iOS and Android Skia vertical slice |
| TN-009 | TN-007, TN-008 | Score and select the initial native engine language |
| TN-010 | TN-006 | Freeze the JavaScript runtime host adapter |
| TN-011 | TN-005, TN-010 | Implement QuickJS-NG runtime spike |
| TN-012 | TN-005, TN-010 | Implement Hermes runtime spike |
| TN-013 | TN-011, TN-012 | Select the initial embedded JavaScript runtime |
| TN-014 | TN-006 | Freeze the layout backend adapter and conformance corpus |
| TN-015 | TN-005, TN-014 | Implement Yoga layout spike |
| TN-016 | TN-005, TN-014 | Implement Taffy layout spike |
| TN-017 | TN-009, TN-013, TN-015, TN-016 | Select the initial layout backend and close M0 |
| TN-018 | TN-017 | Create selected native engine build workspace |
| TN-019 | TN-004, TN-017 | Create TypeScript package workspace and strict configuration |
| TN-020 | TN-019 | Implement custom jsx/jsxs/Fragment runtime |
| TN-021 | TN-019 | Implement project configuration schema and loader |
| TN-022 | TN-019, TN-021 | Implement module graph and asset manifest builder |
| TN-023 | TN-013, TN-020, TN-022 | Implement runtime-compatible bundle or bytecode compiler |
| TN-024 | TN-013, TN-018 | Implement native runtime host lifecycle |
| TN-025 | TN-018, TN-024 | Implement bounded host value and callback ABI |
| TN-026 | TN-003, TN-018 | Implement iOS application embedder shell |
| TN-027 | TN-003, TN-018 | Implement Android application embedder shell |
| TN-028 | TN-023, TN-024, TN-025, TN-026 | Load and execute a verified application bundle on iOS |
| TN-029 | TN-023, TN-024, TN-025, TN-027 | Load and execute a verified application bundle on Android |
| TN-030 | TN-024, TN-028, TN-029 | Implement cross-layer structured error codes and crash boundaries |
| TN-031 | TN-028, TN-029, TN-030 | Implement unified development log transport |
| TN-032 | TN-020, TN-028, TN-029, TN-030, TN-031 | Close the executable runtime and embedder gate |
| TN-033 | TN-018, TN-032 | Implement generation-safe node IDs and arenas |
| TN-034 | TN-020, TN-033 | Implement host widget kind and property schema registry |
| TN-035 | TN-025, TN-033, TN-034 | Specify mutation transaction binary format |
| TN-036 | TN-020, TN-035 | Implement mutation encoder in TypeScript |
| TN-037 | TN-033, TN-035 | Implement fail-closed native transaction validator |
| TN-038 | TN-033, TN-034, TN-037 | Implement atomic scene-tree transaction application |
| TN-039 | TN-038 | Implement scene dirty-state propagation |
| TN-040 | TN-017, TN-034, TN-038 | Implement selected layout adapter |
| TN-041 | TN-040 | Implement intrinsic measurement callbacks |
| TN-042 | TN-034, TN-038 | Implement renderer-neutral display list |
| TN-043 | TN-026, TN-042 | Implement iOS Skia GPU surface and lifecycle |
| TN-044 | TN-027, TN-042 | Implement Android Skia GPU surface and fallback policy |
| TN-045 | TN-042, TN-043, TN-044 | Implement Skia display-list playback |
| TN-046 | TN-039, TN-045 | Implement image resource decode, upload, and cache lifecycle |
| TN-047 | TN-038, TN-040 | Implement hit testing across transforms and clips |
| TN-048 | TN-039, TN-045 | Implement frame scheduler and immutable frame snapshots |
| TN-049 | TN-042, TN-048 | Implement renderer mock and deterministic clock |
| TN-050 | TN-036, TN-037, TN-041, TN-045, TN-046, TN-047, TN-048, TN-049 | Close scene-layout-render vertical slice gate |
| TN-051 | TN-020, TN-034, TN-050 | Implement function-widget execution and child normalization |
| TN-052 | TN-036, TN-051 | Implement keyed reconciliation identity rules |
| TN-053 | TN-034, TN-036, TN-052 | Implement property diffing and event-handle registration |
| TN-054 | TN-052, TN-053 | Implement root scheduling and bounded reconciliation |
| TN-055 | TN-019, TN-054 | Implement controller definition and typed state initialization |
| TN-056 | TN-053, TN-055 | Implement typed action definition and dispatch |
| TN-057 | TN-054, TN-055, TN-056 | Implement atomic controller state transactions |
| TN-058 | TN-056, TN-057 | Implement cancellable async effects and concurrency policies |
| TN-059 | TN-022, TN-055, TN-056 | Implement one-file .screen.tsx normalization |
| TN-060 | TN-022, TN-055, TN-059 | Implement split controller/view screen normalization |
| TN-061 | TN-030, TN-054, TN-058 | Implement controller and widget error boundaries |
| TN-062 | TN-002, TN-055 | Specify typed route and navigation state model |
| TN-063 | TN-058, TN-060, TN-062 | Implement stack navigation and screen lifecycle |
| TN-064 | TN-062, TN-063 | Implement deep-link parsing and invalid-route policy |
| TN-065 | TN-063 | Implement Android back and iOS interactive navigation hooks |
| TN-066 | TN-055, TN-062, TN-063 | Implement versioned navigation and controller state restoration |
| TN-067 | TN-051, TN-052, TN-057, TN-058, TN-059, TN-060, TN-061, TN-063, TN-064, TN-065, TN-066 | Close controller-action-navigation gate |
| TN-068 | TN-051, TN-067 | Implement theme tokens and inherited widget context |
| TN-069 | TN-041, TN-045, TN-053, TN-068 | Implement View, Text, Fragment, and Spacer host widgets |
| TN-070 | TN-040, TN-069 | Implement Row, Column, Expanded, and Flexible widgets |
| TN-071 | TN-040, TN-069 | Implement Stack, Positioned, Align, and Center widgets |
| TN-072 | TN-043, TN-044, TN-068, TN-070 | Implement SafeArea, Scaffold, AppBar, and page shell widgets |
| TN-073 | TN-047, TN-056, TN-068, TN-069 | Implement Pressable, Button, IconButton, and interaction states |
| TN-074 | TN-046, TN-068, TN-069 | Implement Image, Icon, Card, Divider, Badge, and progress widgets |
| TN-075 | TN-041, TN-045, TN-068 | Implement text shaping, paragraph layout, and font fallback service |
| TN-076 | TN-055, TN-075 | Implement editable text model and revision protocol |
| TN-077 | TN-026, TN-043, TN-076 | Implement iOS text input and IME adapter |
| TN-078 | TN-027, TN-044, TN-076 | Implement Android text input and IME adapter |
| TN-079 | TN-056, TN-068, TN-076, TN-077, TN-078 | Implement TextField, TextArea, validation, and form widgets |
| TN-080 | TN-076, TN-077, TN-078 | Implement clipboard, caret, selection handles, and text commands |
| TN-081 | TN-047, TN-069, TN-073, TN-076 | Implement native focus tree, scopes, traversal, and restoration |
| TN-082 | TN-047, TN-073 | Implement gesture arena and core recognizers |
| TN-083 | TN-048, TN-082 | Implement native scroll node and platform physics |
| TN-084 | TN-070, TN-071, TN-081, TN-083 | Implement ScrollView widget and nested-scroll policy |
| TN-085 | TN-052, TN-069, TN-083, TN-084 | Implement lazy ListView builder and recycling window |
| TN-086 | TN-048, TN-068 | Implement native animation graph, curves, and springs |
| TN-087 | TN-054, TN-069, TN-086 | Implement animated widgets, transitions, and layout invalidation rules |
| TN-088 | TN-063, TN-072, TN-073, TN-081, TN-087 | Implement Overlay, Dialog, Sheet, Toast, and modal focus behavior |
| TN-089 | TN-039, TN-069, TN-073, TN-079, TN-081, TN-088 | Implement semantics node model and scene projection |
| TN-090 | TN-026, TN-077, TN-089 | Implement iOS VoiceOver bridge and focus synchronization |
| TN-091 | TN-027, TN-078, TN-089 | Implement Android TalkBack bridge and focus synchronization |
| TN-092 | TN-068, TN-075, TN-086, TN-089, TN-090, TN-091 | Implement text scaling, high-contrast inputs, and reduced-motion policy |
| TN-093 | TN-040, TN-068, TN-075, TN-089 | Implement locale, RTL, bidi layout, and localized resource hooks |
| TN-094 | TN-043, TN-044, TN-047, TN-081, TN-089 | Specify platform-view lifecycle and composition contract |
| TN-095 | TN-094 | Implement WebView platform-view adapter |
| TN-096 | TN-094 | Implement map or camera platform-view reference adapter |
| TN-097 | TN-025, TN-030 | Specify native module IDL and compatibility manifest |
| TN-098 | TN-019, TN-097 | Generate TypeScript, engine, Swift, Kotlin, and mock native-module bindings |
| TN-099 | TN-026, TN-027, TN-097, TN-098 | Implement permission and application lifecycle services |
| TN-100 | TN-098, TN-099 | Implement clipboard, storage, network-status, and secure-storage reference modules |
| TN-101 | TN-022, TN-046, TN-075, TN-093, TN-098 | Implement asset, font, locale, and application-service registration |
| TN-102 | TN-028, TN-043, TN-077, TN-090, TN-098 | Implement iOS framework packaging, symbols, and sample app assembly |
| TN-103 | TN-029, TN-044, TN-078, TN-091, TN-098 | Implement Android library packaging, symbols, and sample app assembly |
| TN-104 | TN-072, TN-079, TN-080, TN-084, TN-085, TN-088, TN-090, TN-091, TN-092, TN-093, TN-095, TN-096, TN-100, TN-101, TN-102, TN-103 | Close accessible mobile application foundation gate |
| TN-105 | TN-019, TN-021, TN-102, TN-103 | Implement create-tenun and project generation CLI |
| TN-106 | TN-031, TN-105 | Implement unified build, run, device, log, test, and package commands |
| TN-107 | TN-023, TN-024, TN-054, TN-106 | Implement development bundle server and fast refresh protocol |
| TN-108 | TN-023, TN-030, TN-031, TN-107 | Implement source maps and cross-layer development error overlay |
| TN-109 | TN-055, TN-056, TN-058 | Implement controller, action, and effect unit-test harness |
| TN-110 | TN-049, TN-052, TN-089, TN-109 | Implement headless reconciler, layout, scene, and semantics test host |
| TN-111 | TN-045, TN-075, TN-110 | Implement Skia golden rendering and controlled update workflow |
| TN-112 | TN-077, TN-078, TN-090, TN-091, TN-106 | Implement physical-device IME and accessibility automation plus manual scripts |
| TN-113 | TN-037, TN-046, TN-064, TN-097, TN-110 | Fuzz mutation protocol, resource inputs, deep links, and native-module codecs |
| TN-114 | TN-030, TN-097, TN-099, TN-108, TN-113 | Complete threat model, release-mode hardening, and capability audit |
| TN-115 | TN-050, TN-067, TN-085, TN-086, TN-106 | Implement physical-device startup, frame, list, bridge, and JS-stall benchmarks |
| TN-116 | TN-046, TN-058, TN-063, TN-083, TN-094, TN-100, TN-106 | Implement memory, leak, lifecycle, and long-run soak suite |
| TN-117 | TN-039, TN-048, TN-054, TN-089, TN-108 | Implement inspector, frame timeline, transaction viewer, and diagnostics export |
| TN-118 | TN-104, TN-105, TN-106, TN-107, TN-108, TN-109, TN-110, TN-111, TN-112, TN-113, TN-114, TN-115, TN-116, TN-117 | Close public alpha release gate |
| TN-119 | TN-118 | Build full reference business application |
| TN-120 | TN-118 | Select and instrument a real pilot application |
| TN-121 | TN-119, TN-120 | Migrate pilot vertical slices and record framework gaps |
| TN-122 | TN-121 | Review and simplify public API from pilot evidence |
| TN-123 | TN-122 | Freeze package boundaries, versioning, and compatibility policy |
| TN-124 | TN-119, TN-122, TN-123 | Publish application tutorial and architecture guide |
| TN-125 | TN-098, TN-094, TN-122, TN-123 | Publish widget, native-module, and platform-view author guides |
| TN-126 | TN-121, TN-124, TN-125 | Complete independent accessibility review and remediation |
| TN-127 | TN-121, TN-115, TN-116, TN-122 | Close performance and memory acceptance budgets |
| TN-128 | TN-102, TN-103, TN-114, TN-123, TN-127 | Produce store-installable iOS and Android release candidates |
| TN-129 | TN-123, TN-126, TN-127, TN-128 | Run beta stabilization, compatibility, upgrade, and rollback campaign |
| TN-130 | TN-124, TN-125, TN-126, TN-127, TN-128, TN-129 | Close beta gate and publish evidence index |

## Agent rule

An agent may read later issues for context, but it must not implement or silently redesign work owned by an unresolved dependency. Interface gaps are reported as blockers or proposed ADR changes.

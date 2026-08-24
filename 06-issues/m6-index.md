---
okf_version: 0.2
title: "M6: Developer experience, hardening, and public alpha"
summary: "Ship the CLI, test stack, diagnostics, security, benchmarks, and alpha evidence."
type: index
status: accepted
---

# M6 — Developer experience, hardening, and public alpha

Ship the CLI, test stack, diagnostics, security, benchmarks, and alpha evidence.

| Issue | Priority | Dependencies | Required outcome |
| --- | --- | --- | --- |
| [TN-105](tn-105-implement-create-tenun-and-project-generation-cli.md) | P0 | TN-019, TN-021, TN-102, TN-103 | One command creates a valid app with iOS/Android projects and a working sample screen. |
| [TN-106](tn-106-implement-unified-build-run-device-log-test-and-package-commands.md) | P0 | TN-031, TN-105 | CLI orchestrates both platforms with stable exit codes and machine-readable diagnostics. |
| [TN-107](tn-107-implement-development-bundle-server-and-fast-refresh-protocol.md) | P0 | TN-023, TN-024, TN-054, TN-106 | Changed TS/TSX modules refresh safely while preserving eligible controller state. |
| [TN-108](tn-108-implement-source-maps-and-cross-layer-development-error-overlay.md) | P0 | TN-023, TN-030, TN-031, TN-107 | JS/native errors point to actionable source and do not conceal the owning failure layer. |
| [TN-109](tn-109-implement-controller-action-and-effect-unit-test-harness.md) | P0 | TN-055, TN-056, TN-058 | Tests use deterministic services, cancellation, time, and action traces without devices. |
| [TN-110](tn-110-implement-headless-reconciler-layout-scene-and-semantics-test-host.md) | P0 | TN-049, TN-052, TN-089, TN-109 | TS tests mount screens and inspect mutations, layout, display lists, focus, and semantics. |
| [TN-111](tn-111-implement-skia-golden-rendering-and-controlled-update-workflow.md) | P1 | TN-045, TN-075, TN-110 | Cross-platform golden suites detect intentional and accidental visual changes with metadata. |
| [TN-112](tn-112-implement-physical-device-ime-and-accessibility-automation-plus-manual-scripts.md) | P0 | TN-077, TN-078, TN-090, TN-091, TN-106 | Repeatable device journeys cover composition, selection, VoiceOver, and TalkBack. |
| [TN-113](tn-113-fuzz-mutation-protocol-resource-inputs-deep-links-and-native-module-codecs.md) | P0 | TN-037, TN-046, TN-064, TN-097, TN-110 | Bounded fuzz targets discover malformed input without corrupting native state. |
| [TN-114](tn-114-complete-threat-model-release-mode-hardening-and-capability-audit.md) | P0 | TN-030, TN-097, TN-099, TN-108, TN-113 | Trust boundaries, debug stripping, manifest checks, secret handling, and module capabilities are reviewed. |
| [TN-115](tn-115-implement-physical-device-startup-frame-list-bridge-and-js-stall-benchmarks.md) | P0 | TN-050, TN-067, TN-085, TN-086, TN-106 | Reproducible benchmark suite publishes distributions and baseline comparisons. |
| [TN-116](tn-116-implement-memory-leak-lifecycle-and-long-run-soak-suite.md) | P0 | TN-046, TN-058, TN-063, TN-083, TN-094, TN-100, TN-106 | Repeated mount, navigation, backgrounding, platform views, and resources converge within budgets. |
| [TN-117](tn-117-implement-inspector-frame-timeline-transaction-viewer-and-diagnostics-export.md) | P1 | TN-039, TN-048, TN-054, TN-089, TN-108 | Developers can inspect widget/layout/semantics state and export sanitized replay evidence. |
| [TN-118](tn-118-close-public-alpha-release-gate.md) | P0 | TN-104, TN-105, TN-106, TN-107, TN-108, TN-109, TN-110, TN-111, TN-112, TN-113, TN-114, TN-115, TN-116, TN-117 | Versioned alpha artifacts, docs, evidence packet, known limitations, and rollback instructions are published. |

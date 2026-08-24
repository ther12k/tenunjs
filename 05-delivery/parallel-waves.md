---
okf_version: 0.2
title: "Parallel Execution Waves"
summary: "Topologically safe issue waves for parallel agents and worktrees."
type: plan
status: accepted
---

# Safe parallel execution waves

Each wave contains issues whose declared dependencies are satisfied by earlier waves. Team capacity may split a wave further; it must not move an issue earlier.

## Wave 1

[TN-001](../06-issues/tn-001-clear-product-name-package-scope-and-repository-identity.md)

## Wave 2

[TN-002](../06-issues/tn-002-freeze-product-charter-target-workload-and-non-goals.md)

## Wave 3

[TN-003](../06-issues/tn-003-define-supported-ios-and-android-baseline-matrix.md), [TN-004](../06-issues/tn-004-create-monorepo-skeleton-licensing-ownership-and-contribution-rules.md)

## Wave 4

[TN-005](../06-issues/tn-005-create-architecture-spike-benchmark-and-evidence-harness.md), [TN-006](../06-issues/tn-006-freeze-the-minimal-native-engine-and-embedder-spike-contract.md)

## Wave 5

[TN-007](../06-issues/tn-007-implement-c-20-ios-and-android-skia-vertical-slice.md), [TN-008](../06-issues/tn-008-implement-rust-ios-and-android-skia-vertical-slice.md), [TN-010](../06-issues/tn-010-freeze-the-javascript-runtime-host-adapter.md), [TN-014](../06-issues/tn-014-freeze-the-layout-backend-adapter-and-conformance-corpus.md)

## Wave 6

[TN-009](../06-issues/tn-009-score-and-select-the-initial-native-engine-language.md), [TN-011](../06-issues/tn-011-implement-quickjs-ng-runtime-spike.md), [TN-012](../06-issues/tn-012-implement-hermes-runtime-spike.md), [TN-015](../06-issues/tn-015-implement-yoga-layout-spike.md), [TN-016](../06-issues/tn-016-implement-taffy-layout-spike.md)

## Wave 7

[TN-013](../06-issues/tn-013-select-the-initial-embedded-javascript-runtime.md)

## Wave 8

[TN-017](../06-issues/tn-017-select-the-initial-layout-backend-and-close-m0.md)

## Wave 9

[TN-018](../06-issues/tn-018-create-selected-native-engine-build-workspace.md), [TN-019](../06-issues/tn-019-create-typescript-package-workspace-and-strict-configuration.md)

## Wave 10

[TN-020](../06-issues/tn-020-implement-custom-jsx-jsxs-fragment-runtime.md), [TN-021](../06-issues/tn-021-implement-project-configuration-schema-and-loader.md), [TN-024](../06-issues/tn-024-implement-native-runtime-host-lifecycle.md), [TN-026](../06-issues/tn-026-implement-ios-application-embedder-shell.md), [TN-027](../06-issues/tn-027-implement-android-application-embedder-shell.md)

## Wave 11

[TN-022](../06-issues/tn-022-implement-module-graph-and-asset-manifest-builder.md), [TN-025](../06-issues/tn-025-implement-bounded-host-value-and-callback-abi.md)

## Wave 12

[TN-023](../06-issues/tn-023-implement-runtime-compatible-bundle-or-bytecode-compiler.md)

## Wave 13

[TN-028](../06-issues/tn-028-load-and-execute-a-verified-application-bundle-on-ios.md), [TN-029](../06-issues/tn-029-load-and-execute-a-verified-application-bundle-on-android.md)

## Wave 14

[TN-030](../06-issues/tn-030-implement-cross-layer-structured-error-codes-and-crash-boundaries.md)

## Wave 15

[TN-031](../06-issues/tn-031-implement-unified-development-log-transport.md), [TN-097](../06-issues/tn-097-specify-native-module-idl-and-compatibility-manifest.md)

## Wave 16

[TN-032](../06-issues/tn-032-close-the-executable-runtime-and-embedder-gate.md), [TN-098](../06-issues/tn-098-generate-typescript-engine-swift-kotlin-and-mock-native-module-bindings.md)

## Wave 17

[TN-033](../06-issues/tn-033-implement-generation-safe-node-ids-and-arenas.md), [TN-099](../06-issues/tn-099-implement-permission-and-application-lifecycle-services.md)

## Wave 18

[TN-034](../06-issues/tn-034-implement-host-widget-kind-and-property-schema-registry.md), [TN-100](../06-issues/tn-100-implement-clipboard-storage-network-status-and-secure-storage-reference-modules.md)

## Wave 19

[TN-035](../06-issues/tn-035-specify-mutation-transaction-binary-format.md)

## Wave 20

[TN-036](../06-issues/tn-036-implement-mutation-encoder-in-typescript.md), [TN-037](../06-issues/tn-037-implement-fail-closed-native-transaction-validator.md)

## Wave 21

[TN-038](../06-issues/tn-038-implement-atomic-scene-tree-transaction-application.md)

## Wave 22

[TN-039](../06-issues/tn-039-implement-scene-dirty-state-propagation.md), [TN-040](../06-issues/tn-040-implement-selected-layout-adapter.md), [TN-042](../06-issues/tn-042-implement-renderer-neutral-display-list.md)

## Wave 23

[TN-041](../06-issues/tn-041-implement-intrinsic-measurement-callbacks.md), [TN-043](../06-issues/tn-043-implement-ios-skia-gpu-surface-and-lifecycle.md), [TN-044](../06-issues/tn-044-implement-android-skia-gpu-surface-and-fallback-policy.md), [TN-047](../06-issues/tn-047-implement-hit-testing-across-transforms-and-clips.md)

## Wave 24

[TN-045](../06-issues/tn-045-implement-skia-display-list-playback.md)

## Wave 25

[TN-046](../06-issues/tn-046-implement-image-resource-decode-upload-and-cache-lifecycle.md), [TN-048](../06-issues/tn-048-implement-frame-scheduler-and-immutable-frame-snapshots.md)

## Wave 26

[TN-049](../06-issues/tn-049-implement-renderer-mock-and-deterministic-clock.md)

## Wave 27

[TN-050](../06-issues/tn-050-close-scene-layout-render-vertical-slice-gate.md)

## Wave 28

[TN-051](../06-issues/tn-051-implement-function-widget-execution-and-child-normalization.md)

## Wave 29

[TN-052](../06-issues/tn-052-implement-keyed-reconciliation-identity-rules.md)

## Wave 30

[TN-053](../06-issues/tn-053-implement-property-diffing-and-event-handle-registration.md)

## Wave 31

[TN-054](../06-issues/tn-054-implement-root-scheduling-and-bounded-reconciliation.md)

## Wave 32

[TN-055](../06-issues/tn-055-implement-controller-definition-and-typed-state-initialization.md)

## Wave 33

[TN-056](../06-issues/tn-056-implement-typed-action-definition-and-dispatch.md), [TN-062](../06-issues/tn-062-specify-typed-route-and-navigation-state-model.md)

## Wave 34

[TN-057](../06-issues/tn-057-implement-atomic-controller-state-transactions.md), [TN-059](../06-issues/tn-059-implement-one-file-screen-tsx-normalization.md)

## Wave 35

[TN-058](../06-issues/tn-058-implement-cancellable-async-effects-and-concurrency-policies.md), [TN-060](../06-issues/tn-060-implement-split-controller-view-screen-normalization.md)

## Wave 36

[TN-061](../06-issues/tn-061-implement-controller-and-widget-error-boundaries.md), [TN-063](../06-issues/tn-063-implement-stack-navigation-and-screen-lifecycle.md), [TN-109](../06-issues/tn-109-implement-controller-action-and-effect-unit-test-harness.md)

## Wave 37

[TN-064](../06-issues/tn-064-implement-deep-link-parsing-and-invalid-route-policy.md), [TN-065](../06-issues/tn-065-implement-android-back-and-ios-interactive-navigation-hooks.md), [TN-066](../06-issues/tn-066-implement-versioned-navigation-and-controller-state-restoration.md)

## Wave 38

[TN-067](../06-issues/tn-067-close-controller-action-navigation-gate.md)

## Wave 39

[TN-068](../06-issues/tn-068-implement-theme-tokens-and-inherited-widget-context.md)

## Wave 40

[TN-069](../06-issues/tn-069-implement-view-text-fragment-and-spacer-host-widgets.md), [TN-075](../06-issues/tn-075-implement-text-shaping-paragraph-layout-and-font-fallback-service.md), [TN-086](../06-issues/tn-086-implement-native-animation-graph-curves-and-springs.md)

## Wave 41

[TN-070](../06-issues/tn-070-implement-row-column-expanded-and-flexible-widgets.md), [TN-071](../06-issues/tn-071-implement-stack-positioned-align-and-center-widgets.md), [TN-073](../06-issues/tn-073-implement-pressable-button-iconbutton-and-interaction-states.md), [TN-074](../06-issues/tn-074-implement-image-icon-card-divider-badge-and-progress-widgets.md), [TN-076](../06-issues/tn-076-implement-editable-text-model-and-revision-protocol.md), [TN-087](../06-issues/tn-087-implement-animated-widgets-transitions-and-layout-invalidation-rules.md)

## Wave 42

[TN-072](../06-issues/tn-072-implement-safearea-scaffold-appbar-and-page-shell-widgets.md), [TN-077](../06-issues/tn-077-implement-ios-text-input-and-ime-adapter.md), [TN-078](../06-issues/tn-078-implement-android-text-input-and-ime-adapter.md), [TN-081](../06-issues/tn-081-implement-native-focus-tree-scopes-traversal-and-restoration.md), [TN-082](../06-issues/tn-082-implement-gesture-arena-and-core-recognizers.md)

## Wave 43

[TN-079](../06-issues/tn-079-implement-textfield-textarea-validation-and-form-widgets.md), [TN-080](../06-issues/tn-080-implement-clipboard-caret-selection-handles-and-text-commands.md), [TN-083](../06-issues/tn-083-implement-native-scroll-node-and-platform-physics.md), [TN-088](../06-issues/tn-088-implement-overlay-dialog-sheet-toast-and-modal-focus-behavior.md)

## Wave 44

[TN-084](../06-issues/tn-084-implement-scrollview-widget-and-nested-scroll-policy.md), [TN-089](../06-issues/tn-089-implement-semantics-node-model-and-scene-projection.md)

## Wave 45

[TN-085](../06-issues/tn-085-implement-lazy-listview-builder-and-recycling-window.md), [TN-090](../06-issues/tn-090-implement-ios-voiceover-bridge-and-focus-synchronization.md), [TN-091](../06-issues/tn-091-implement-android-talkback-bridge-and-focus-synchronization.md), [TN-093](../06-issues/tn-093-implement-locale-rtl-bidi-layout-and-localized-resource-hooks.md), [TN-094](../06-issues/tn-094-specify-platform-view-lifecycle-and-composition-contract.md), [TN-110](../06-issues/tn-110-implement-headless-reconciler-layout-scene-and-semantics-test-host.md)

## Wave 46

[TN-092](../06-issues/tn-092-implement-text-scaling-high-contrast-inputs-and-reduced-motion-policy.md), [TN-095](../06-issues/tn-095-implement-webview-platform-view-adapter.md), [TN-096](../06-issues/tn-096-implement-map-or-camera-platform-view-reference-adapter.md), [TN-101](../06-issues/tn-101-implement-asset-font-locale-and-application-service-registration.md), [TN-102](../06-issues/tn-102-implement-ios-framework-packaging-symbols-and-sample-app-assembly.md), [TN-103](../06-issues/tn-103-implement-android-library-packaging-symbols-and-sample-app-assembly.md), [TN-111](../06-issues/tn-111-implement-skia-golden-rendering-and-controlled-update-workflow.md), [TN-113](../06-issues/tn-113-fuzz-mutation-protocol-resource-inputs-deep-links-and-native-module-codecs.md)

## Wave 47

[TN-104](../06-issues/tn-104-close-accessible-mobile-application-foundation-gate.md), [TN-105](../06-issues/tn-105-implement-create-tenun-and-project-generation-cli.md)

## Wave 48

[TN-106](../06-issues/tn-106-implement-unified-build-run-device-log-test-and-package-commands.md)

## Wave 49

[TN-107](../06-issues/tn-107-implement-development-bundle-server-and-fast-refresh-protocol.md), [TN-112](../06-issues/tn-112-implement-physical-device-ime-and-accessibility-automation-plus-manual-scripts.md), [TN-115](../06-issues/tn-115-implement-physical-device-startup-frame-list-bridge-and-js-stall-benchmarks.md), [TN-116](../06-issues/tn-116-implement-memory-leak-lifecycle-and-long-run-soak-suite.md)

## Wave 50

[TN-108](../06-issues/tn-108-implement-source-maps-and-cross-layer-development-error-overlay.md)

## Wave 51

[TN-114](../06-issues/tn-114-complete-threat-model-release-mode-hardening-and-capability-audit.md), [TN-117](../06-issues/tn-117-implement-inspector-frame-timeline-transaction-viewer-and-diagnostics-export.md)

## Wave 52

[TN-118](../06-issues/tn-118-close-public-alpha-release-gate.md)

## Wave 53

[TN-119](../06-issues/tn-119-build-full-reference-business-application.md), [TN-120](../06-issues/tn-120-select-and-instrument-a-real-pilot-application.md)

## Wave 54

[TN-121](../06-issues/tn-121-migrate-pilot-vertical-slices-and-record-framework-gaps.md)

## Wave 55

[TN-122](../06-issues/tn-122-review-and-simplify-public-api-from-pilot-evidence.md)

## Wave 56

[TN-123](../06-issues/tn-123-freeze-package-boundaries-versioning-and-compatibility-policy.md), [TN-127](../06-issues/tn-127-close-performance-and-memory-acceptance-budgets.md)

## Wave 57

[TN-124](../06-issues/tn-124-publish-application-tutorial-and-architecture-guide.md), [TN-125](../06-issues/tn-125-publish-widget-native-module-and-platform-view-author-guides.md), [TN-128](../06-issues/tn-128-produce-store-installable-ios-and-android-release-candidates.md)

## Wave 58

[TN-126](../06-issues/tn-126-complete-independent-accessibility-review-and-remediation.md)

## Wave 59

[TN-129](../06-issues/tn-129-run-beta-stabilization-compatibility-upgrade-and-rollback-campaign.md)

## Wave 60

[TN-130](../06-issues/tn-130-close-beta-gate-and-publish-evidence-index.md)

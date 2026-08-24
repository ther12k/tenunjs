---
okf_version: 0.2
title: "M2: Native scene, layout, and Skia rendering"
summary: "Establish the validated transaction-to-frame path and deterministic headless engine."
type: index
status: accepted
---

# M2 — Native scene, layout, and Skia rendering

Establish the validated transaction-to-frame path and deterministic headless engine.

| Issue | Priority | Dependencies | Required outcome |
| --- | --- | --- | --- |
| [TN-033](tn-033-implement-generation-safe-node-ids-and-arenas.md) | P0 | TN-018, TN-032 | Stale node references fail closed and ownership is deterministic. |
| [TN-034](tn-034-implement-host-widget-kind-and-property-schema-registry.md) | P0 | TN-020, TN-033 | Numeric widget kinds and generated typed property codecs share one canonical manifest. |
| [TN-035](tn-035-specify-mutation-transaction-binary-format.md) | P0 | TN-025, TN-033, TN-034 | Versioned bounded operation format with fixtures and compatibility rules. |
| [TN-036](tn-036-implement-mutation-encoder-in-typescript.md) | P0 | TN-020, TN-035 | Deterministic typed-array encoder produces canonical transaction bytes. |
| [TN-037](tn-037-implement-fail-closed-native-transaction-validator.md) | P0 | TN-033, TN-035 | Malformed sizes, opcodes, node graphs, props, and generations are rejected before mutation. |
| [TN-038](tn-038-implement-atomic-scene-tree-transaction-application.md) | P0 | TN-033, TN-034, TN-037 | Validated create/update/insert/move/remove/destroy operations commit atomically. |
| [TN-039](tn-039-implement-scene-dirty-state-propagation.md) | P1 | TN-038 | Layout, paint, hit-test, and semantics dirtiness propagate independently and minimally. |
| [TN-040](tn-040-implement-selected-layout-adapter.md) | P0 | TN-017, TN-034, TN-038 | Native scene nodes map to selected layout backend with lifecycle-safe ownership. |
| [TN-041](tn-041-implement-intrinsic-measurement-callbacks.md) | P0 | TN-040 | Text, images, and platform placeholders can measure under bounded constraints. |
| [TN-042](tn-042-implement-renderer-neutral-display-list.md) | P0 | TN-034, TN-038 | Immutable bounded draw operations represent one frame without Skia pointers. |
| [TN-043](tn-043-implement-ios-skia-gpu-surface-and-lifecycle.md) | P0 | TN-026, TN-042 | Metal-backed surface handles resize, background, foreground, and context loss. |
| [TN-044](tn-044-implement-android-skia-gpu-surface-and-fallback-policy.md) | P0 | TN-027, TN-042 | Vulkan or measured fallback surface handles resize and context lifecycle. |
| [TN-045](tn-045-implement-skia-display-list-playback.md) | P0 | TN-042, TN-043, TN-044 | Core transforms, clips, opacity, rounded rectangles, paths, images, and text placeholders render identically. |
| [TN-046](tn-046-implement-image-resource-decode-upload-and-cache-lifecycle.md) | P1 | TN-039, TN-045 | Images use bounded async decode/upload caches with cancellation and memory pressure handling. |
| [TN-047](tn-047-implement-hit-testing-across-transforms-and-clips.md) | P0 | TN-038, TN-040 | Pointer targets and hit paths match layout, clipping, visibility, and z-order. |
| [TN-048](tn-048-implement-frame-scheduler-and-immutable-frame-snapshots.md) | P0 | TN-039, TN-045 | Frames consume stable scene snapshots and coalesce redundant scheduling safely. |
| [TN-049](tn-049-implement-renderer-mock-and-deterministic-clock.md) | P0 | TN-042, TN-048 | Engine tests run headlessly with inspectable display lists and time. |
| [TN-050](tn-050-close-scene-layout-render-vertical-slice-gate.md) | P0 | TN-036, TN-037, TN-041, TN-045, TN-046, TN-047, TN-048, TN-049 | Validated TS transaction renders interactive layout on both physical platforms and passes headless replay. |

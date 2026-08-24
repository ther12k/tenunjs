---
okf_version: 0.2
title: "M4: Core widgets, text input, scrolling, and animation"
summary: "Make ordinary mobile UI usable and responsive on both platforms."
type: index
status: accepted
---

# M4 — Core widgets, text input, scrolling, and animation

Make ordinary mobile UI usable and responsive on both platforms.

| Issue | Priority | Dependencies | Required outcome |
| --- | --- | --- | --- |
| [TN-068](tn-068-implement-theme-tokens-and-inherited-widget-context.md) | P1 | TN-051, TN-067 | Typed colors, spacing, radius, typography, locale, scale, and platform values flow predictably. |
| [TN-069](tn-069-implement-view-text-fragment-and-spacer-host-widgets.md) | P0 | TN-041, TN-045, TN-053, TN-068 | Foundational semantic widgets render, layout, inspect, and diff correctly. |
| [TN-070](tn-070-implement-row-column-expanded-and-flexible-widgets.md) | P0 | TN-040, TN-069 | Flutter-inspired flex composition maps predictably to the selected layout backend. |
| [TN-071](tn-071-implement-stack-positioned-align-and-center-widgets.md) | P1 | TN-040, TN-069 | Overlay and alignment composition handles constraints, clipping, and hit testing. |
| [TN-072](tn-072-implement-safearea-scaffold-appbar-and-page-shell-widgets.md) | P0 | TN-043, TN-044, TN-068, TN-070 | Insets and application shell behavior respond to platform/window changes. |
| [TN-073](tn-073-implement-pressable-button-iconbutton-and-interaction-states.md) | P0 | TN-047, TN-056, TN-068, TN-069 | Touch, keyboard, disabled, pressed, focus, and semantic actions share one action path. |
| [TN-074](tn-074-implement-image-icon-card-divider-badge-and-progress-widgets.md) | P1 | TN-046, TN-068, TN-069 | Common visual primitives have typed semantics, loading, error, and theme behavior. |
| [TN-075](tn-075-implement-text-shaping-paragraph-layout-and-font-fallback-service.md) | P0 | TN-041, TN-045, TN-068 | Unicode, bidi, fallback, line breaking, scaling, truncation, and measurement fixtures pass. |
| [TN-076](tn-076-implement-editable-text-model-and-revision-protocol.md) | P0 | TN-055, TN-075 | Text, composing range, selection, commands, and controller synchronization are revision-safe. |
| [TN-077](tn-077-implement-ios-text-input-and-ime-adapter.md) | P0 | TN-026, TN-043, TN-076 | Typing, composition, selection, secure entry, autofill, and keyboard geometry work on device. |
| [TN-078](tn-078-implement-android-text-input-and-ime-adapter.md) | P0 | TN-027, TN-044, TN-076 | InputConnection lifecycle, composition, selection, actions, autofill, and keyboard insets work on device. |
| [TN-079](tn-079-implement-textfield-textarea-validation-and-form-widgets.md) | P0 | TN-056, TN-068, TN-076, TN-077, TN-078 | Typed fields expose labels, errors, submit actions, keyboard intent, and accessible state. |
| [TN-080](tn-080-implement-clipboard-caret-selection-handles-and-text-commands.md) | P1 | TN-076, TN-077, TN-078 | Copy/cut/paste/select-all and selection geometry respect platform behavior. |
| [TN-081](tn-081-implement-native-focus-tree-scopes-traversal-and-restoration.md) | P0 | TN-047, TN-069, TN-073, TN-076 | Touch, keyboard, modal, navigation, and accessibility focus have deterministic coordination. |
| [TN-082](tn-082-implement-gesture-arena-and-core-recognizers.md) | P0 | TN-047, TN-073 | Tap, long press, pan, scale, cancellation, and nested competition pass event traces. |
| [TN-083](tn-083-implement-native-scroll-node-and-platform-physics.md) | P0 | TN-048, TN-082 | Offsets, momentum, bounds, overscroll, commands, and coalesced observations remain native-side. |
| [TN-084](tn-084-implement-scrollview-widget-and-nested-scroll-policy.md) | P0 | TN-070, TN-071, TN-081, TN-083 | Viewport layout, clipping, focus reveal, keyboard insets, and nested gestures work consistently. |
| [TN-085](tn-085-implement-lazy-listview-builder-and-recycling-window.md) | P0 | TN-052, TN-069, TN-083, TN-084 | Large logical lists materialize bounded rows while preserving keys, semantics, and focus. |
| [TN-086](tn-086-implement-native-animation-graph-curves-and-springs.md) | P0 | TN-048, TN-068 | Supported values animate on the native frame clock with cancellation and completion semantics. |
| [TN-087](tn-087-implement-animated-widgets-transitions-and-layout-invalidation-rules.md) | P1 | TN-054, TN-069, TN-086 | Enter/exit, transform, opacity, color, and declared layout animations integrate with reconciliation. |
| [TN-088](tn-088-implement-overlay-dialog-sheet-toast-and-modal-focus-behavior.md) | P0 | TN-063, TN-072, TN-073, TN-081, TN-087 | Layering, dismissal, back handling, accessibility focus, and safe areas behave on both platforms. |

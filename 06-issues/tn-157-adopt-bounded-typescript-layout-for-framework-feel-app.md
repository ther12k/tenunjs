---
okf_version: 0.2
title: "TN-157: Adopt bounded TypeScript layout for the framework-feel app"
summary: "First TN-155 slice: propagate finite viewport constraints through the current framework lowering, expose a runtime viewport update, and exercise the result in an ordinary two-screen TSX application."
type: issue
status: in-progress
issue_id: "TN-157"
milestone: "M4"
priority: "P0"
depends_on:
  - "TN-133"
  - "TN-156"
---

# TN-157 — Adopt bounded TypeScript layout for the framework-feel app

## Metadata

| Field | Value |
| --- | --- |
| Parent milestone | TN-155 — framework-feel application |
| Dependencies | TN-133 (public execution/lowering), TN-156 (frozen layout semantics); both closed |
| Suggested size | One framework-layout slice with a small executable application |
| Gate impact | Foundation for TN-155 requirements 1, 2, 6, and shared-bundle execution evidence |

## Why this slice comes first

The current lowering accepts only a maximum width. An explicit outer
height is painted but never reaches its descendants: a 300×100 SizedBox
containing a Column with two Expanded Containers paints both at height
zero. The frozen TN-156 rule requires two 300×50 children.

This issue implements the existing framework-side TypeScript path, whose
public execution contract is already owned by TN-133. It uses the execution
home chosen by TN-156 and does not guess a selected native-layout API.
TN-070, TN-071, and TN-072 retain their broader widget/property-schema,
selected-backend, accessibility, and milestone evidence responsibilities.
Their dependencies and closure criteria are not waived or marked complete
by this narrower implementation.

## Implementation note

Extend `layoutScreen` with a finite `LayoutViewport` input while preserving
the existing numeric-width call's unbounded root height. Carry bounded
height through wrappers and share flex allocation between measurement and
placement. Expose a validated `ApplicationRuntime.setViewport()` operation
that preserves route/controller state and invalidates geometry and tap
bindings. Supply one ordinary two-screen Day Plan application under
`examples/framework-feel`, with a single custom progress visual.

Viewport updates in this slice are explicit runtime calls. Current browser
and Android hosts still scale/repaint on surface resizing; automatic metric
delivery needs a separately reviewed input/capability contract and unit
mapping. No host-resize conformance is inferred from a runtime test.

## Required outcome

- Finite constraints reach SizedBox, padded Container/Card, Scaffold body,
  Row/Column, Expanded, Center, GestureDetector, and opposing-edge
  Positioned placement. Weighted flex, gaps, padding, justify-center, and
  cross-axis stretch have observable geometry and matching hit regions.
- Expanded in an unbounded main axis fails visibly. Invalid viewport
  dimensions fail before modifying runtime state. Exhausted bounded free
  space has a genuine zero share, not an invented one-unit allocation.
- A viewport update preserves route, screen state, and application snapshot
  schema. Host-surface dimensions stay outside application snapshots.
  Repeated identical updates are no-ops; disposal and stale-tap behavior
  are tested.
- Day Plan uses ordinary TSX widgets for its interface and CanvasBox only
  for its custom visual. The application never calculates child flex
  heights from viewport dimensions. Immediate navigation and actions work.
- One compiled application bundle executes through the public handoff in
  a browser-protocol driver and the real Android QuickJS bridge. Compare
  committed scene structure through the same action sequence.
- Existing valid example goldens and the external-consumer scene digest
  remain compatible. Replace the old test that deliberately allowed
  Expanded inside an unbounded Column with the frozen-contract error test.

## Verification

- Mirror TN-156 fixture-011 geometry in framework tests without changing
  `spikes/` or evidence inputs; add nested, weighted, stretched, and invalid
  cases, plus once-per-render component invocation.
- Test application actions/navigation and explicit viewport sizes with
  geometry and hit-region assertions.
- Run `bun run verify:ts`, the external-consumer rehearsal, and the native
  engine-loop gate including the new shared-bundle transcript comparison.
- Reproduce the TypeScript result from a fresh checkout and run governed
  manifest/evidence validation. Record unavailable platform gates honestly.

## Boundaries and remaining owners

This is the first TN-155 increment, not the complete milestone. It does not
add editable-text sessions (TN-076/TN-078/TN-079), independent scrolling
(TN-083/TN-084), native frame scheduling or animated transitions
(TN-048/TN-086/TN-087), or ordinary-widget semantic-theme integration
(TN-068). The first app uses the existing single-theme API. It does not add
painted substitutes for those missing controls or change display-list v1.

Physical-device rendering, actual browser/Android surface resizing, the
complete seven-requirement journey, and the README headline recording
remain TN-155 integration/closure evidence.

## Status note (2026-10-28, implementation prepared)

The branch implements bounded layout, the explicit runtime viewport API,
and Day Plan with the shared-bundle execution gate. TN-157 remains
`in-progress` pending publication and the repository CI gates; TN-155
remains open for the capability and integration work listed above.

Local verification used the pinned Bun 1.4.0 toolchain:

| Check | Evidence |
| --- | --- |
| Pre-change widget/ui-kit baseline and typecheck | 142 tests passed; all five configured TypeScript projects passed. |
| `bun run verify:ts` | Frozen install and all five typechecks passed; 507 tests passed, 0 failed, 2,766 assertions. |
| Fresh-worktree `bun run verify:ts` | Same 507/0 result and 2,766 assertions from a new checkout with no installed dependencies or generated test fixtures before the run. Only this verification note and its manifest row changed afterward. |
| New bounded-layout, viewport-runtime, and app suites | 17 layout cases, 9 viewport cases, and 6 application cases are included in the full run. |
| Explicit application sizes | Tests cover 720×1000, 480×840, and 1000×720, with route/state retention, nested flex geometry, and matching tap regions. |
| `.github/scripts/verify-consumer.sh` | Passed package installation, both JSX transforms, the unchanged committed scene digest, host execution, and the application-only variant. Bun emitted nonfatal directory-mismatch diagnostics; builds and assertions passed. |
| `embedders/android/run_android_test.sh` | C bridge and real QuickJS loops passed for the existing asset, compiled counter, Polytron, and Day Plan. Day Plan's same bundle and seven actions produced eight structurally equal script-host/native scenes. SDK-dependent Gradle/APK/NDK steps were unavailable. |
| Manifest validation and checker selftest | Passed, including mutation detection. |
| Evidence validation and checker selftest | All three existing packets passed structural validation, and checker mutation tests passed. Native artifact replay was not run. |

Review caught two constraint-provenance regressions: placement inferred
tight bounds from a measured size, and Stack remeasured its sizing child
under its discovered height. Both now retain the original measured
constraints. Regressions distinguish centered and stretched children and
verify that wrapping the centered Row in Stack preserves its Card box
(`x=100, y=22, w=79.6, h=56`).

The new core fixture uses the package's existing explicit `jsx`/`jsxs`
pattern so Bun's source dependency scanner does not infer React imports.
The dependency guard is unchanged; Day Plan's actual screens remain TSX.

Rust, ABI, native-probe/replay, emulator/device, and hosted CI results are
not claimed by this local evidence. No `spikes/` or `benchmarks/` inputs or
evidence artifacts changed. The scene comparison proves shared execution
and data, not actual browser/Android painting or host resize delivery.

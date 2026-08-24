---
okf_version: 0.2
title: "TN-104: Close accessible mobile application foundation gate"
summary: "Reference app passes form, list, navigation, text input, accessibility, module, and platform-view journeys."
type: issue
status: ready
issue_id: "TN-104"
milestone: "M5"
priority: "P0"
depends_on:
  - "TN-072"
  - "TN-079"
  - "TN-080"
  - "TN-084"
  - "TN-085"
  - "TN-088"
  - "TN-090"
  - "TN-091"
  - "TN-092"
  - "TN-093"
  - "TN-095"
  - "TN-096"
  - "TN-100"
  - "TN-101"
  - "TN-102"
  - "TN-103"
---

# TN-104 — Close accessible mobile application foundation gate

## Metadata

| Field | Value |
|---|---|
| Milestone | M5 — Accessibility, native capabilities, and packaging |
| Priority | P0 |
| Dependencies | TN-072, TN-079, TN-080, TN-084, TN-085, TN-088, TN-090, TN-091, TN-092, TN-093, TN-095, TN-096, TN-100, TN-101, TN-102, TN-103 |
| Suggested size | One focused worktree and PR |
| Gate impact | Milestone/gate critical |

## Required outcome

Reference app passes form, list, navigation, text input, accessibility, module, and platform-view journeys.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-072](tn-072-implement-safearea-scaffold-appbar-and-page-shell-widgets.md), [TN-079](tn-079-implement-textfield-textarea-validation-and-form-widgets.md), [TN-080](tn-080-implement-clipboard-caret-selection-handles-and-text-commands.md), [TN-084](tn-084-implement-scrollview-widget-and-nested-scroll-policy.md), [TN-085](tn-085-implement-lazy-listview-builder-and-recycling-window.md), [TN-088](tn-088-implement-overlay-dialog-sheet-toast-and-modal-focus-behavior.md), [TN-090](tn-090-implement-ios-voiceover-bridge-and-focus-synchronization.md), [TN-091](tn-091-implement-android-talkback-bridge-and-focus-synchronization.md), [TN-092](tn-092-implement-text-scaling-high-contrast-inputs-and-reduced-motion-policy.md), [TN-093](tn-093-implement-locale-rtl-bidi-layout-and-localized-resource-hooks.md), [TN-095](tn-095-implement-webview-platform-view-adapter.md), [TN-096](tn-096-implement-map-or-camera-platform-view-reference-adapter.md), [TN-100](tn-100-implement-clipboard-storage-network-status-and-secure-storage-reference-modules.md), [TN-101](tn-101-implement-asset-font-locale-and-application-service-registration.md), [TN-102](tn-102-implement-ios-framework-packaging-symbols-and-sample-app-assembly.md), [TN-103](tn-103-implement-android-library-packaging-symbols-and-sample-app-assembly.md)

Do not start implementation against guessed dependency APIs. When a dependency is incomplete or its accepted behavior conflicts with this issue, stop the patch at the boundary and record the conflict as a blocker or ADR proposal.

## Required reading

- [product-definition.md](../00-project/product-definition.md)
- [principles.md](../00-project/principles.md)
- [definition-of-done.md](../05-delivery/definition-of-done.md)
- [accessibility-semantics.md](../02-architecture/accessibility-semantics.md)
- [native-modules-platform-views.md](../02-architecture/native-modules-platform-views.md)

## Likely touch points

- `engine/semantics/`
- `packages/native-modules/`
- `embedders/ios/`
- `embedders/android/`

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **Reference app passes form, list, navigation, text input, accessibility, module, and platform-view journeys.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Specify role/state/action/focus behavior for both iOS and Android instead of relying only on labels.
5. Add headless semantic snapshots plus physical-device assistive-technology journeys.
6. Cover text scaling, RTL, modal transitions, dynamic updates, and platform-view handoff.
7. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
8. Update generated files, architecture references, and migration notes only when this issue changes their contract.
9. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Reference app passes form, list, navigation, text input, accessibility, module, and platform-view journeys.
- [ ] Public/internal types compile under strict settings with no unexplained escape to `any` or unsafe pointer/value casts.
- [ ] Positive and fail-closed behavior are both covered by automated tests.
- [ ] Ownership, lifecycle, cancellation, and disposal behavior are documented where the issue creates durable state.
- [ ] No unresolved placeholder, silent fallback, or platform-only success is represented as complete.
- [ ] Relevant generated artifacts are reproducible and drift-checked.
- [ ] The issue stays within its declared scope; adjacent changes have separate issue references.
- [ ] Reviewer can reproduce the result from a clean checkout using recorded commands.

## Required test matrix

- [ ] Unit tests for the owned contract and failure codes.
- [ ] A regression test that fails before the change and passes after it.
- [ ] Clean-build or clean-test reproduction from the documented command.
- [ ] Headless semantic snapshot and manual assistive-technology journey.
- [ ] Focus order, action dispatch, modal restore, and text-scaling cases.

## Required closure evidence

- [ ] Commit/PR reference and exact changed-file inventory.
- [ ] Commands used and complete pass/fail summary.
- [ ] Relevant generated contract or API diff.
- [ ] Negative-case evidence showing the boundary fails as designed.
- [ ] Device/OS/build-mode metadata for every platform claim.
- [ ] Decision/gate matrix with every criterion and link.
- [ ] Explicit residual risks, owner, and revisit/rollback trigger.

## Out of scope

- Features assigned to later issue IDs.
- Unrelated refactors, formatting sweeps, dependency upgrades, or API renaming.
- Desktop, web, React compatibility, or a full Flutter/Material clone unless this issue explicitly names it.
- Benchmark claims from simulators when a physical-device result is required.
- Temporary bypasses that weaken protocol validation, capability checks, accessibility, or lifecycle ownership.

## Review prompts

A reviewer should ask:

1. Does the patch implement exactly the declared outcome?
2. Can malformed, stale, cancelled, disposed, or platform-divergent input violate an invariant?
3. Is the failure attributable to the correct layer with an actionable diagnostic?
4. Are physical-device claims backed by device evidence?
5. Did the change accidentally expose the selected engine/runtime/layout implementation to application code?
6. Could a smaller patch close the same contract more safely?

## Agent handoff format

Return a concise Markdown handoff containing:

```text
Issue: TN-104
Result: PASS | PARTIAL | BLOCKED
Commit(s): <hashes>
Contracts changed: <list or none>
Tests: <commands and results>
Device evidence: <links/paths or not applicable>
Generated drift: PASS | FAIL | not applicable
Residual risks: <explicit list>
Follow-up issue references: <IDs only>
```

Do not claim completion when any acceptance checkbox or required evidence item remains unresolved.

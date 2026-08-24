---
okf_version: 0.2
title: "TN-117: Implement inspector, frame timeline, transaction viewer, and diagnostics export"
summary: "Developers can inspect widget/layout/semantics state and export sanitized replay evidence."
type: issue
status: ready
issue_id: "TN-117"
milestone: "M6"
priority: "P1"
depends_on:
  - "TN-039"
  - "TN-048"
  - "TN-054"
  - "TN-089"
  - "TN-108"
---

# TN-117 — Implement inspector, frame timeline, transaction viewer, and diagnostics export

## Metadata

| Field | Value |
|---|---|
| Milestone | M6 — Developer experience, hardening, and public alpha |
| Priority | P1 |
| Dependencies | TN-039, TN-048, TN-054, TN-089, TN-108 |
| Suggested size | One focused worktree and PR |
| Gate impact | Required supporting work |

## Required outcome

Developers can inspect widget/layout/semantics state and export sanitized replay evidence.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-039](tn-039-implement-scene-dirty-state-propagation.md), [TN-048](tn-048-implement-frame-scheduler-and-immutable-frame-snapshots.md), [TN-054](tn-054-implement-root-scheduling-and-bounded-reconciliation.md), [TN-089](tn-089-implement-semantics-node-model-and-scene-projection.md), [TN-108](tn-108-implement-source-maps-and-cross-layer-development-error-overlay.md)

Do not start implementation against guessed dependency APIs. When a dependency is incomplete or its accepted behavior conflicts with this issue, stop the patch at the boundary and record the conflict as a blocker or ADR proposal.

## Required reading

- [product-definition.md](../00-project/product-definition.md)
- [principles.md](../00-project/principles.md)
- [definition-of-done.md](../05-delivery/definition-of-done.md)
- [testing-strategy.md](../02-architecture/testing-strategy.md)
- [error-observability.md](../02-architecture/error-observability.md)
- [release-strategy.md](../05-delivery/release-strategy.md)

## Likely touch points

- `packages/cli/`
- `packages/testing/`
- `benchmarks/`
- `tools/`
- `engine/text/`

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **Developers can inspect widget/layout/semantics state and export sanitized replay evidence.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Specify ownership, generations, bounds, legal operation ordering, and atomic failure behavior.
5. Add malformed, stale, cyclic, duplicate, out-of-range, and use-after-destroy fixtures.
6. Provide a record/replay representation suitable for headless debugging.
7. Define lifecycle, generation, reentrancy, cancellation, stale completion, and thrown-error semantics.
8. Test synchronous and asynchronous transitions with a deterministic clock and fake services.
9. Ensure one-file and split source forms converge on the same manifest/runtime behavior.
10. Use real Unicode, emoji, bidi, composing-text, selection, secure-entry, and autofill fixtures.
11. Run physical-device journeys with at least two IMEs/keyboards per platform where practical.
12. Protect controller state with edit-session revisions so stale callbacks cannot overwrite newer text.
13. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
14. Update generated files, architecture references, and migration notes only when this issue changes their contract.
15. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Developers can inspect widget/layout/semantics state and export sanitized replay evidence.
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
- [ ] Deterministic lifecycle, cancellation, stale completion, and thrown-error cases.
- [ ] One-file/split behavior parity where applicable.
- [ ] Composition, selection, emoji, bidi, secure entry, keyboard action, and stale-revision cases.
- [ ] Controlled 200 ms JavaScript-stall case.
- [ ] Frame pacing and cancellation trace on a physical mid-range device.

## Required closure evidence

- [ ] Commit/PR reference and exact changed-file inventory.
- [ ] Commands used and complete pass/fail summary.
- [ ] Relevant generated contract or API diff.
- [ ] Negative-case evidence showing the boundary fails as designed.
- [ ] Device/OS/build-mode metadata for every platform claim.

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
Issue: TN-117
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

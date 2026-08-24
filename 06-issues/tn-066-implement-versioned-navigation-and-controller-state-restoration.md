---
okf_version: 0.2
title: "TN-066: Implement versioned navigation and controller state restoration"
summary: "Restorable state survives process recreation with schema/version mismatch handling."
type: issue
status: ready
issue_id: "TN-066"
milestone: "M3"
priority: "P1"
depends_on:
  - "TN-055"
  - "TN-062"
  - "TN-063"
---

# TN-066 — Implement versioned navigation and controller state restoration

## Metadata

| Field | Value |
|---|---|
| Milestone | M3 — TSX reconciliation, controllers, actions, and navigation |
| Priority | P1 |
| Dependencies | TN-055, TN-062, TN-063 |
| Suggested size | One focused worktree and PR |
| Gate impact | Required supporting work |

## Required outcome

Restorable state survives process recreation with schema/version mismatch handling.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-055](tn-055-implement-controller-definition-and-typed-state-initialization.md), [TN-062](tn-062-specify-typed-route-and-navigation-state-model.md), [TN-063](tn-063-implement-stack-navigation-and-screen-lifecycle.md)

Do not start implementation against guessed dependency APIs. When a dependency is incomplete or its accepted behavior conflicts with this issue, stop the patch at the boundary and record the conflict as a blocker or ADR proposal.

## Required reading

- [product-definition.md](../00-project/product-definition.md)
- [principles.md](../00-project/principles.md)
- [definition-of-done.md](../05-delivery/definition-of-done.md)
- [source-organization.md](../02-architecture/source-organization.md)
- [controller-action-model.md](../02-architecture/controller-action-model.md)
- [jsx-and-reconciliation.md](../02-architecture/jsx-and-reconciliation.md)

## Likely touch points

- `packages/core/`
- `packages/jsx-runtime/`
- `packages/navigation/`
- `packages/testing/fixtures/`

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **Restorable state survives process recreation with schema/version mismatch handling.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Define lifecycle, generation, reentrancy, cancellation, stale completion, and thrown-error semantics.
5. Test synchronous and asynchronous transitions with a deterministic clock and fake services.
6. Ensure one-file and split source forms converge on the same manifest/runtime behavior.
7. Model route parameters as validated untrusted inputs and state transitions as effects.
8. Cover push/replace/pop, modal, back gesture, interruption, process recreation, and invalid snapshots.
9. Verify controller creation/disposal and focus restoration around every transition.
10. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
11. Update generated files, architecture references, and migration notes only when this issue changes their contract.
12. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Restorable state survives process recreation with schema/version mismatch handling.
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

## Required closure evidence

- [ ] Commit/PR reference and exact changed-file inventory.
- [ ] Commands used and complete pass/fail summary.
- [ ] Relevant generated contract or API diff.
- [ ] Negative-case evidence showing the boundary fails as designed.

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
Issue: TN-066
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

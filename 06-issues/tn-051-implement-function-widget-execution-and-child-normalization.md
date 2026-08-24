---
okf_version: 0.2
title: "TN-051: Implement function-widget execution and child normalization"
summary: "Pure TSX function widgets compose host nodes with deterministic child semantics."
type: issue
status: ready
issue_id: "TN-051"
milestone: "M3"
priority: "P0"
depends_on:
  - "TN-020"
  - "TN-034"
  - "TN-050"
---

# TN-051 — Implement function-widget execution and child normalization

## Metadata

| Field | Value |
|---|---|
| Milestone | M3 — TSX reconciliation, controllers, actions, and navigation |
| Priority | P0 |
| Dependencies | TN-020, TN-034, TN-050 |
| Suggested size | One focused worktree and PR |
| Gate impact | Milestone/gate critical |

## Required outcome

Pure TSX function widgets compose host nodes with deterministic child semantics.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-020](tn-020-implement-custom-jsx-jsxs-fragment-runtime.md), [TN-034](tn-034-implement-host-widget-kind-and-property-schema-registry.md), [TN-050](tn-050-close-scene-layout-render-vertical-slice-gate.md)

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
2. Write a short implementation note that states how this issue will produce: **Pure TSX function widgets compose host nodes with deterministic child semantics.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Define the TypeScript types and runtime representation before optimizing generated output.
5. Add fixtures for nested arrays, null/boolean children, fragments, keys, source locations, and invalid props.
6. Assert deterministic mutation traces and actionable development diagnostics.
7. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
8. Update generated files, architecture references, and migration notes only when this issue changes their contract.
9. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Pure TSX function widgets compose host nodes with deterministic child semantics.
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
- [ ] Headless structural fixture plus controlled visual/golden evidence.
- [ ] Scale factor, RTL, clipping, and resource-disposal cases where applicable.

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
Issue: TN-051
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

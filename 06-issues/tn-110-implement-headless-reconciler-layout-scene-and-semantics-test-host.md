---
okf_version: 0.2
title: "TN-110: Implement headless reconciler, layout, scene, and semantics test host"
summary: "TS tests mount screens and inspect mutations, layout, display lists, focus, and semantics."
type: issue
status: ready
issue_id: "TN-110"
milestone: "M6"
priority: "P0"
depends_on:
  - "TN-049"
  - "TN-052"
  - "TN-089"
  - "TN-109"
---

# TN-110 — Implement headless reconciler, layout, scene, and semantics test host

## Metadata

| Field | Value |
|---|---|
| Milestone | M6 — Developer experience, hardening, and public alpha |
| Priority | P0 |
| Dependencies | TN-049, TN-052, TN-089, TN-109 |
| Suggested size | One focused worktree and PR |
| Gate impact | Milestone/gate critical |

## Required outcome

TS tests mount screens and inspect mutations, layout, display lists, focus, and semantics.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-049](tn-049-implement-renderer-mock-and-deterministic-clock.md), [TN-052](tn-052-implement-keyed-reconciliation-identity-rules.md), [TN-089](tn-089-implement-semantics-node-model-and-scene-projection.md), [TN-109](tn-109-implement-controller-action-and-effect-unit-test-harness.md)

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
- `engine/semantics/`

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **TS tests mount screens and inspect mutations, layout, display lists, focus, and semantics.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Specify ownership, generations, bounds, legal operation ordering, and atomic failure behavior.
5. Add malformed, stale, cyclic, duplicate, out-of-range, and use-after-destroy fixtures.
6. Provide a record/replay representation suitable for headless debugging.
7. Define expected constraints and results with backend-neutral fixtures before adapter code.
8. Cover unbounded constraints, intrinsic measurement, rounding, scale factors, RTL, and incremental dirtiness.
9. Compare results on both platforms and in the deterministic headless host.
10. Specify role/state/action/focus behavior for both iOS and Android instead of relying only on labels.
11. Add headless semantic snapshots plus physical-device assistive-technology journeys.
12. Cover text scaling, RTL, modal transitions, dynamic updates, and platform-view handoff.
13. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
14. Update generated files, architecture references, and migration notes only when this issue changes their contract.
15. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** TS tests mount screens and inspect mutations, layout, display lists, focus, and semantics.
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
- [ ] Headless semantic snapshot and manual assistive-technology journey.
- [ ] Focus order, action dispatch, modal restore, and text-scaling cases.

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
Issue: TN-110
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

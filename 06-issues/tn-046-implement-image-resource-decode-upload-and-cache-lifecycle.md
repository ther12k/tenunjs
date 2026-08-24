---
okf_version: 0.2
title: "TN-046: Implement image resource decode, upload, and cache lifecycle"
summary: "Images use bounded async decode/upload caches with cancellation and memory pressure handling."
type: issue
status: ready
issue_id: "TN-046"
milestone: "M2"
priority: "P1"
depends_on:
  - "TN-039"
  - "TN-045"
---

# TN-046 — Implement image resource decode, upload, and cache lifecycle

## Metadata

| Field | Value |
|---|---|
| Milestone | M2 — Native scene, layout, and Skia rendering |
| Priority | P1 |
| Dependencies | TN-039, TN-045 |
| Suggested size | One focused worktree and PR |
| Gate impact | Required supporting work |

## Required outcome

Images use bounded async decode/upload caches with cancellation and memory pressure handling.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-039](tn-039-implement-scene-dirty-state-propagation.md), [TN-045](tn-045-implement-skia-display-list-playback.md)

Do not start implementation against guessed dependency APIs. When a dependency is incomplete or its accepted behavior conflicts with this issue, stop the patch at the boundary and record the conflict as a blocker or ADR proposal.

## Required reading

- [product-definition.md](../00-project/product-definition.md)
- [principles.md](../00-project/principles.md)
- [definition-of-done.md](../05-delivery/definition-of-done.md)
- [system-overview.md](../02-architecture/system-overview.md)
- [runtime-model.md](../02-architecture/runtime-model.md)
- [mutation-protocol.md](../02-architecture/mutation-protocol.md)

## Likely touch points

- `engine/core/`
- `engine/layout/`
- `engine/renderer-skia/`
- `packages/protocol/`

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **Images use bounded async decode/upload caches with cancellation and memory pressure handling.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Separate scene/display-list contracts from Skia object ownership and platform GPU surface lifecycle.
5. Cover context loss, resize, background/foreground, resource eviction, and disposal ordering.
6. Record GPU/API/device metadata for every visual or performance claim.
7. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
8. Update generated files, architecture references, and migration notes only when this issue changes their contract.
9. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Images use bounded async decode/upload caches with cancellation and memory pressure handling.
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
Issue: TN-046
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

---
okf_version: 0.2
title: "TN-014: Freeze the layout backend adapter and conformance corpus"
summary: "Renderer-neutral layout API and fixture corpus shared by candidates."
type: issue
status: blocked
issue_id: "TN-014"
milestone: "M0"
priority: "P0"
depends_on:
  - "TN-006"
---

# TN-014 — Freeze the layout backend adapter and conformance corpus

## Metadata

| Field | Value |
|---|---|
| Milestone | M0 — Architecture and technology gates |
| Priority | P0 |
| Dependencies | TN-006 |
| Suggested size | One focused worktree and PR |
| Gate impact | Milestone/gate critical |

> **Status note (2026-08-25):** Contract frozen but corpus coverage incomplete vs TN-014 scope; expansion tracked in #142 (M1).

> **Status note (2026-08-25, review 2):** Blocked by reversed cycle detection (FIXED 2026-08-25 review 2) — regression cases live in shared C runner; node ownership/lifecycle now specified (strict single-parent, detach-on-destroy). Remaining: corpus expansion M1.

## Required outcome

Renderer-neutral layout API and fixture corpus shared by candidates.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-006](tn-006-freeze-the-minimal-native-engine-and-embedder-spike-contract.md)

Do not start implementation against guessed dependency APIs. When a dependency is incomplete or its accepted behavior conflicts with this issue, stop the patch at the boundary and record the conflict as a blocker or ADR proposal.

## Required reading

- [product-definition.md](../00-project/product-definition.md)
- [principles.md](../00-project/principles.md)
- [definition-of-done.md](../05-delivery/definition-of-done.md)
- [language-strategy.md](../02-architecture/language-strategy.md)
- [adr-0005-engine-language-evidence-gate.md](../03-decisions/adr-0005-engine-language-evidence-gate.md)

## Likely touch points

- `docs/architecture/`
- `spikes/`
- `benchmarks/architecture/`

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **Renderer-neutral layout API and fixture corpus shared by candidates.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Define expected constraints and results with backend-neutral fixtures before adapter code.
5. Cover unbounded constraints, intrinsic measurement, rounding, scale factors, RTL, and incremental dirtiness.
6. Compare results on both platforms and in the deterministic headless host.
7. Model route parameters as validated untrusted inputs and state transitions as effects.
8. Cover push/replace/pop, modal, back gesture, interruption, process recreation, and invalid snapshots.
9. Verify controller creation/disposal and focus restoration around every transition.
10. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
11. Update generated files, architecture references, and migration notes only when this issue changes their contract.
12. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Renderer-neutral layout API and fixture corpus shared by candidates.
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
Issue: TN-014
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

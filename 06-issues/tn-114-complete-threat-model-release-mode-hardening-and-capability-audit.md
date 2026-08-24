---
okf_version: 0.2
title: "TN-114: Complete threat model, release-mode hardening, and capability audit"
summary: "Trust boundaries, debug stripping, manifest checks, secret handling, and module capabilities are reviewed."
type: issue
status: ready
issue_id: "TN-114"
milestone: "M6"
priority: "P0"
depends_on:
  - "TN-030"
  - "TN-097"
  - "TN-099"
  - "TN-108"
  - "TN-113"
---

# TN-114 — Complete threat model, release-mode hardening, and capability audit

## Metadata

| Field | Value |
|---|---|
| Milestone | M6 — Developer experience, hardening, and public alpha |
| Priority | P0 |
| Dependencies | TN-030, TN-097, TN-099, TN-108, TN-113 |
| Suggested size | One focused worktree and PR |
| Gate impact | Milestone/gate critical |

## Required outcome

Trust boundaries, debug stripping, manifest checks, secret handling, and module capabilities are reviewed.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-030](tn-030-implement-cross-layer-structured-error-codes-and-crash-boundaries.md), [TN-097](tn-097-specify-native-module-idl-and-compatibility-manifest.md), [TN-099](tn-099-implement-permission-and-application-lifecycle-services.md), [TN-108](tn-108-implement-source-maps-and-cross-layer-development-error-overlay.md), [TN-113](tn-113-fuzz-mutation-protocol-resource-inputs-deep-links-and-native-module-codecs.md)

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

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **Trust boundaries, debug stripping, manifest checks, secret handling, and module capabilities are reviewed.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Define the failure signal, environment metadata, corpus, and reproducibility procedure before implementation.
5. Include negative and lifecycle cases, not only a happy-path smoke test.
6. Store machine-readable raw evidence alongside the human summary and compare against an explicit baseline.
7. Define entrance/exit criteria, owners, evidence locations, known limitations, and rollback before declaring success.
8. Use a clean consumer project rather than relying only on framework-repository examples.
9. Verify all documented commands and code against the exact release artifacts.
10. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
11. Update generated files, architecture references, and migration notes only when this issue changes their contract.
12. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Trust boundaries, debug stripping, manifest checks, secret handling, and module capabilities are reviewed.
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
Issue: TN-114
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

---
okf_version: 0.2
title: "TN-118: Close public alpha release gate"
summary: "Versioned alpha artifacts, docs, evidence packet, known limitations, and rollback instructions are published."
type: issue
status: ready
issue_id: "TN-118"
milestone: "M6"
priority: "P0"
depends_on:
  - "TN-104"
  - "TN-105"
  - "TN-106"
  - "TN-107"
  - "TN-108"
  - "TN-109"
  - "TN-110"
  - "TN-111"
  - "TN-112"
  - "TN-113"
  - "TN-114"
  - "TN-115"
  - "TN-116"
  - "TN-117"
---

# TN-118 — Close public alpha release gate

## Metadata

| Field | Value |
|---|---|
| Milestone | M6 — Developer experience, hardening, and public alpha |
| Priority | P0 |
| Dependencies | TN-104, TN-105, TN-106, TN-107, TN-108, TN-109, TN-110, TN-111, TN-112, TN-113, TN-114, TN-115, TN-116, TN-117 |
| Suggested size | One focused worktree and PR |
| Gate impact | Milestone/gate critical |

## Required outcome

Versioned alpha artifacts, docs, evidence packet, known limitations, and rollback instructions are published.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-104](tn-104-close-accessible-mobile-application-foundation-gate.md), [TN-105](tn-105-implement-create-tenun-and-project-generation-cli.md), [TN-106](tn-106-implement-unified-build-run-device-log-test-and-package-commands.md), [TN-107](tn-107-implement-development-bundle-server-and-fast-refresh-protocol.md), [TN-108](tn-108-implement-source-maps-and-cross-layer-development-error-overlay.md), [TN-109](tn-109-implement-controller-action-and-effect-unit-test-harness.md), [TN-110](tn-110-implement-headless-reconciler-layout-scene-and-semantics-test-host.md), [TN-111](tn-111-implement-skia-golden-rendering-and-controlled-update-workflow.md), [TN-112](tn-112-implement-physical-device-ime-and-accessibility-automation-plus-manual-scripts.md), [TN-113](tn-113-fuzz-mutation-protocol-resource-inputs-deep-links-and-native-module-codecs.md), [TN-114](tn-114-complete-threat-model-release-mode-hardening-and-capability-audit.md), [TN-115](tn-115-implement-physical-device-startup-frame-list-bridge-and-js-stall-benchmarks.md), [TN-116](tn-116-implement-memory-leak-lifecycle-and-long-run-soak-suite.md), [TN-117](tn-117-implement-inspector-frame-timeline-transaction-viewer-and-diagnostics-export.md)

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
2. Write a short implementation note that states how this issue will produce: **Versioned alpha artifacts, docs, evidence packet, known limitations, and rollback instructions are published.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Define entrance/exit criteria, owners, evidence locations, known limitations, and rollback before declaring success.
5. Use a clean consumer project rather than relying only on framework-repository examples.
6. Verify all documented commands and code against the exact release artifacts.
7. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
8. Update generated files, architecture references, and migration notes only when this issue changes their contract.
9. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Versioned alpha artifacts, docs, evidence packet, known limitations, and rollback instructions are published.
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
Issue: TN-118
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

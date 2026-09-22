---
okf_version: 0.2
title: "TN-023: Implement runtime-compatible bundle or bytecode compiler"
summary: "Executable verified artifact for the selected embedded runtime."
type: issue
status: ready
issue_id: "TN-023"
milestone: "M1"
priority: "P0"
depends_on:
  - "TN-013"
  - "TN-020"
  - "TN-022"
---

# TN-023 — Implement runtime-compatible bundle or bytecode compiler

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P0 |
| Dependencies | TN-013, TN-020, TN-022 |
| Suggested size | One focused worktree and PR |
| Gate impact | Milestone/gate critical |

## Required outcome

Executable verified artifact for the selected embedded runtime.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-013](tn-013-select-the-initial-embedded-javascript-runtime.md), [TN-020](tn-020-implement-custom-jsx-jsxs-fragment-runtime.md), [TN-022](tn-022-implement-module-graph-and-asset-manifest-builder.md)

Do not start implementation against guessed dependency APIs. When a dependency is incomplete or its accepted behavior conflicts with this issue, stop the patch at the boundary and record the conflict as a blocker or ADR proposal.

### Prerequisite reconciliation (2026-09-21, post #205)

Recorded so TN-023 starts from verified ground instead of re-derived
assumptions. A status-model note first: the `status:` frontmatter across
`06-issues/*.md` is a **planning-readiness vocabulary** (95 `ready`,
4 `blocked`, zero `closed` values tree-wide); lifecycle authority is the
GitHub issue state plus each issue's in-file closure record. "Ready" in
frontmatter never means "not implemented."

| Prerequisite | Implementation and tests today | Acceptance / decision evidence | Authoritative status | Genuine remaining prerequisite for TN-023 |
|---|---|---|---|---|
| TN-020 (JSX runtime) | `packages/jsx-runtime` with both automatic-JSX subpaths (`./jsx-runtime`: jsx/jsxs/Fragment; `./jsx-dev-runtime`: jsxDEV); consumer-rehearsal coverage in `verify-consumer.sh` (PR #205) compiles real TSX through both transforms from packed tarballs | Closure record 2026-09-12 (PRs #186 + #188, main at 2956b79): 95 automated tests incl. red fixtures; satisfaction record merged as #189 (`732d919`) | Issue #20 CLOSED | None. Text/IME matrix and device metadata are linked-downstream acceptance (TN-077/078, TN-112/115), not TN-023 inputs. |
| TN-022 (module graph + asset manifest) | `packages/cli/src/module-graph.ts` — `buildApplicationGraph(validatedConfig, projectRoot, {assets, jsxDevelopment})`; 29 tests incl. 15 filesystem fixtures (no-execution discovery, distinct runtime/type edges, implicit JSX edges, recorded cycles, realpath confinement, `complete:false` on computed dynamics) | Closure record 2026-09-12 (PR #193, main at `9bc41bc`) — closed as satisfied by the graph/manifest slice | Issue #22 CLOSED | None from TN-022 itself. Its open-sounding leftovers are recorded as **downstream acceptance this issue produces** (source-map records) or other issues' work (screens → TN-059/060; capabilities → TN-101; config-level asset declaration → TN-021/TN-105). The apparent TN-022↔TN-023 cycle resolves here: source maps are TN-023 output flowing back, not open prerequisite work — no dependency is waived. |
| TN-013 (select initial embedded runtime) | QuickJS is vendored and running in the experimental Android embedder (JNI bridge, `JS_Eval` device contract) — **provisional implementation, not acceptance** | ADR-0007 (runtime adapter and bake-off) is **accepted** and defines the process; the selection ADR naming the initial runtime does not exist in `03-decisions/` | Issue #13 **OPEN** | The issue's own required outcome: an **accepted runtime selection ADR + compatibility envelope** ("without leaking runtime-specific APIs"). TN-023 compiles *for* the selected runtime — the ADR is the genuine gate. Prototype engine use does not ratify it; an accepted decision may simply need linking if it exists outside this tree. |

**Second gap, not a declared dependency but a hard one:** TN-023's
output must be consumed through a **public application/runtime
contract**. Today the widget-tree → display-list lowering and the
scene-commit/dispatch runtime live in `examples/`
(`examples/ui-kit/src/display-list.ts`, `examples/gallery-preview/runtime.ts`)
and the device entry imports them (`device-entry.ts:2`); `runApp`
returns an instance handle with no host binding. Which example behavior
becomes supported, what stays provisional, and where the contract lives
is an **unowned decision** — it must be assigned before TN-023's
interface can be finalized. Neither this record nor PR #205 exposes
example-private APIs as public.

**Entry point for implementation (when authorized):** TN-013's ADR
decision + the public runtime/lowering contract owner. TN-020 and
TN-022 contribute settled contracts, not blockers.

## Required reading

- [product-definition.md](../00-project/product-definition.md)
- [principles.md](../00-project/principles.md)
- [definition-of-done.md](../05-delivery/definition-of-done.md)
- [system-overview.md](../02-architecture/system-overview.md)
- [runtime-model.md](../02-architecture/runtime-model.md)
- [mutation-protocol.md](../02-architecture/mutation-protocol.md)

## Likely touch points

- `packages/`
- `engine/runtime-host/`
- `embedders/ios/`
- `embedders/android/`
- `engine/text/`

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **Executable verified artifact for the selected embedded runtime.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Version the artifact/host contract and verify hashes, capabilities, and compatibility before execution.
5. Test startup, disposal, microtask draining, interruption, uncaught errors, and repeated runtime creation.
6. Keep runtime-specific APIs behind the adapter and include a negative test that detects leakage.
7. Use real Unicode, emoji, bidi, composing-text, selection, secure-entry, and autofill fixtures.
8. Run physical-device journeys with at least two IMEs/keyboards per platform where practical.
9. Protect controller state with edit-session revisions so stale callbacks cannot overwrite newer text.
10. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
11. Update generated files, architecture references, and migration notes only when this issue changes their contract.
12. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Executable verified artifact for the selected embedded runtime.
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
- [ ] Malformed, truncated, oversized, stale-version, and unknown-field/opcode cases.
- [ ] Deterministic serialization or replay fixture.
- [ ] Composition, selection, emoji, bidi, secure entry, keyboard action, and stale-revision cases.

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
Issue: TN-023
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

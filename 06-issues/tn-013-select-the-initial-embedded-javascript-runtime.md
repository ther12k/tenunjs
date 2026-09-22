---
okf_version: 0.2
title: "TN-013: Select the initial embedded JavaScript runtime"
summary: "Accepted runtime ADR and compatibility envelope without leaking runtime-specific APIs."
type: issue
status: ready
issue_id: "TN-013"
milestone: "M0"
priority: "P0"
depends_on:
  - "TN-011"
  - "TN-012"
---

# TN-013 — Select the initial embedded JavaScript runtime

## Metadata

| Field | Value |
|---|---|
| Milestone | M0 — Architecture and technology gates |
| Priority | P0 |
| Dependencies | TN-011, TN-012 |
| Suggested size | One focused worktree and PR |
| Gate impact | Milestone/gate critical |

## Required outcome

Accepted runtime ADR and compatibility envelope without leaking runtime-specific APIs.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-011](tn-011-implement-quickjs-ng-runtime-spike.md), [TN-012](tn-012-implement-hermes-runtime-spike.md)

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
- `engine/text/`

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **Accepted runtime ADR and compatibility envelope without leaking runtime-specific APIs.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Use the exact shared fixture/workload; do not improve one candidate with candidate-specific shortcuts.
5. Capture clean-build, incremental-build, binary-size, startup, memory, crash-symbol, debugger, and physical-device evidence.
6. Record disqualifying failures separately from weighted preferences and state the rollback/revisit trigger.
7. Version the artifact/host contract and verify hashes, capabilities, and compatibility before execution.
8. Test startup, disposal, microtask draining, interruption, uncaught errors, and repeated runtime creation.
9. Keep runtime-specific APIs behind the adapter and include a negative test that detects leakage.
10. Use real Unicode, emoji, bidi, composing-text, selection, secure-entry, and autofill fixtures.
11. Run physical-device journeys with at least two IMEs/keyboards per platform where practical.
12. Protect controller state with edit-session revisions so stale callbacks cannot overwrite newer text.
13. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
14. Update generated files, architecture references, and migration notes only when this issue changes their contract.
15. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Decision package (2026-09-22 — prepared for the acceptance authority; NO selection recorded)

Evidence assembly per ADR-0007 and this issue's own sequence, using the
accumulated record. New probes were NOT run for this package.

### Binding constraint first

**ADR-0022 (accepted) already governs this selection**: the M0 selection
gates are recorded as `BLOCKED_BY_ENVIRONMENT` on physical-device
availability — "not waived, weakened, or re-scoped to emulator
evidence"; the embedder's vendored QuickJS is provisional and "does not
conclude ADR-0007's bake-off"; when hardware arrives "the bake-offs run
as written" and emulator evidence is not retroactively counted. Any
selection made before that therefore requires a NEW superseding ADR
naming the violated invariant and rollback plan (the exception clause).
This package does not file one. Physical-device criteria in this issue's
own sequence (steps 5 and 11) and TN-011's remaining H4 blocker are
therefore preserved, not treated as an informal veto.

### Evidence inventory (candidate / revision / evidence / result / gap)

Both existing bodies of work use the **same upstream engine sources**
(bellard QuickJS 2024-01-13, via rquickjs-sys vendored sources — per
ADR-0022) through two embedding paths:

| # | Path | Revision / artifact | Evidence | Observed result | Remaining gap for TN-013 |
|---|---|---|---|---|---|
| 1 | Rust spike harness (TN-011) | `spikes/runtime/quickjs-candidate` (rquickjs 0.9 / rquickjs-sys 0.9) | Host-adapter conformance corpus; formally accepted in Re-review 17 (#142); ABI conformance PR #143 | Full six-kind value bridging, exact BigInt i64, per-scope memory budgets, callback diagnostic isolation, pump semantics, identity-keyed Promise-rejection tracking, refcounted teardown with counter-delta proofs | Physical-device evidence (H4) only |
| 2 | Android embedder (prototype) | `embedders/android/app/src/main/cpp/quickjs/` (same sources, direct C embedding via JNI) | KVM-emulator installed-run corpus: TN-132 acceptance (6-test suite, real-IME sessions, Unicode round-trips under CheckJNI, lifecycle recreation), 20-cycle create/destroy stress, eval-boundary diagnostics, the JS_Eval NUL-termination defect found and fixed with a deterministic host-side proof (CI-enforced, `verify-android`), fail-visible startup handling with 4 deterministic device tests (PRs #173–#204 lineage) | Engine executes, commits scenes, round-trips actions on installed Android under emulator; startup-failure behavior explicit | Physical-device execution unexercised; emulator evidence explicitly NOT countable per ADR-0022 |
| 3 | Hermes candidate (TN-012) | — | No execution record exists (no status notes, no spike code) | Not evaluated | **All of it** — ADR-0007's decision text is "Evaluate QuickJS-NG and Hermes … and select"; one candidate has zero evidence |
| 4 | Comparative captures (this issue, step 5) | — | Not located in the current evidence tree (binary-size, startup, memory, crash-symbol, debugger comparisons between candidates) | Absent | Required by this issue's own sequence once both candidates exist |

Also noted: no disqualifying failure is on record for the evaluated
candidate; the NUL-termination defect (row 2) was an **embedder** input
contract violation, fixed with regression coverage — engine-neutral.

### Options for the acceptance authority (not decided here)

- **A. Maintain ADR-0022 (default).** Selection stays blocked on
  physical-device availability; this package stands ready so the
  decision is fast when unblocked. No new ADR needed; no work waived.
- **B. Supersede via the exception clause.** Governance accepts a new
  ADR selecting now on existing evidence — it must name the violated
  "matched device evidence" invariant, carry a rollback plan (ADR-0022
  §Rollback sketches the contained swap), and state explicitly that
  Hermes remains unevaluated. Fastest for downstream work (TN-023 waits
  on this selection); weakest evidentiary basis; revisitable per
  ADR-0007's trigger.
- **C. Complete the bake-off's non-device evidence now.** Execute
  TN-012 (Hermes spike) on the existing host harness and capture the
  step-5 comparative numbers (size/startup/memory on host builds). This
  is spike work, not selection — consistent with ADR-0022 §Decision-3
  (adapter-bounded foundation work may continue) — and shrinks the
  eventual decision to hardware-only evidence.
- **Recommended pairing: A + C.** Everything that can be legitimately
  assembled now is assembled; the only remaining input when hardware
  arrives is device evidence for both candidates.

### Compatibility envelope (draft skeleton — filled by whichever option is accepted)

Whichever candidate is selected, the envelope must distinguish: tested
on host spike harness / tested on installed Android (emulator) /
unexercised on physical devices; the exact engine-source revision and
embedding path (the two existing paths differ: Rust binding vs direct C
JNI); what remains provisional per ADR-0022's confinement
(applications never see the runtime — ADR-0007's own boundary); and the
revisit trigger. Runtime-specific APIs stay behind the adapter with a
leakage negative test (this issue, step 9).

### Acceptance authority

Per this repository's governance, the ADR is accepted by the project
maintainer through review of the ADR PR — recorded as an ADR
(`status: accepted` in `03-decisions/`), separate from prototype
implementation history. This section records who accepts and where;
filing the ADR is NOT authorized by this package alone.

### Separation from adjacent decisions

Closing TN-013 does not close **ADR-0005** (engine implementation
language evidence gate — different criteria: matched physical-device
vertical slices; its `BLOCKED_BY_ENVIRONMENT` status under ADR-0022 is
independent), nor **ADR-0008** (layout backend). JavaScript-runtime
selection, native language selection, and layout selection are separate
gates sharing only the device-availability blocker.

## Acceptance criteria

- [ ] **Primary outcome:** Accepted runtime ADR and compatibility envelope without leaking runtime-specific APIs.
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
- [ ] Composition, selection, emoji, bidi, secure entry, keyboard action, and stale-revision cases.

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
Issue: TN-013
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

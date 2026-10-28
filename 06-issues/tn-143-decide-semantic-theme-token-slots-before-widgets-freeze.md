---
okf_version: 0.2
title: "TN-143: Decide semantic theme-token slots before the widget layer freezes"
summary: "Runtime light/dark with a persisted choice touched every color; native got it free via resource aliases, the web replica hand-plumbed ~40 CSS variables. Define the token indirection now."
type: issue
status: in-progress
issue_id: "TN-143"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-068"
---

# TN-143 — Decide semantic theme-token slots before the widget layer freezes

## Metadata

| Field | Value |
|---|---|
| Milestone | M4 — Widget layer (decision requested ahead of the freeze) |
| Priority | P1 |
| Dependencies | TN-068 (theme tokens and inherited widget context) |
| Suggested size | One contract-decision PR (ADR + slot vocabulary) |
| Gate impact | Every app's theming cost; future OS dark-mode-follows |

## Implementation note (2026-10-28)

[ADR-0024](../03-decisions/adr-0024-semantic-color-slots-before-widget-freeze.md)
records the vocabulary, immutable references, complete palettes, and
commit-time baking boundary. It explicitly waives TN-068 completion only
for this decision and root-scope reference proof; TN-068 remains the owner
of ordinary widget adoption and inherited runtime context.

The focused slice adds an opt-in `@tenunjs/widgets` reference implementation
and `examples/theme-contract`, using the existing storage capability to
demonstrate a persisted light/dark choice over one unchanged semantic
screen. Existing widget signatures, native scene v1, and golden output
remain compatible. This issue remains in progress until the change and its
recorded validation are delivered.

## Purpose

Gap 4 of the VOTOL consumer feedback
([record](../08-validation/votol-consumer-feedback-2026-10-02.md)).
Light/dark at runtime with a persisted choice touched every color the
app had. The native Android build got it free via resource aliases; the
web replica hand-plumbed ~40 CSS variables. If scenes bake colors at
commit time that is fine — but without semantic color slots / token
indirection defined before widgets freeze, every app (and any future
OS dark-mode-follows) hand-plumbs it later. TN-068 owns theme tokens;
this issue owns the DECISION pulled forward: the slot vocabulary and
indirection contract, sequenced before M4's widget property schemas
stabilize.

## Required outcome

- An accepted slot vocabulary (semantic color slots — background,
  surface, on-surface variants, accent, danger, …) with the indirection
  rule: widgets and display-list ops reference slots, never literal
  colors; resolution happens at a defined stage (commit-time baking is
  acceptable if the slot survives for re-resolution).
- Runtime theme switching with a persisted choice is expressible
  through the contract (change slot values → next commit re-bakes),
  demonstrated by one example flipping light/dark without per-screen
  edits.
- Recorded as an ADR or an explicit TN-068 scope addendum, so M4 widget
  work (property schemas, TN-034 lineage) compiles against slots from
  its first PR.

## References

- [VOTOL consumer feedback, gap 4](../08-validation/votol-consumer-feedback-2026-10-02.md)
- `examples/votol/src/theme.ts`; the votol record's web-replica note

## Status note (2026-10-28, implementation prepared)

The branch contains ADR-0024, the exported reference API in
`packages/widgets/src/theme-slots.ts`, and the persisted-choice example in
`examples/theme-contract/`. TN-068 remains open under the ADR's explicit
decision-only sequencing exception. TN-143 remains `in-progress` pending
publication and the repository CI gates.

Local verification used the pinned Bun 1.4.0 toolchain:

| Check | Evidence |
| --- | --- |
| Pre-change widget baseline and typecheck | 68 tests passed; all configured TypeScript projects passed. |
| `bun run verify:ts` | Frozen install and typecheck passed; 474 tests passed, 0 failed, 2,532 assertions. |
| Fresh-worktree `bun run verify:ts` | Same 474/0 result from a new checkout with no installed dependencies or generated test fixtures before the run. |
| Focused contract and persistence suites | 21 tests passed, 0 failed, 262 assertions; included in the full run. |
| File-host demo across three processes | Light, dark, then restored dark; five representative colors changed together while 7 operations and 1 tap remained constant. |
| `.github/scripts/verify-consumer.sh` | Passed package installation, both JSX transforms, existing scene digest, host execution, and the application-only variant. Bun emitted nonfatal directory-mismatch diagnostics; build and scene assertions passed. |
| `embedders/android/run_android_test.sh` | C bridge and real QuickJS loops passed for the existing asset, compiled TSX counter, and Polytron bundle. SDK-dependent Gradle/APK/NDK steps were not available. |
| Manifest validation and checker selftest | Passed, including mutation detection. |
| `python3 .github/scripts/verify-evidence.py` | Structural validation passed for all three existing packets; no spike inputs or evidence artifacts changed. Native artifact replay was not run. |

Independent review found and resolved a sparse-array validation hole:
operation/tap holes now fail with `INVALID_SCENE` before a scene is
returned. A separate regression proves two equal light colors retain their
distinct slot identities when the dark palette gives them different values.
Compile-time checks require new display-op fields and variants to be
classified and handled explicitly.

The native probe could not start because `rustc` is absent. Rust, ABI,
native-probe/replay, emulator/device, and hosted CI results are not claimed
by this local evidence. The example proves the color-resolution and
preference contract; ordinary TSX widget integration and inherited themes
remain TN-068, and actual device persistence requires host evidence.

---
okf_version: 0.2
title: "TN-068: Implement theme tokens and inherited widget context"
summary: "Typed colors, spacing, radius, typography, locale, scale, and platform values flow predictably."
type: issue
status: closed
issue_id: "TN-068"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-051"
  - "TN-067"
---

# TN-068 — Implement theme tokens and inherited widget context

## Metadata

| Field | Value |
|---|---|
| Milestone | M4 — Core widgets, text input, scrolling, and animation |
| Priority | P1 |
| Dependencies | TN-051, TN-067 |
| Suggested size | One focused worktree and PR |
| Gate impact | Required supporting work |

> **Scaffolding note (2026-09-11):** TN-019 (PR #181, #182) introduced preliminary `defineTheme`/`ThemeProvider` in `packages/widgets`. Those declarations do not satisfy this issue's acceptance criteria. This issue retains ownership of typed theme tokens, inherited widget context, and token resolution semantics. Existing scaffolding may be replaced without ceremony.

## TN-143 contract addendum (2026-10-28)

[ADR-0024](../03-decisions/adr-0024-semantic-color-slots-before-widget-freeze.md)
freezes the semantic color vocabulary and `ColorRef` indirection ahead of
this implementation. Its scoped sequencing exception allows TN-143's
decision and root-scope reference proof to precede completion of TN-068;
it does not close this issue or waive its dependencies.

Consume the exported `ColorSlot`, `ColorRef`, and complete `ThemePalette`
contract from `@tenunjs/widgets`. This issue still owns:

- Ordinary TSX widget property adoption and lowering that retains slot
  identity until commit-time palette resolution.
- Inherited theme scopes: child overrides affect descendants only, parent
  updates propagate through unoverridden values, and retained operations
  preserve their scope or are regenerated from the scoped widget tree.
- App-level invalidation and subscription teardown so a palette switch
  updates the next frame without per-screen wiring or changed input state.
- Spacing, radius, typography, locale, scale, and platform context values.
- Integration evidence for actual widgets and runtime behavior, beyond the
  root semantic-scene and injected-storage proof in `examples/theme-contract`.

Current `defineTheme`/`ThemeProvider`, role-string props, `ThemeScopeBox`,
and `layoutScreen` remain prototype APIs. The new reference module does
not retrofit them, make native hosts slot-aware, or add live theme updates
to `ApplicationRuntime`. Future TN-034 property schemas and TN-042 drawing
contracts must adopt the accepted references with explicit wire/version
migration where needed.

## Required outcome

Typed colors, spacing, radius, typography, locale, scale, and platform values flow predictably.

## Why this issue exists

This task isolates one reviewable contract or vertical slice. It should leave the repository in a demonstrably better state without silently implementing later issues or relying on undocumented follow-up work.

## Dependencies

[TN-051](tn-051-implement-function-widget-execution-and-child-normalization.md), [TN-067](tn-067-close-controller-action-navigation-gate.md)

Do not start implementation against guessed dependency APIs. When a dependency is incomplete or its accepted behavior conflicts with this issue, stop the patch at the boundary and record the conflict as a blocker or ADR proposal.

## Required reading

- [product-definition.md](../00-project/product-definition.md)
- [principles.md](../00-project/principles.md)
- [definition-of-done.md](../05-delivery/definition-of-done.md)
- [text-and-ime.md](../02-architecture/text-and-ime.md)
- [input-focus-gestures.md](../02-architecture/input-focus-gestures.md)
- [scrolling-animation.md](../02-architecture/scrolling-animation.md)

## Likely touch points

- `packages/widgets/`
- `engine/text/`
- `engine/input/`
- `engine/animation/`

Paths are architectural guidance, not permission to change every listed area. Keep the actual patch minimal.

## In scope

- The contract, implementation, tests, diagnostics, and evidence necessary for the required outcome.
- Explicit negative behavior at each trust, lifecycle, or compatibility boundary owned by this task.
- Documentation updates that are directly made stale by this task.
- Generated artifacts only when their canonical source is changed in this issue.

## Implementation sequence

1. Confirm every declared dependency is closed and read its accepted contract/evidence; do not infer missing behavior.
2. Write a short implementation note that states how this issue will produce: **Typed colors, spacing, radius, typography, locale, scale, and platform values flow predictably.**
3. Define or update the smallest stable interface owned by this issue, including errors, lifecycle, versioning, and disposal where applicable.
4. Define the TypeScript types and runtime representation before optimizing generated output.
5. Add fixtures for nested arrays, null/boolean children, fragments, keys, source locations, and invalid props.
6. Assert deterministic mutation traces and actionable development diagnostics.
7. Use real Unicode, emoji, bidi, composing-text, selection, secure-entry, and autofill fixtures.
8. Run physical-device journeys with at least two IMEs/keyboards per platform where practical.
9. Protect controller state with edit-session revisions so stale callbacks cannot overwrite newer text.
10. Run the narrow tests first, then the affected package/platform suites, then required clean-checkout validation.
11. Update generated files, architecture references, and migration notes only when this issue changes their contract.
12. Assemble the evidence packet before requesting review; a prose claim without raw/reproducible evidence does not close the issue.

## Acceptance criteria

- [ ] **Primary outcome:** Typed colors, spacing, radius, typography, locale, scale, and platform values flow predictably.
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
Issue: TN-068
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

## TN-173 slice note (2026-10-30)

The "ordinary TSX widget property adoption" half of this issue's
addendum is delivered by
[TN-173](tn-173-adopt-colorref-props-with-commit-time-resolution.md):
`Card.background` and `Text.color` accept `colorSlot()` refs, the
lowering retains slot identity to the commit boundary (the runtime
bakes before any host sees a scene), `ThemeScopeBox` narrows SLOTS as
well as roles for descendants only, and `ApplicationRuntime` carries a
slot palette (`palette` option, `setPalette`).

## TN-174 slice note (2026-10-30)

Spacing, radius, and typography token flow is delivered by
[TN-174](tn-174-theme-driven-spacing-radius-typography-tokens.md):
`ThemeConfig`'s `spacing`, `radius`, and `typography` blocks now actively
drive layout metrics instead of being dead config; custom typography
variants can be declared; `ThemeScopeBox` accepts `tokens` narrowing
descendants only; and runtime `setTheme` updates geometry on the next
frame. Still open here: locale, scale, and platform context values.

## Status note (2026-10-31, closed)

Closed via PR #269: the final locale, scale, and platform context values
and inherited widget context flow are delivered.
- `WidgetContext`: carries `theme`, `tokens`, `palette`, `slotPalette`, `locale`,
  `textScale`, and `platform` ("android" | "ios" | "web").
- Function widgets receive `(props, context: WidgetContext)` and can access it
  ambiently via `currentWidgetContext()`.
- `layoutScreen` options take `locale`, `textScale`, `platform` with fail-closed
  validation; `ThemeScopeBox` narrows them for descendants only with inner scopes
  winning and unoverridden values inheriting.
- `textScale` scales typography size, line height, text wraps, and button geometry
  predictably across measurement and placement.
- `ApplicationRuntime`: options, getters, and dynamic setters (`setLocale`,
  `setTextScale`, `setPlatform`) trigger stale invalidation and commit updated scenes.
- 8 new unit tests in `packages/widgets/test/inherited-context.test.ts` (644 bun tests passing;
  clean verify:ts and verify-consumer.sh).



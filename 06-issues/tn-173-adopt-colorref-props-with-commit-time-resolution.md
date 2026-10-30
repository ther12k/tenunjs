---
okf_version: 0.2
title: "TN-173: Adopt ColorRef props in ordinary widgets with commit-time resolution"
summary: "TN-068's widget-adoption slice: color props accept colorSlot() refs, the lowering retains slot identity to the commit boundary, slot-level theme scopes narrow descendants only, and the runtime bakes refs against the active palette before any host sees a scene."
type: issue
status: closed
issue_id: "TN-173"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-143"
  - "TN-170"
---

# TN-173 — Adopt ColorRef props in ordinary widgets with commit-time resolution

## Purpose

TN-068's contract addendum (ADR-0024) names "ordinary TSX widget property
adoption and lowering that retains slot identity until commit-time palette
resolution" as this issue's own. Today the slot vocabulary (`colorSlot`,
`ColorRef`, `ThemePalette`) exists only for hand-built semantic scenes in
`examples/theme-contract`; ordinary widgets (`Card.background`,
`Text.color`) accept role strings and literals, resolving through
`roleColor` at layout time with no slot retention anywhere.

## Required outcome

1. **Vocabulary ownership.** The slot vocabulary
   (`SEMANTIC_COLOR_SLOTS`, `ColorSlot`, `ColorRef`, `colorSlot`,
   `ThemePalette`) moves to `display-list.ts` (the lowering layer);
   `theme-slots.ts` re-exports it unchanged so the package surface and
   existing imports stay stable.
2. **Widget adoption.** `Card.background` and `Text.color` accept
   `string | ColorRef` alongside today's values; a `ColorRef` flows into
   the lowered op's color field untouched.
3. **Commit-time resolution.** `layoutScreen` takes an optional
   `{ palette }`. Ops retain refs through measure/place; at `finish()`:
   refs present without a palette fail visibly (typed layout error); with
   one, the returned `scene` is fully baked (literal colors — hosts are
   unchanged), and a `semanticScene` is additionally returned carrying
   the same geometry/taps with slot identity intact. A ref naming a slot
   the palette lacks fails visibly (`MISSING_SLOT`-shaped error).
4. **Slot-level scopes.** `ThemeScopeBox` accepts `slots?: Partial<ThemePalette>`
   in addition to role schemes: refs inside the scope resolve against the
   scope-merged palette; descendants only (siblings unaffected), child
   scopes override parents, unoverridden slots inherit. Scoped refs
   resolve eagerly through the merged overlay (documented: the semantic
   scene retains identity for unscoped refs; scoped subtrees bake with
   their overlay applied).
5. **Runtime.** `ApplicationRuntime` accepts an optional `palette`,
   passes it to layout, and exposes `semanticScene` on its render result
   when refs were used. Committed scenes through the handoff are baked —
   byte-identical to today when no refs are used (backward compatible).

## Verification

- Widgets tests: ref ≡ resolved literal (identical baked scene); missing
  palette and missing slot fail visibly; scope narrowing (descendants
  only, nested override, unoverridden inheritance, sibling isolation);
  semantic scene geometry/identity; runtime palette option + `setTheme`
  recoloring ref-colored scenes; handoff commits stay literal.
- Browser host keeps a fail-visible guard: an unbaked ref reaching a host
  renderer throws (defense; cannot happen through the runtime).
- Full suites, typecheck, manifest, evidence, 8-gate CI. Android needs
  no change (it already rejects non-string colors as contract
  violations, which is exactly right for an unbaked ref).

## Out of scope

- Re-bake-without-re-layout on palette switch (the runtime re-renders
  today; the semantic scene this slice returns is the seam for that
  future optimization).
- Spacing/typography/locale/scale context tokens (TN-068 remainder).
- Button/Chrome variant colors (role-driven defaults stay; explicit
  refs on those props can follow the same funnel in a later pass).

## Status note (2026-10-30, closed)

Implemented and published in one session. Fixed in PR #258 (commit
b8ae065): Card.background and Text.color accept colorSlot() refs; the
lowering retains slot identity to the commit boundary and layoutScreen's
palette option bakes there (scroll-region recursion included) while
returning the semantic scene; ThemeScopeBox narrows slots for
descendants only (and no longer drops the slots prop); the runtime
carries a slot palette with setPalette invalidation and exposes
semanticScene; hosts stay literal-only with fail-visible guards. 8 new
tests including byte-identical ref≡literal scenes and runtime palette
swaps; 614-test suite; all eight CI gates green including the device
gate.


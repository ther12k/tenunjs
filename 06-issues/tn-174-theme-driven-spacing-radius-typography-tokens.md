---
okf_version: 0.2
title: "TN-174: Make spacing, radius, and typography tokens flow from the theme"
summary: "ThemeConfig's spacing/radius/typography blocks are dead config today — the lowering resolves hardcoded module constants. This slice makes the theme blocks live (validated, typed failures), adds custom typography variants, and narrows all three vocabularies through ThemeScope descendants."
type: issue
status: closed
issue_id: "TN-174"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-173"
---

# TN-174 — Make spacing, radius, and typography tokens flow from the theme

## Purpose

TN-068 requires "typed colors, spacing, radius, typography ... values
flow predictably." Colors flow (TN-170 roles, TN-173 slot refs). The
other three vocabularies DO NOT: `ThemeConfig` declares
`spacing`/`radius`/`typography` blocks (Day Plan's theme sets all three),
but the lowering resolves the hardcoded module constants `SPACING`,
`RADIUS`, and `TYPOGRAPHY` — the theme blocks are silently ignored, dead
config. A theme that changes `spacing.md` changes nothing.

## Required outcome

1. **Theme-driven resolution.** `layoutScreen` validates the theme's
   token blocks once per layout (typed `INVALID_THEME_TOKEN` for
   nonnegative-finite violations on spacing/radius, positive-finite
   size/lineHeight and finite weight on typography) and builds the
   active token set: theme entries override the built-in scale names,
   unmapped names keep the built-ins, and `theme.typography` may declare
   CUSTOM variants `Text` resolves by name.
2. **Scope narrowing.** `ThemeScopeBox` accepts
   `tokens?: { spacing?, radius?, typography? }` narrowing DESCENDANTS
   ONLY — innermost scope wins, then outer scopes, then the theme, then
   the built-ins (the TN-173 slot-scope pattern).
3. **Runtime flow.** `setTheme` already invalidates; changed tokens
   produce changed committed geometry/text sizes on the next frame with
   state preserved — the "flow predictably" acceptance.

## Verification

- Widgets tests: theme spacing/radius/typography values measurably drive
  layout (padding, gaps, card radii, text sizes/lineHeights in the
  committed scene); overrides of built-in names; a custom variant;
  malformed blocks fail visibly; scope narrowing (descendant-only,
  innermost-wins, fall-through); runtime `setTheme` with changed tokens
  re-renders with new geometry.
- Backward compatible: themes without token blocks are byte-identical.
- Full suites, typecheck, manifest, evidence, 8-gate CI.

## Out of scope

- Locale, scale, and platform context values (they have no design or
  ADR yet — separate issue when the context-inheritance design lands).
- Density scaling of the built-in scales.

## Status note (2026-10-30, closed)

Implemented and published in one session. Fixed in PR #259 (commit
c1d1ff8): ThemeConfig's spacing, radius, and typography blocks actively
drive layout metrics across all layout and content widgets; buildTokenSet
validates token inputs with typed INVALID_THEME_TOKEN errors; custom
typography variants and ergonomic weight specs ('normal', 'bold', number)
are supported; ThemeScopeBox scopes tokens for descendants only; and
runtime setTheme updates geometry on the next frame. Evidence: 6 new unit
tests in packages/widgets/test/theme-tokens.test.ts, 620-test suite,
typecheck clean, full run_android_test.sh green, and all eight CI gates
pass including verify-android-device.


---
okf_version: 0.2
title: "TN-175: Scoped tokens must apply to measurement, validation, and the implicit body variant"
summary: "TN-174's scope overlays only reached place(): the measure pass allocated boxes with OUTER tokens (sibling overlap, wrong contentHeight), scoped token values bypassed root validation entirely (NaN radius serialized as null), and Text without an explicit variant ignored scoped body typography."
type: issue
status: ready
issue_id: "TN-175"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-174"
---

# TN-175 — Scoped tokens must apply to measurement, validation, and the implicit body variant

## Purpose

The 2026-10-30 production-readiness review (second round) reproduced three
defects in TN-174's scoped-token delivery, all invisible to the passing
suite because tests asserted painted values, never the box the PARENT
allocated:

1. **Measurement/placement mismatch (P1).** `measureNode` measured a
   `ThemeScope` with the outer token set; only `place()` pushed
   `ctx.tokenScopes`. A scoped `typography.body` with lineHeight 80
   painted a 62.4 baseline but the parent still allocated 24 units — the
   next sibling overlapped the scoped text, and scene `contentHeight`
   (scroll extent) understated the content. Scoped `spacing` had the same
   mechanism.
2. **Scoped validation bypass (P2).** `buildTokenSet` validated the ROOT
   theme only. A scoped `radius.md: NaN` was accepted and serialized into
   the scene as `r: null` (hosts degrade); negative and zero values that
   the theme layer rejects typed passed through scopes.
3. **Implicit variant bypass (P2).** `Text` with no `variant` returned
   `ctx.tokens.typography.body` directly, skipping the scope chain — the
   scoped body token applied only when apps wrote `variant="body"`
   explicitly.

## Required outcome

1. Measurement and placement resolve tokens through the SAME scope stack:
   a scoped lineHeight/padding inflates the frame the parent allocates,
   sibling positions, `contentHeight`, and scroll extent — proven by
   exact-geometry assertions, not painted values alone.
2. Scope entries obey the theme's validation rules verbatim
   (`INVALID_THEME_TOKEN`, fail at layout time).
3. An omitted `Text` variant resolves the effective `body` token through
   scopes, then theme, then built-in.

## Verification

- New regression tests in `packages/widgets/test/theme-tokens.test.ts`:
  scoped typography allocates the sibling's position (y=80 for an
  80-lineHeight scope); scoped spacing shifts the sibling by the padding
  delta; malformed scoped spacing/radius/typography throw
  `INVALID_THEME_TOKEN`; implicit body text picks up the scoped body size.
- Existing suites unchanged (620 pre-existing tests stay green — no
  example uses scoped tokens today).
- Full suite + typecheck + manifest + 8-gate CI.

## Out of scope

- Locale/scale/platform context (unchanged TN-068 remainder).
- Any change to theme-level token semantics (TN-174 is frozen).

---
okf_version: 0.2
title: "TN-170: Deliver runtime theme switching and palette-derived themes (TN-155 slice 6)"
summary: "ApplicationRuntime.setTheme swaps the application-owned theme through the invalidation channel (palette switch updates the next frame, sessions/state/input preserved); paletteTheme derives a full role config from a TN-143 semantic palette; Day Plan demonstrates light/dark runtime switching."
type: issue
status: ready
issue_id: "TN-170"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-143"
  - "TN-157"
---

# TN-170 — Deliver runtime theme switching and palette-derived themes

## Purpose

TN-155's remaining theme requirement: "Semantic widget colors, inherited
themes, runtime switching." TN-068 owns the deep token work (ColorRef
widget adoption, spacing/typography/locale/scale context); this slice
delivers the runtime-switching half of TN-068's invalidation bullet plus
the semantic-vocabulary bridge, through the existing role plumbing —
the same slicing approach as TN-161/TN-169.

Day Plan screens already color by role strings (`background="surfaceRaised"`),
so a theme swap recolors every widget without per-screen wiring. What is
missing: (1) no runtime API to swap the theme — `ApplicationRuntime.theme`
is fixed at construction; (2) `resolveRoles` hardcodes six roles
(`surfaceContainer`, `surfaceContainerHigh`, `onSurfaceVariant`,
`inverseSurface`, `onInverseSurface`, `onPrimaryFixed`) that a light
palette cannot reach, so light themes keep dark cards; (3) no bridge from
a TN-143 `ThemePalette` (the semantic slot vocabulary) to the role config
ordinary widgets consume.

## Required outcome

1. **`ApplicationRuntime.setTheme(theme)`** — app-level theme swap through
   the same invalidation channel as `setViewport`: route, sessions,
   state, viewport, and the active text-input session are preserved; the
   next committed frame carries the new colors; invalidation-driven hosts
   repaint once. Malformed input and post-dispose calls fail visibly.
2. **Extended role matching** — `resolveRoles` honors the six additional
   theme.colors tokens when declared (existing apps unchanged: absent
   keys keep today's defaults).
3. **`paletteTheme(palette)`** — derives a complete `ThemeConfig` from a
   TN-143 `ThemePalette` (validated through `defineColorPalette`), so a
   semantic slot palette drives every ordinary widget role, including the
   newly reachable ones.
4. **Day Plan** — light and dark palettes via `paletteTheme`, an AppBar
   toggle action that swaps at runtime through `setTheme`, retained
   Progress session across a toggle.

## Verification

- Widgets tests: setTheme recolors the committed scene, preserves
  route/sessions/state/viewport and the focused input descriptor, fires
  exactly one invalidation commit, throws typed errors on malformed
  themes and after dispose; paletteTheme maps slots and rejects invalid
  palettes; resolveRoles honors the new tokens and keeps defaults.
- Framework-feel journey test: navigate to Progress, toggle the theme,
  assert the scene recolors and the retained session's completion state
  survives.
- Full suites, typecheck, manifest, evidence, 8-gate CI. No host changes
  (scenes stay display-list v1 with literal colors).

## Out of scope

- ColorRef-carrying widget props and slot identity through layout into
  semantic scenes (stays TN-068's "ordinary widget property adoption").
- Spacing/radius/typography/locale/scale/platform context tokens (TN-068).
- Persisted theme preference across restarts (storage seam exists in
  examples/theme-contract; app-level persistence is a Day Plan concern
  if pursued later).

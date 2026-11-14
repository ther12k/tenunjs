---
okf_version: 0.2
title: "TN-199: Scene transparency contract — optional transparent scenes with premultiplied RGBA host output"
summary: "The lekuvo notch is a composited overlay: its scene must declare itself transparent so hosts paint no background fill and output premultiplied RGBA that the host composites. A new optional top-level scene field (transparent) follows the documented unknown-field precedent — hosts that predate it ignore it and degrade to the opaque background fill; nothing mobile changes."
type: issue
status: ready
issue_id: "TN-199"
priority: "P0"
depends_on: []
adr: "ADR-0028"
---

# TN-199 — Scene transparency contract

## Purpose

ADR-0028 names the lekuvo pilot: a host-owned fixed 760x560 transparent
overlay composited by the desktop window system. Today every host paints
an opaque background fill — `DisplayListScene.background` is required
and the scene builder hard-codes it from the theme
(`display-list.ts` finish()). There is no way for a scene to declare
itself transparent, and a raw 8-digit hex background is a cross-host
landmine (`#AARRGGBB` Android-order vs `#RRGGBBAA` CSS-order — the
gallery-preview renderer would reject Android-order literals).

The contract change is deliberately shaped as the unknown-field
precedent (`semantics?`, `scene.transition`): one optional top-level
field, ignored by hosts that predate it, so mobile hosts and older
deployments degrade gracefully to the opaque fill and nothing breaks.

## Required outcome

1. **Wire**: `DisplayListScene.transparent?: true` — optional, no
   default (absent = opaque, exactly today's behavior). `background`
   stays required and is UNCHANGED on the wire: transparent-aware hosts
   do not paint it; older hosts paint it (graceful degradation, never
   corruption). No 8-digit-hex background support — the field is
   boolean by design.
2. **TS engine**: the app declares it through the theme input
   (`transparent?: boolean`, fail-visible validation — non-boolean
   fails the commit). The scene builder emits `transparent: true` when
   declared; widgets, ops, and color slots are unchanged (per-widget
   alpha is NOT this issue).
3. **skia-host**: a transparent scene clears to premul-transparent
   (never paints the background fill) and outputs premultiplied RGBA8
   — the existing `raster_n32_premul` + `read_pixels(Premul)` output
   already is premul; only the clear path changes. Opaque scenes are
   byte-identical to today.
4. **gallery-preview renderer**: honors the field (skips the
   background fill after `clearRect` — the browser compositor supplies
   the alpha); the fixed-anchor pass is unaffected.
5. **Android painter**: unchanged by design — `SurfaceView` is
   opaque-format and mobile apps do not request transparency; the
   field is ignored and the background paints as today (verified, not
   assumed).
6. **Parity**: a transparent-scene case in the TN-184 parity harness —
   skia-host and the preview renderer must agree on which pixels carry
   alpha (unpainted regions alpha 0, painted regions as painted).

## Non-goals

- Per-widget/per-op alpha (half-transparent widgets), gradients, blur:
  separate evidence-gated work.
- Android GPU surface format changes; the Android host stays opaque.
- Window/compositor concerns (layer-shell, click-through): lekuvo-host
  owns those — the framework stops at premultiplied RGBA.

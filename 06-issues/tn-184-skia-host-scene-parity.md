---
okf_version: 0.2
title: "TN-184: skia-host scene parity — the wire's full vocabulary paints"
summary: "The 2026-10-30 review found stage 2's rasterizer accepted only a subset of the display-list contract: #aarrggbb colors, non-rect/text scroll-region content, text clips and align boxes, fixed/anchor overlays, real bold, and centerline rings all failed or silently mis-painted. All seven fixed with pixel tests; every real emitted scene (incl. the milestone app's live Controls tab) now renders."
type: issue
status: in-progress
issue_id: "TN-184"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-182"
---

# TN-184 — skia-host scene parity

## Purpose

The framework-owned rasterizer (TN-182, ADR-0026 stage 2) painted its
own hand-written test scenes but not the scenes the framework actually
emits. The 2026-10-30 review reproduced seven contract violations
against the compiled C ABI; two made REAL scenes fail whole.

## Defects (all reproduced, all fixed)

1. **`#aarrggbb` rejected (P1).** Android-style alpha-leading literals
   are part of the wire (both platform hosts parse them natively; the
   milestone app emits them for translucent control fills). The parser
   accepted only `#rrggbb`, so Polytron Wash's live Controls tab —
   `#3300B7FD`, `#3300FFC8` — failed the whole frame (`-3`).
2. **Scroll regions accepted only rect/text children (P1).** The
   lowering emits the ordinary op set in content space (a `TextField`
   carries outline + text-input; pages paint circles/gradients/lines).
   A real `layoutScreen` scene — TextField inside ScrollView — failed
   whole. Nested scroll-regions are now rejected visibly (the hosts'
   contract), not accepted by accident.
3. **Text clips ignored.** A zero-area clip painted the full unclipped
   extent; field values and selection foregrounds rely on hard clips.
4. **`align`/`width` centering ignored** (and the wire's explicit
   `"align":"left"` rejected at parse). Centered pill/tab labels painted
   left-aligned.
5. **Fixed/anchor overlays ignored.** `fixed`+`anchor`/`anchorSize`
   ops painted in the scrollable body at raw coordinates — a
   bottom-anchored band appeared at the top. The renderer now runs the
   hosts' two-pass rule: body first, anchored viewport layer above.
6. **Bold was regular.** Both font slots used the normal typeface;
   weight 400 and 700 rendered identical buffers. The bold slot now
   resolves a real bold typeface.
7. **Ring geometry diverged from both hosts.** The stroke was inset by
   half its width (outer radius r−w/2+… — every ring smaller than the
   browser/Android centerline interpretation) and caps were butt, not
   round.

## Verification

- 20 pixel-level `cargo test`s (8 new: alpha SrcOver blend values,
  zero-width clip, centered-shift, bold-heavier-ink, bottom-anchor
  overlay band, centerline ring radius with round-cap reach, full op
  set inside regions + nested-region rejection, clipped region text).
- Real-scene probes (the review's reproducers) all render rc=0 through
  the C ABI: 7 Polytron Wash scenes incl. the live alpha-color Controls
  tab, plus `layoutScreen`'s TextField-in-ScrollView scene.
- `cargo fmt` / `clippy -D warnings` clean; verify-rust gate unchanged.

## Out of scope

- Elevation `shadow` values (ADR-0026 stage 3 image filters).
- Text-input descriptor contract validation (ids/focus uniqueness) —
  the input layer's concern, honored the same way the other painters
  honor it (accepted, unpainted).
- Whole-scene scroll offset (the ABI renders settled offsets; the stage
  3 surface passes scroll state).

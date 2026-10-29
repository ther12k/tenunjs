---
okf_version: 0.2
title: "TN-169: Deliver host-evaluated route transitions (TN-155 slice 5)"
summary: "Navigation commits carry an optional transition descriptor; hosts interpolate between the previous and new scene on their own frame clock, and Android drives transition frames on a dedicated thread so JS stalls cannot freeze motion."
type: issue
status: ready
issue_id: "TN-169"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-157"
  - "TN-158"
---

# TN-169 — Deliver host-evaluated route transitions

## Purpose

TN-155 requirement 5: a route transition with an animated transition,
animation values evaluated host-side per the scrolling-and-animation
architecture ("JavaScript configures interaction; native evaluates
frame-by-frame motion"). Today navigation is immediate: the new scene
replaces the old one in a single paint.

The full TN-048/TN-086/TN-087 animation-graph tracks stay open; this
slice delivers the framework-feel shape through the existing
display-list contract, the way TN-161 delivered scrolling through
host-owned paint offsets rather than the native scroll engine.

## Required outcome

1. **Scene wire format (backward compatible).** `DisplayListScene` gains
   an optional `transition` block: `{ kind: "slide" | "fade",
   durationMs, direction: "forward" | "backward" }`. Scenes without it
   are byte-identical to today; hosts that never read it keep working
   (unknown top-level field, not a new op kind). Both hosts validate the
   block when present and reject malformed values visibly.
2. **Runtime API.** `navigate(name, options?)` where options carry a
   transition request; the runtime normalizes it (defaults: slide,
   240 ms, forward) and stamps it on the FIRST scene rendered after the
   navigation — exactly one commit carries it, then it clears. Snapshots
   never carry it (viewport/transient rule).
3. **Browser host.** When a committed scene carries a transition and a
   previous accepted scene exists, the renderer interpolates over
   `requestAnimationFrame`: slide moves the outgoing scene out and the
   incoming scene in along the design axis (direction-aware); fade
   cross-fades alpha. A new commit mid-transition cuts to it.
4. **Android host with scheduling separation.** The same interpolation
   math, evaluated by a dedicated animation thread (HandlerThread), with
   frame drawing coordinated through a paint lock shared with the main
   thread's redraw — a blocked main thread (e.g. a long JS dispatch)
   cannot freeze an in-flight transition. Normal (non-transition)
   drawing stays on the main thread exactly as today. The interpolation
   math is a pure, JVM-testable evaluator.
5. **Day Plan** navigates with a forward slide into Progress and a
   backward slide back to Today; the shared-bundle parity gate carries
   the transition block through real QuickJS.

## Verification

- Widgets tests: navigate stamping (one commit only, cleared after,
  absent from snapshots, unknown screen still throws, direction/kind
  normalization).
- Browser tests: interpolation frames (recorded canvas) for slide
  forward/backward and fade; mid-transition cut; malformed block
  rejected by `sceneContractError`.
- JVM (Android): the pure evaluator maps progress → offsets/alpha with
  easing, clamps, and honors direction.
- Device gate: transition frames advance while the main thread is
  blocked (runOnMainSync sleep during an active transition), then
  settle on the new scene — the JS-stall scheduling-separation evidence
  for this slice.
- Full suites, typecheck, manifest, evidence packets, 8-gate CI.

## Out of scope

- The native animation graph, springs/curves vocabulary, and
  layout-affecting animated properties (TN-086/TN-087 stay open).
- Route lifecycle beyond the existing retained sessions (TN-063).
- Moving ordinary repaint off the main thread.

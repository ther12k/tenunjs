---
okf_version: 0.2
title: "ADR-0025: Scene semantics wire v1 — accessibility projects from the display-list scene"
summary: "Every committed scene carries an optional semantics block: one node per semantically meaningful widget, whose activations reference the existing tap-run table. Hosts map nodes onto platform accessibility services; no new dispatch verb exists."
type: decision
status: accepted
---

# ADR-0025: Scene semantics wire v1

## Context

The accessibility architecture (02-architecture/accessibility-semantics.md)
requires a semantics tree with role, label, value, hint, state, actions,
bounds, ordering, and live-region intent, updated with the same atomic
scene commit. The 2026-10-30 production-readiness review ranked
accessibility as the largest remaining blocker, and the display-list scene
carried no semantic projection at all: `Card.semantics` was dead config,
`semanticScene` is color-slot identity (TN-173), not accessibility.

The decision needed now is the WIRE CONTRACT hosts consume, because the
Android TalkBack bridge (TN-091) and any future iOS counterpart are built
against it.

## Decision

1. **The projection rides the scene** as an optional top-level block
   `scene.semantics = { semanticsVersion: 1, nodes: SemanticNode[] }` —
   the `scene.transition` precedent: hosts that predate it ignore an
   unknown field, so the wire change is additive and every existing
   bundle/host pairing keeps working. The block is present on every
   commit going forward.
2. **One node per semantically meaningful widget.** Text (static/header
   variants), Button, TextField, GestureDetector, opted-in Cards
   (label/hint/role/liveRegion), AppBar (header + menu), and scroll
   content. Decorative paint (rects, outlines, gradients, rings, lines)
   never emits a node; visual text absorbed by an interactive parent
   (Button label, GestureDetector caption) does not double-emit.
3. **Activations reuse the gesture table.** A node's actions carry
   `tapId`s into the SAME tap-run table touch uses; a host activates a
   node by dispatching the ordinary TAP/LONG-PRESS with that id. Platform
   accessibility actions therefore run the identical typed controller
   actions touch runs (01-requirements/accessibility-requirements.md:16)
   with zero new dispatch verbs.
4. **Stable ids, host-side generations.** Node ids are app-supplied
   (`semanticsId` props, TextField ids) or bounds-derived
   (`sem@x,y,w,h` — stable while geometry is stable, the ScrollView rule).
   The scene carries NO epoch counter: the projection is a pure function
   of the scene so identical layouts stay byte-identical across hosts
   (browser/native parity gates depend on this); hosts pair stable ids
   with their own commit counter for accessibility focus restoration.
5. **Content-space tagging.** Nodes inside a scroll region carry the
   region id exactly as their taps do; hosts resolve bounds against the
   scroll offset.
6. **Ordering is emission order** (paint order = reading order, LTR).
   RTL/bidi ordering joins the locale/scale/platform context work that
   remains open in TN-068.

## Consequences

- Golden fixtures gain the semantics block (regenerated from canonical
  source; `UPDATE_GOLDEN=1` is the documented regen path).
- `Card.semantics` becomes typed and live (`container | generic | group |
  alert`; `alert` implies a live region — calculator/counter/
  navigation-demo already pass these roles).
- The jsx prop-codecs widen for exactly `text.semanticsId`,
  `button.semanticsId`, `app-bar.semanticsId` (the TN-173 precedent).
- Host work (TN-091 TalkBack bridge: AccessibilityNodeProvider mapping
  roles/actions, focus sync, announcements) builds on this contract; a
  semantics-version bump requires the usual fail-closed pairing rule.

## Verification

- packages/widgets/test/semantics.test.ts: roles, absorption, tap-table
  wiring, the activation-equals-touch roundtrip, Card opt-in with
  live-region implication, app-bar header/menu, scroll tagging, id
  stability and byte-determinism.
- Full suite + typecheck + Android gate (parity harness carries the block
  on both hosts) + 8-gate CI.

## Revisit trigger

Focus-management semantics (modal traps, focus restoration policy) and
RTL ordering arrive with the TN-068 context design; either may extend
this version rather than break it.

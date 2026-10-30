---
okf_version: 0.2
title: "TN-179: Scene semantics wire v1 — accessibility projection on the display-list scene"
summary: "Every committed scene carries scene.semantics: one node per semantically meaningful widget whose activations reference the existing tap-run table, so platform accessibility services can drive the identical actions touch drives. The host-side bridge (TalkBack) is a separate issue."
type: issue
status: ready
issue_id: "TN-179"
milestone: "M4"
priority: "P1"
depends_on:
  - "TN-161"
  - "TN-160"
---

# TN-179 — Scene semantics wire v1

## Purpose

The 2026-10-30 production-readiness review ranked accessibility as the
largest remaining production blocker, and the scene contract carried no
semantic projection: screen readers see an opaque canvas. ADR-0025
decides the wire; this issue delivers it.

## Required outcome

1. `scene.semantics = { semanticsVersion: 1, nodes: SemanticNode[] }` on
   every commit (optional field; pre-TN-179 hosts ignore it).
2. Emission per ADR-0025: Text (text/header), Button (button + press,
   disabled state), TextField (value/state/focus action), GestureDetector
   (generic, absorbed label, press/long-press), opted-in Card
   (container/group/alert; alert implies liveRegion), AppBar (header +
   menu button), scroll content tagged with the region id.
3. Actions reference tap-run ids — accessibility activation dispatches
   the ordinary TAP/LONG-PRESS; no new verb.
4. Pure-function projection: no epoch counters on the wire (host-parity
   byte-determinism preserved); stable ids app-supplied or bounds-derived.
5. `Card.semantics` typed and live (examples already pass group/alert);
   `semanticsId` on Text/Button/AppBar; jsx prop-codecs widened for
   exactly those.

## Verification

- packages/widgets/test/semantics.test.ts (9 tests): roles + decorative
  absence; button node wired to the tap table; the
  activation-equals-touch roundtrip through installHostHandoff;
  GestureDetector absorption; TextField value/state/focus; Card opt-in
  and alert-implied live region; app-bar header/menu; scroll tagging with
  content-space bounds; id stability + byte-determinism across identical
  layouts.
- Goldens regenerated via the documented `UPDATE_GOLDEN=1` path (diff is
  purely additive).
- Full suite, typecheck, Android gate (parity carries the block on both
  hosts), 8-gate CI.

## Out of scope

- The Android TalkBack bridge (TN-091: AccessibilityNodeProvider, focus
  sync, announcements) — the next slice, built on this contract.
- RTL/bidi ordering and locale-aware labels (TN-068 context remainder).
- Focus management policy (modal traps, restoration) — extends a future
  version.

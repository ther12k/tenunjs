---
okf_version: 0.2
title: "TN-168: Harden ScrollView child normalization and theme-baker nested ops"
summary: "ScrollView silently drops nested-array children (empty region, no diagnostic); the theme baker passes sparse-array holes through scroll-region ops untouched and throws a raw TypeError on a non-array ops field."
type: issue
status: closed
issue_id: "TN-168"
milestone: "M4"
priority: "P2"
depends_on:
  - "TN-143"
  - "TN-161"
---

# TN-168 — Harden ScrollView child normalization and theme-baker nested ops

## Purpose

Two widgets-package P2s found by the 2026-10-29 readiness probes (same
family as TN-166's nested-content gaps):

1. **ScrollView drops nested-array children.** The constructor keeps
   `children` verbatim when it is an array, so `children={[items]}` (an
   array wrapping the real child array — the shape TSX callers naturally
   produce when composing lists) reaches layout as one non-node element.
   The region renders empty (contentHeight 0, no ops, no taps) with no
   diagnostic anywhere.
2. **Theme baker nested-op gaps.** `bakeOp`'s scroll-region branch maps
   children with `Array.prototype.map`, which SKIPS sparse-array holes —
   a hole passes through to the baked scene (surfacing later as the
   host-side "ops[0] is not an object" rejection instead of a bake-time
   error), and a non-array `op.ops` throws a bare TypeError from
   `null.map` rather than the typed `ThemeContractError` every other
   malformation produces.

## Required outcome

1. `ScrollView` flattens nested arrays in `children` (recursively); a
   single non-array child keeps today's wrapping. Layout then sees only
   real widget nodes.
2. The baker's scroll-region branch validates `op.ops` is an array with
   a typed `ThemeContractError`, and bakes children through a traversal
   that visits holes (so a hole fails the existing `isRecord` check with
   the region-attributed diagnostic instead of silently passing).

## Verification

- Widgets tests: `ScrollView({children: [list]})` produces the same
  region content as `ScrollView({children: list})`; baker tests pin the
  typed error for a non-array `ops` and for a hole, and the valid nested
  bake staying unchanged.
- Full `bun test` + typecheck; no host changes.

## Out of scope

- Any change to scene wire format or host validation (hosts already
  reject the malformed scenes fail-visibly — this moves the failure to
  the producing boundary).

## Status note (2026-10-29, closed)

Implemented and published in one session. Fixed in PR #253: ScrollView
flattens nested-array children and drops null/undefined entries; the
theme baker's scroll-region branch validates op.ops with a typed
ThemeContractError and traverses children so sparse holes fail at bake
time with the region-attributed diagnostic. Widgets tests pin both
behaviors; all eight CI gates green including the device gate.


---
okf_version: 0.2
title: "TN-149: Ship the launcher sample over the frozen seams"
summary: "The launcher-track proof app: a glyph app grid driven by the TN-147 launcher capability (services-composed, degradation-aware) with tap-to-launch and TN-148 long-press app options, exercised host-free through mountScreen plus a layoutScene lowering pass."
type: issue
status: closed
issue_id: "TN-149"
milestone: "M5"
priority: "P1"
depends_on:
  - "TN-147"
  - "TN-148"
---

# TN-149 — Ship the launcher sample over the frozen seams

## Metadata

| Field | Value |
|---|---|
| Milestone | M5 — Platform capability modules |
| Priority | P1 |
| Dependencies | TN-147 (launcher capability contract), TN-148 (long-press gesture) |
| Suggested size | One example PR (examples/launcher + gates) |
| Gate impact | First capability-consuming sample; proves both seams compose |

## Purpose

The launcher track (feasibility review 2026-10-16) lands seams before
surface. TN-147 froze enumerate/launch; TN-148 froze hold-to-act. A
sample that consumes both is the proof they compose into a real
home-screen app — the same role counter plays for the execution
contract and VOTOL for push-driven companions.

## Required outcome

- `examples/launcher` follows the counter project shape (tenun.config,
  main/app/theme/screens, README) and registers in the examples-graph
  gate's pinned sample list.
- The home screen binds `services.launcher` (TN-147 capability): a
  mount-time `loadApps` async action, tap-shaped `launchApp` recording
  the observable effect, `openOptions`/`closeOptions` for the TN-148
  long-press target, and degradation surfaces — a host without the
  capability renders `unsupported`, a `denied` capability routes to a
  grant-in-settings hint, other failures name their kind, all with a
  Retry action.
- The grid renders `Wrap` flow layout with `SizedBox` tiles and the
  host-picked `iconGlyph` (label-monogram fallback) — no new widgets,
  no protocol change.
- Tests drive the screen through `@tenunjs-examples/test-support`'s
  mountScreen with a fake launcher typed against the contract, and a
  `layoutScreen` pass proves the ready grid lowers to a display-list
  scene carrying tap AND long-press regions per tile.
- Search is explicitly out of scope for v1: the display-list contract
  lowers no text-input widget yet, and the sample stays honest with
  what actually renders (recorded as launcher-track follow-up).

## References

- [TN-147 — launcher capability seam](tn-147-freeze-launcher-capability-seam-contract.md)
- [TN-148 — long-press gesture](tn-148-carry-long-press-gesture-through-display-list.md)
- `examples/launcher/` (the sample)
- `examples/test-support/test/examples-graph.test.ts` (module-graph gate)

## Status note (2026-10-16, closed)

Closed via PR #230: `examples/launcher` landed with the drawer screen
(load/launch/options/degradation actions, Wrap grid, monogram
fallback), 7 host-free tests including the scene-lowering pass, and
registration in the examples-graph gate; `examples/tsconfig.json`
gained the `@tenunjs/platform` path mapping and the workspace lockfile
the example's dependency link. Search stays a recorded follow-up until
an INPUT lowering exists.

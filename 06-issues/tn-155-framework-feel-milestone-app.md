---
okf_version: 0.2
title: "TN-155: Framework-feel milestone app — the end-to-end Flutter-inspired experience"
summary: "One small TSX application that demonstrates the promised framework experience end to end: nested layout, editable text, independent scrolling, route transition with animation, direct Skia drawing, and the same code on every available embedder."
type: issue
status: closed
issue_id: "TN-155"
milestone: "M4"
priority: "P0"
depends_on:
  - "TN-143"
  - "TN-156"
---

# TN-155 — Framework-feel milestone app

## Metadata

| Field | Value |
|---|---|
| Milestone | M4 — Core widgets, text input, scrolling, and animation (umbrella; pulls M2 rendering and M3 navigation slices) |
| Priority | P0 |
| Dependencies | TN-143 (semantic color decision, closed), TN-156 (public layout semantics contract, closed) |
| Suggested size | Umbrella milestone — slice into agent-sized issues as each capability lands |
| Gate impact | Establishes the foundation for the README's positioning promise; prioritized over expanding the gallery |

## Purpose

The README positions TenunJS as a Flutter-inspired framework for building
native applications in TypeScript. That promise is currently supported by
horizontal proofs (a native BLE companion app, a widget gallery, contract
gates) but not by one application that demonstrates the *framework
experience* end to end — the thing a Flutter developer would recognize as
"building an app here feels like building an app."

TN-154 proved the platform substrate (native execution, services, touch).
This issue proves the framework layer on top of it.

## Implementation slices (2026-10-28)

Both declared contract dependencies are closed. Capability implementation
still lands in focused slices; this umbrella stays open until the full
application journey and host evidence below are complete.

| Slice | Owner and acceptance boundary |
| --- | --- |
| Bounded framework layout and Day Plan foundation | [TN-157](tn-157-adopt-bounded-typescript-layout-for-framework-feel-app.md): ordinary two-screen TSX app, explicit runtime viewport inputs, custom drawing, shared-bundle execution. |
| Host viewport delivery | [TN-158](tn-158-deliver-host-viewport-with-negotiation.md), closed: compatible input negotiation, logical units, initial dimensions and resize updates in browser and Android. Scaling a previous scene does not count as re-layout. |
| Ordinary semantic widget themes | Runtime switching slice delivered by [TN-170](tn-170-deliver-runtime-theme-switching-and-palette-themes.md) (`setTheme` invalidation, `paletteTheme`, extended role matching, Day Plan light/dark). TN-068 retains its dependencies and the deeper token work (ColorRef widget adoption, spacing/typography/locale/scale context). |
| Editable widget and IME path | [TN-160](tn-160-deliver-controlled-widget-text-input.md), in progress: controlled single-line TextField, guarded sessions, browser/Android adapters, and the Day Plan title. Live Android IME journey evidence remains required; broader TN-076/TN-078/TN-079/TN-081 scope stays open. |
| Independent list viewport | TN-083/TN-084, with gesture arbitration from TN-082. |
| Host-evaluated route transition and animation | [TN-169](tn-169-deliver-host-evaluated-route-transitions.md), closed: navigation commits carry an optional `transition` block; both hosts interpolate between the settled and incoming scene on their own frame clock (Android on a dedicated animation thread — frames advance while the main thread is blocked), with the shared easing curve and the Day Plan slide. The broader animation-graph tracks TN-048/TN-086/TN-087 and route lifecycle TN-063 stay open. |
| Final parity journey and README recording | [TN-171](tn-171-deliver-device-journey-and-readme-recording.md): the same-code device journey through the production Android surface (`FrameworkFeelJourneyTest`) and the README headline-demo recording. |

TN-157 adopts the frozen semantics in the already executable TypeScript
lowering. It does not close the broader TN-070/TN-071/TN-072 widget tracks
or substitute its headless execution checks for device evidence.

## Required outcome

A small shipped application (under `examples/`) composed of ordinary TSX
widgets that demonstrates, in one codebase:

1. **Screens composed from ordinary TSX widgets** — `Scaffold`, `AppBar`,
   `Column`/`Row`, `Card`, `Button`, theme-driven colors; no escape-hatch
   drawing for ordinary UI.
2. **Correct nested layout under changing screen sizes** — the TN-156
   contract exercised for real: bounded containers, `Expanded` in Rows and
   Columns, resize behavior that is defined rather than accidental.
3. **A real editable text field** — focus, real text editing, and (on
   Android) IME composition through the widget surface, not the legacy
   reference-app path.
4. **An independently scrolling list** — a scroll region nested inside
   surrounding widgets, not whole-scene scrolling.
5. **A route transition and a simple animation** — navigation between two
   screens with an animated transition; animation values evaluated
   host-side per the scrolling-and-animation architecture.
6. **Direct Skia-class drawing** — one `CanvasBox`-style custom visual,
   proving the escape hatch composes inside the widget tree.
7. **The same application code running through every available embedder** —
   browser preview host and the Android embedder today; the iOS embedder
   when it exists. Host divergence is a bug, not a port.

## Non-goals

- Not a gallery expansion: no new widget catalogue breadth beyond what the
  seven requirements exercise.
- Not a production app: platform polish (accessibility semantics, packaging)
  stays within its own milestone track.

## Verification

- `bun test` for the application's screens/actions under the existing
  example-test pattern.
- The Android engine-loop gate boots the compiled bundle in real QuickJS
  (`run_android_test.sh`), as TN-144/TN-154 do.
- Browser-host and Android renders of the same screens compared for
  structural parity.
- The application becomes the README's headline demo, replacing
  illustration-only examples.

## References

- [Product definition — positioning](../00-project/product-definition.md)
- [Framework positioning](../02-architecture/framework-positioning.md)
- [Public layout semantics](../02-architecture/layout.md) (TN-156)
- [Scrolling and animation](../02-architecture/scrolling-animation.md)
- [Text and IME](../02-architecture/text-and-ime.md)
- TN-154 (native platform substrate, closed)

## Status note (2026-10-30, closed)

All seven requirements are implemented with evidence on every available
host, delivered slice by slice: TN-157 (bounded layout + Day Plan
foundation), TN-158 (host viewport delivery), TN-160 (controlled text
editing), TN-161 (independent scroll regions), TN-169 (host-evaluated
route transitions), TN-170 (semantic palettes with runtime switching),
and TN-171 (same-code device journey + README recording; the browser and
QuickJS structural parity gates ran throughout). Day Plan is the
README's headline demo. Recorded limitations that stay open elsewhere:
font/CJK coverage and narrow-overflow polish (TN-160 notes), the live
soft-keyboard journey (ADR-0019 physical-device boundary), and TN-068's
deeper token work (ColorRef widget adoption, spacing/typography/locale/
scale context).

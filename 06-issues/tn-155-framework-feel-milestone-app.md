---
okf_version: 0.2
title: "TN-155: Framework-feel milestone app — the end-to-end Flutter-inspired experience"
summary: "One small TSX application that demonstrates the promised framework experience end to end: nested layout, editable text, independent scrolling, route transition with animation, direct Skia drawing, and the same code on every available embedder."
type: issue
status: ready
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
| Dependencies | TN-143 (semantic theme tokens, open), TN-156 (public layout semantics contract) |
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

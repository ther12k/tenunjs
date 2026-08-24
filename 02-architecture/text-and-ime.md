---
okf_version: 0.2
title: "Text and IME Architecture"
summary: "Text shaping, editable text, selection, and platform input contracts."
type: architecture
status: accepted
---

# Text and IME architecture

Text is split into display and editing concerns.

## Display text

The engine owns:

- Font registration and fallback
- Unicode shaping and bidirectional runs
- Line breaking, alignment, truncation, and measurement
- Glyph/resource caching
- Selection geometry primitives
- Device text scaling and locale inputs

## Editable text

A Tenun `TextField` has a native edit session. The engine paints its visible content, selection, caret, decoration, and error state, while the embedder participates in the platform text-input contract.

The edit session synchronizes:

- Text and composing range
- Selection and affinity
- Keyboard type and return action
- Secure entry
- Autofill metadata
- Cursor/selection geometry
- Editing commands and clipboard
- Focus and keyboard visibility

## Platform adapters

- iOS integrates through UIKit text-input protocols and native input services.
- Android integrates through the input-method connection and editor-info lifecycle.

IME callbacks are versioned with edit-session revisions. Stale platform callbacks cannot overwrite newer controller state. Composition text is not prematurely normalized or committed.

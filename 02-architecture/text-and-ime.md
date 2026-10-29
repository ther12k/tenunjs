---
okf_version: 0.2
title: "Text and IME Architecture"
summary: "Text shaping, editable text, selection, and platform input contracts."
type: architecture
status: accepted
---

# Text and IME architecture

Text is split into display and editing concerns. The sections below define
the target architecture; the final section records the narrower executing
prototype so implementation evidence is not confused with full M4 support.

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

## Current prototype: controlled single-line input (TN-160)

`TextField` from `@tenunjs/widgets` is an ordinary TSX widget with a
controlled string. It runs through `ApplicationRuntime` and the existing
display-list handoff; it does not expose DOM, Android, or engine objects to
application code. The older `@tenunjs-examples/ui-kit` component with the
same name remains a visual focus-ring stand-in.

### Ownership and editing values

Application controller state owns `value`. `onChanged(nextValue)` accepts
an edit by synchronously copying the proposed string into that state. If
the callback rejects or transforms it, the next rendered controlled value
wins and the host replaces its optimistic editing state. A selection-only
or composition-only update does not call `onChanged`.

The runtime owns one active editing session, identified by the field's
stable `id` and a monotonically allocated runtime-local `sessionId`.
Accepted edits advance `revision`. Selection is `{ base, extent }` in
UTF-16 code units and preserves direction; composition is an ordered,
nonempty `{ start, end }` range, or `null`. Ranges must be within the string.
CR/LF are invalid in this single-line slice; other text is transported
without normalization, including surrogate pairs and combining sequences.
That transport rule does not claim shaped or bidirectional caret geometry.

A tap activates the field at the end of its controlled string. Echoed
edits, ordinary rerenders, and viewport changes preserve the session and
ranges. Blur, submit, a route change, field removal, read-only transition,
snapshot restore, and disposal end the session. Ending composition clears
transient metadata; the current controlled string is not rolled back.
Snapshots contain the application string but no session identity,
revision, selection, composition, or host connection object.

### Scene and event boundary

The scene includes one nonpainting `text-input` operation per field:

| Fields | Contract |
| --- | --- |
| `op`, `id`, `x`, `y`, `w`, `h` | `op: "text-input"`; nonempty ID unique within the scene; finite geometry, nonnegative dimensions. |
| `text`, `selection`, `composing` | The authoritative complete editing value, using the UTF-16 rules above. |
| `focused`, `sessionId`, `revision` | At most one focused field; a focused field has a positive session ID and nonnegative revision. Unfocused fields have session/revision zero and no composition. |
| `keyboardType`, `returnAction`, `readOnly`, `label` | This slice accepts `"text"` and `"done"`; a read-only field cannot be focused. Labels identify the editor, without claiming an accessibility tree. |
| Existing fixed-position metadata | Optional `fixed`, `anchor`, and `anchorSize` follow the scene's current anchoring rules. |

The existing dispatch channel carries three verbs:

| Verb | Payload |
| --- | --- |
| `TEXT_EDIT` | `id`, `sessionId`, `baseRevision`, and the full `text`, `selection`, `composing` editing value. |
| `TEXT_BLUR` | `id`, `sessionId`, `baseRevision`. |
| `TEXT_SUBMIT` | `id`, `sessionId`, `baseRevision`; ends the session and invokes the current widget's optional `onSubmitted`. |

Hosts echo the last accepted descriptor's identity and revision; they do
not assign runtime revisions. Before applying a valid callback, the
runtime reconciles current controller state so an unpainted programmatic
change or removed field cannot be overwritten by an old native edit.
Malformed values fail with `INVALID_TEXT_EDIT`. Ended/different sessions
fail with `STALE_TEXT_SESSION`; a current session with an old revision
fails with `STALE_TEXT_REVISION`. For either stale rejection the handoff
republishes authoritative state and retains the error. Rejected optimistic
host edits must return to that accepted state.

Whole-scene validation precedes field adoption. Malformed descriptors,
duplicate IDs, and multiple focused fields cannot partially replace the
previous scene or its input bindings. Drawing remains ordinary scene ops;
field text includes an absolute finite `TextOp.clip` rectangle, translated
with its text under fixed anchoring. This local clip bounds glyph paint
despite approximate metrics; it is not a general scroll-container clip.

The scene stays at version 1, but `text-input` is a required capability
marker. Pre-input hosts reject it as an unknown op rather than accepting
an inert field. Bundles using it must ship with the corresponding host
update; the additional optional text clip is not independently negotiated.

### Platform adapters and evidence boundary

The generic browser host uses a transparent native `<input>` for keyboard,
clipboard, selection, and composition events while the canvas paints the
field. The Android host uses a real `Editable` and `BaseInputConnection`
for replacement, composing spans, cursor positions, surrounding-text
queries/deletion, batched edits, and Done. Neither adapter normalizes the
application's string to make a rejected edit appear successful.

Editor synchronization occurs after application dispatch returns. A
connection belongs to one host/engine, field session, and adapter
generation. Acknowledged edits and geometry-only changes retain it;
external controlled changes, replacement, and disposal retire old
callbacks and queries. This avoids calling platform input services from
inside the synchronous scene-commit callback.

Day Plan consumes this path without platform-specific screen code.
Script-host/QuickJS transcript comparison proves shared application
execution; the installed `DisplayListTextInputTest` exercises the actual
Android InputConnection and JNI transport with a contract fixture. Neither
alone proves a live soft-keyboard or rendered Day Plan journey. That
integration evidence remains part of TN-155.

Pointer-based caret placement, selection handles, full shaping/bidi
geometry, multiline/forms, secure entry, autofill, iOS, keyboard-inset
coordination, semantic accessibility, and full focus traversal remain
broader TN-075–TN-081 work. TN-160 does not close those tracks.

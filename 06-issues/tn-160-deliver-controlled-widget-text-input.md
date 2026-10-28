---
okf_version: 0.2
title: "TN-160: Deliver controlled widget text input"
summary: "TN-155 editing slice: an ordinary single-line TSX TextField, revision-safe edit sessions, browser and Android input adapters, and an editable Day Plan title."
type: issue
status: in-progress
issue_id: "TN-160"
milestone: "M4"
priority: "P0"
depends_on:
  - "TN-158"
---

# TN-160 — Deliver controlled widget text input

## Metadata

| Field | Value |
| --- | --- |
| Parent milestone | TN-155 — framework-feel application |
| Dependencies | TN-158 (host viewport delivery, closed), including TN-157's application/runtime foundation |
| Suggested size | One vertical slice: controlled widget, transient runtime session, two host adapters, application journey |
| Gate impact | Implements the ordinary-widget path for TN-155's editable-field requirement; live Android IME and complete milestone journey evidence remain explicit integration work |

## Purpose and dependency boundary

The Android notes reference application has a keyboard path, but Day Plan
cannot obtain it through an ordinary TSX widget. The ui-kit's existing
`TextField` is a visual focus-ring component. This slice adds a controlled
`TextField` to `@tenunjs/widgets` and carries its editing state through the
existing application handoff, generic browser host, and Android embedder.

This is a scoped adoption of the accepted text/IME architecture in the
current TypeScript/display-list prototype, following the roadmap's TN-155
sequencing overlay. It uses the closed TN-158 execution path and does not
depend on an invented selected-engine, text-shaping, or persistent-element
API. TN-075–TN-081 retain their dependencies and broader shaping, iOS,
forms, secure entry, autofill, accessibility, selection-handle, keyboard-
inset, and focus-tree requirements. TN-068 still owns semantic widget
themes and inherited invalidation. None of those issues closes here.

## Required outcome

1. **An ordinary controlled widget.** Application code supplies a stable
   `id`, `value`, and `onChanged` callback, with optional `label`,
   `placeholder`, `readOnly`, and `onSubmitted`. The controller owns the
   string. Selection and composition use UTF-16 offsets, remain transient,
   and never enter application snapshots. CR/LF are rejected; other text
   is not silently normalized or prematurely committed.
2. **Guarded runtime editing.** A focused field has a runtime-local session
   identity and revision. `TEXT_EDIT`, `TEXT_BLUR`, and `TEXT_SUBMIT` must
   identify the current field/session/revision. Stale callbacks fail with
   `STALE_TEXT_SESSION` or `STALE_TEXT_REVISION`, and the handoff republishes
   authoritative state. Newer controlled values, removal, and read-only
   changes are reconciled before an old edit can overwrite them.
3. **Explicit host participation.** A nonpainting `text-input` scene op
   carries the required editor descriptor; ordinary drawing ops paint the
   field. Hosts validate whole scenes before adopting fields and reject
   duplicate IDs, multiple focused fields, or malformed descriptors.
   Pre-input hosts reject the unknown op, rather than showing a field
   that cannot edit. Field glyphs use a finite `TextOp.clip` rectangle.
4. **Native editing services.** The browser host uses a transparent native
   input for keyboard, selection, clipboard, and composition events. The
   Android host uses real `Editable`/`BaseInputConnection` semantics for
   selection replacement, composing spans, cursor positions, surrounding-
   text queries/deletion, batched edits, and Done. Geometry-only updates
   preserve accepted sessions; replaced or disposed hosts reject old
   connection callbacks. Platform focus work follows dispatch completion.
5. **A real application consumer.** Day Plan edits its title with the
   public widget and shows that title on Progress. Editing, task actions,
   resizing, navigation, and snapshot restore use one portable TSX bundle.
   Older snapshots without a title retain the shared default; an explicit
   empty title stays empty. No application code owns native edit sessions.

## Verification

- Widget/runtime/handoff suites cover controlled acceptance/rejection,
  selection-only changes, composition, Unicode, invalid ranges/newlines,
  duplicate fields, newer controller state, resize, route changes,
  read-only/removal, restore, and disposal. Existing valid example scenes
  and package-consumer behavior remain compatible.
- Browser adapter tests cover native-event translation and editor
  replacement/retirement; real-browser checks exercise the actual DOM
  input and canvas host. Approximate text metrics do not substitute for
  checking the field's hard paint clip.
- The Android QuickJS gate replays the compiled Day Plan bundle through
  editing, resizing, navigation, restore, and expected stale rejections,
  comparing the complete committed scenes with the script-host transcript.
- Kotlin/JVM tests cover descriptor validation, session ownership, and
  UTF-16 transport. `DisplayListTextInputTest` directly drives the installed
  `InputConnection` against a contract fixture through production
  JNI/QuickJS. It is adapter evidence, not a live soft-keyboard or rendered
  Day Plan journey; the latter remains TN-155 integration evidence.
- Run the full TypeScript gate, the browser host's separate typecheck,
  external-consumer rehearsal, available Android gates, manifest/evidence
  validation, and a fresh-checkout reproduction. Record unavailable SDK,
  device, and hosted checks explicitly.

## Limits and remaining work

This slice supports single-line plain text with one active editing session.
A tap places the caret at the end; pointer-based caret placement remains
future work. It does not implement multiline forms, password fields,
autofill, iOS, native selection handles, a focus traversal tree, accessible virtual
controls, or shaped/bidirectional caret geometry. Field-local text clipping
does not solve general scroll-region clipping. Independent scrolling,
host-evaluated transitions/animation, and the complete same-code device
journey remain TN-155 work. Existing BLE and other host-hardening issues
are outside this slice.

## References

- [Current prototype text-input contract](../02-architecture/text-and-ime.md)
- [Controlled TextField API](../04-api/widgets-and-styling.md)
- [Day Plan](../examples/framework-feel/README.md)
- [TN-155](tn-155-framework-feel-milestone-app.md)
- [TN-158](tn-158-deliver-host-viewport-with-negotiation.md)

## Status note (2026-10-28 UTC, implementation prepared)

The branch implements the controlled widget, runtime sessions, host
adapters, and Day Plan title editing. TN-160 remains `in-progress` pending
publication and repository CI gates, including execution of the new
Android installed-adapter tests. TN-155
and the broader M4 owners listed above remain open. No live Android IME,
physical-device, or complete framework-feel journey is claimed by this
implementation note.

Local evidence collected while preparing the branch:

| Check | Evidence |
| --- | --- |
| Fresh-checkout TypeScript gate | Frozen dependency install, all five typecheck projects, and 572 tests / zero failures / 3,262 assertions passed. The generic browser host's separate typecheck also passed. No generated fixture or bundle from the preparing checkout was reused. |
| Real browser host | Headless Chromium 156.0.8078.73: seven journey checks passed, including DOM composition/reconversion away from the caret, replacement/commit, Unicode and backward selection, viewport retention of the same editor/session, Enter, canvas route actions, and snapshots without IME metadata. |
| Field paint containment | Chromium pixel comparison: 2,086 changed pixels inside the field's clip and zero outside it. |
| Native QuickJS replay | The compiled Day Plan bundle produced twenty structurally equal script-host/native scenes, with sixteen accepted dispatches and three exact typed stale rejections. Existing native engine loops passed. SDK/NDK packaging was unavailable in this local environment. |
| Android source/JVM checks | All production Kotlin and all nine instrumentation source files compiled against API 36; 68 JVM tests passed. The three new installed-adapter tests are compiled but have not run here. This is not an installed-device or live-keyboard result. |
| External consumer | The existing tarball-only rehearsal passed both JSX transforms, public runtime subpaths, the unchanged scene digest, host execution, and an application-only behavior change. Its input-less fixture supplies compatibility evidence, not editing evidence. |
| Existing architecture evidence | The validator selftest and structural validation passed for all three packets. No `spikes/` or `benchmarks/` inputs changed; strict native artifact replay remains a hosted gate. |
| Content manifest | Validation and all eleven mutation selftests passed; 269 governed Markdown resources are indexed. |

Independent review corrected the field's theme color pair and real glyph
clipping. Both adapters retain a native editor only for an exact
text/selection/composition acknowledgement at the next revision. A
controlled rewrite or rejected scene retires the optimistic connection,
even when the last accepted descriptor is unchanged.

The publication access check failed because this session has no GitHub
write credentials. A format-patch and raw verification handoff accompany
the prepared branch; no PR, merge, hosted CI, Rust/ABI gate, Android APK,
NDK build, or installed-device execution is claimed here.

The browser capture also exposes this environment's missing CJK/emoji
fonts and existing narrow-layout text overflow outside the edited field.
Unicode transport and the field's hard clip do not prove font fallback,
full shaping, or arbitrary widget overflow behavior. The capture is not
promoted to a README headline demonstration.

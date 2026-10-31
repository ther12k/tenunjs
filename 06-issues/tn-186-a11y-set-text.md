---
okf_version: 0.2
title: "TN-186: Accessibility ACTION_SET_TEXT through the revisioned text contract"
summary: "TN-091's ACTION_SET_TEXT remainder: editable textfield nodes expose the framework action, and the host routes it through the revisioned TEXT_EDIT contract — focusing the field via its ORDINARY tap when no session is live (accessibility activation ≡ touch), committing full replacements, refusing read-only fields and contract violations fail-visibly."
type: issue
status: in-progress
issue_id: "TN-186"
milestone: "M5"
priority: "P1"
depends_on:
  - "TN-179"
  - "TN-180"
  - "TN-160"
---

# TN-186 — Accessibility ACTION_SET_TEXT through the revisioned text contract

## Purpose

TN-180's provider bridge exposed ACTION_CLICK/LONG_CLICK/FOCUS but not
text entry: `createAccessibilityNodeInfo` set `isEditable` without
offering `ACTION_SET_TEXT`, and `performAction` ignored it. TalkBack
voice entry, Voice Access, and braille displays replace editable text
through that action — the last code slice of TN-091 that does not need
a physical device.

## Required outcome

1. Editable textfield nodes (role `textfield`, not `readOnly`) expose
   `AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_TEXT`.
2. `performAction(ACTION_SET_TEXT)` reads
   `ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE` and forwards to a new
   `AccessibilityHost.setSemanticText(node, text)`.
3. The host implementation:
   - Refuses legacy (non display-list) scenes, read-only/disabled
     nodes, and nodes without a press action.
   - When the field has no live session, runs the SAME focus tap a
     TalkBack activation runs (ADR-0025 rule 3); the commit adopts the
     session synchronously (`adoptDisplayTextInput` inside
     `syncFromScene`).
   - Commits a full replacement through the SAME revisioned
     `TEXT_EDIT` path the IME uses (`dispatchTextEdit`): selection
     collapses to the end, no composition survives.
   - Runtime rejections (stale revision, single-line contract) surface
     as `false` with the previous text intact — fail-visible.

## Verification

- `EngineAccessibilitySetTextTest` (device gate): set-text on an
  UNFOCUSED field focuses-then-replaces through the adopted session;
  a second write rides the live session; empty string clears; the
  semantic node's announced value follows the commit; read-only fields
  refuse (no action offered, attempt returns false, text unchanged);
  a multiline replacement is rejected by the runtime contract with the
  previous text surviving.
- The controlled bundle validates id/sessionId/baseRevision exactly
  like the production ApplicationRuntime.
- 8/8 CI gates including the KVM device gate.

## Out of scope

- Physical-device TalkBack journeys (TN-091's remaining evidence,
  needs the phone per ADR-0019).
- ACTION_CHANGE_FOCUS/next/previous-navigation semantics.

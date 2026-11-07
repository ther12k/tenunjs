---
okf_version: 0.2
title: "TN-194: Generic KEY action dispatch from the Android host"
summary: "Android key events that the IME path does not consume are dispatched to the runtime as generic KEY actions {keyCode, phase} instead of being logged and dropped; BACK keeps its existing host handling. A framework focus model stays future work — v1 apps build their own focus helper over these actions."
type: issue
status: ready
issue_id: "TN-194"
milestone: "M5"
priority: "P1"
depends_on: []
---

# TN-194 — Generic KEY action dispatch

## Purpose

`TenunSurfaceView.kt:591-599` feeds key events only into the IME path
and otherwise logs them; nothing reaches the bundle, so D-pad-driven
TV UIs cannot be built. BACK handling lives in the host
(`MainActivity.kt:118-146`) and must keep working unchanged.

## Required outcome

1. In `onKeyDown`/`onKeyUp`, when the IME does not consume the event,
   dispatch a `KEY` action `{keyCode: number, phase: "down"|"up"}`
   into the engine and request a redraw.
2. BACK is excluded from the generic path (host behavior untouched);
   the exact exclusion list is documented in the code.
3. No focus semantics in the framework: focus belongs to the app in
   v1 (TN-196's app-level helper); a framework focus model is recorded
   as future work in ADR-0028, not implemented here.
4. Gate: TS verify + Android host test green; on-device evidence that
   injected D-pad keyevents drive the example app's focus on the Mi TV.

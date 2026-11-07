---
okf_version: 0.2
title: "TN-191: examples/tvremote — companion-class vertical slice against a real Android TV"
summary: "A phone remote for Android TV using only the platform capabilities (discovery → keys → net): pure-TS v2 protocol module (pairing, protobuf key/text/launch messages ported from the Apache-2.0 reference), pairing UI with on-TV code, d-pad with correct press/hold semantics, fake-TV browser preview host, and a device acceptance script against a physical set. No cloud, no telemetry."
type: issue
status: ready
issue_id: "TN-191"
priority: "P1"
depends_on:
  - "TN-188"
  - "TN-189"
  - "TN-190"
---

# TN-191 — examples/tvremote

## Purpose

Polytron proves BLE end to end; this proves net+keys+discovery the same
way, with the app class the 2026-11-07 review was written for. The
target device needs nothing installed: `com.google.android.tv.remote.service`
on stock Android TV speaks the v2 protocol.

## Required outcome

1. `examples/tvremote/src/protocol.ts` — pure TypeScript: the
   RemoteMessage protobuf encode/decode and the pairing state machine,
   ported from `github.com/tronikos/androidtvremote2` (Apache-2.0,
   attribution in the file header), fully unit-tested headless like
   Polytron's `protocol.ts`.
2. Screens: discover → pairing (identity generation, on-TV code entry,
   pin storage) → remote (d-pad with **press and release as separate
   events** so held keys repeat on the TV, back/home, volume, text
   input via the protocol's text messages, app tiles for the TV's
   installed apps).
3. `preview.ts` fake-TV host: a browser-side fake advertising a
   connectable endpoint, running the same pairing handshake, so the
   whole flow is authorable and testable without hardware.
4. `run_device_acceptance.sh` entry following the embedder's existing
   device-gate style: pair against a physical Android TV, send a key
   journey, verify the TV reacts, all on-device evidence per ADR-0019.

## Verification

- Headless: protocol golden-bytes tests, pairing state machine table
  tests, fake-TV end-to-end flow in the preview harness.
- Device gate: pair with a physical set (session evidence: MiTV-AXSO0,
  Android 9), d-pad/hold/volume/text journeys pass, reconnect after
  link loss within the documented foreground policy.

## Out of scope

- Bluetooth HID fallback (needs API 28+ foreground-only registration;
  separate issue after this lands).
- Voice search, multi-TV switching, wearables.

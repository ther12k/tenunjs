---
okf_version: 0.2
title: "TN-191: examples/tvremote — companion-class vertical slice against a real Android TV"
summary: "A phone remote for Android TV using only the platform capabilities (discovery → keys → net): pure-TS v2 protocol module (pairing, protobuf key/text/launch messages ported from the Apache-2.0 reference), pairing UI with on-TV code, d-pad with correct press/hold semantics, fake-TV browser preview host, and a device acceptance script against a physical set. No cloud, no telemetry."
type: issue
status: closed
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

## Status note (2026-11-12, closed)

Implemented in `examples/tvremote` as the companion-class vertical slice (ADR-0027, TN-191):

1. **Pure TypeScript protocol (`examples/tvremote/src/protocol.ts`)**:
   Protobuf varint framing and wire codec ported from `tronikos/androidtvremote2` (Apache-2.0, attribution in header). Full Polo pairing messages (`OuterMessage`, `PairingRequest`, `Options`, `Configuration`, `Secret`, `SecretAck`), secret hash computation, and `RemoteMessage` codec (`RemoteConfigure`, `RemoteSetActive`, `RemoteKeyInject`, `RemoteImeBatchEdit`, `RemoteAppLinkLaunch`, `RemotePingRequest`/`Response`, volume, app status).
2. **Screens & Runtime (`examples/tvremote/src/`)**:
   - `discover.screen.tsx`: mDNS device browsing via `discovery.browse({ serviceType: "_androidtvremote2._tcp" })` with manual host:port fallback.
   - `pairing.screen.tsx`: TLS session on port 6467 with client certificate, Polo handshake, on-TV 6-digit hex code entry and verification.
   - `remote.screen.tsx`: D-Pad with separate press (`START_LONG`) and release (`END_LONG`) events for held key repeats on the TV, volume controls, text injection via IME, app quick launch tiles (YouTube, Netflix, Prime, Spotify).
3. **Browser Preview Host (`preview.ts`, `dev.ts`, `preview.html`)**:
   Simulated Android TV host demonstrating pairing handshake (generating PIN), remote command execution, volume tracking, and wire protocol traffic log without requiring physical hardware.
4. **Verification**:
   Headless protocol tests (varint framing, Polo pairing, RemoteMessage codec, key inject hold/release) and runtime integration tests (18 tests passing in `examples/tvremote/test/`). Typecheck and full test suite passing (853 tests total).


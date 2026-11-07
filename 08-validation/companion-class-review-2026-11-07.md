---
okf_version: 0.2
title: "Companion-device app class review (2026-11-07)"
summary: "Source-traced review of what TenunJS needs to serve companion-device apps (phone controls a nearby product over LAN/BLE), using a phone-as-Android-TV-remote as the concrete driver. Finds the capability-seam architecture ready and BLE proven end to end; the gaps are TCP+TLS-with-client-cert networking, mDNS/NSD discovery, a Keystore-backed identity story, and a background/socket policy. Files ADR-0027 and TN-188..192."
type: report
status: accepted
---

# Companion-device app class review (2026-11-07)

## Scope and method

Read-only, source-traced review of `main` at `3028df5`. Inspected:
`packages/platform/src/*` (host, capability, ble, storage, camera,
launcher), `examples/polytron/` (README, layout), `embedders/android/`
(layout, scripts), the merged-PR history through #276, and the OKF docs
for platform requirements and the native-module IDL. **Not inspected:**
`engine/`, `packages/protocol/`, `packages/core/`, the iOS embedder, and
whether any IDL code generation exists beyond the accepted
`04-api/native-module.md` design. No code was executed; per ADR-0022
nothing here is device evidence except where a device fact is explicitly
cited as an external observation.

## The driver workload

A companion app the framework cannot express today: a phone that pairs
with and controls an Android TV over Wi-Fi using the platform's built-in
**Android TV Remote v2** service (pairing over TLS with a generated
client certificate and an on-TV confirmation code, then a persistent
TLS connection carrying protobuf-framed key, text, and launch events).
Target-device observations from the review session (external, not
framework evidence): a Xiaomi MiTV-AXSO0 (Android 9) on hand runs
`com.google.android.tv.remote.service` enabled — the TV side needs no
install, no ADB, and no developer mode. An optional later phase is the
Bluetooth HID Device profile (phone-side API 28+, foreground-registered
only), which would make the phone a real Bluetooth remote.

This class generalizes: POS printers, smart appliances, drones, IoT
hubs — an app whose value is a TLS/BLE conversation with one specific
nearby device, authenticated at first-use.

## What already works (keep and reuse)

- **The capability seam is the right shape and is proven.**
  `packages/platform/src/host.ts` gives the extension recipe (capability
  module + `HostCapabilities` member + `unsupportedX` stub +
  `defineHostCapabilities` wiring), fail-closed per TN-141, with a total
  surface for TN-145 parity. `ble.ts` shows the quality bar: result
  types instead of throws, tri-state link (`offline | searching |
  linked`), push notifications with idempotent unsubscribe, static
  permission metadata, `contractVersion`.
- **A JS↔native path exists and carries a real protocol.** Polytron's
  README documents the JNI host-service bridge (`tenun_host_call`,
  `tenun_android_bridge.c`) injecting native Android GATT into the
  runtime, with Web Bluetooth as the browser-preview implementation and
  headless fakes in tests — the exact host-per-transport pattern three
  more capabilities need.
- **Binary payloads already cross the seam** (`Uint8Array` BLE
  notifications), so a socket capability needs no new marshalling
  concept.
- **App OTA bundles** (embedder `OtaManager`, see the 2026-09-28 host
  review) can later distribute companion-app updates with no store.

## Gaps (each maps to a filed issue)

- **G1 — No socket capability.** Nothing in `packages/platform/src/`
  offers TCP/TLS; the remote protocol needs a client-certificate TLS
  session that stays open and pushes data. → TN-188, `04-api/net.md`.
- **G2 — No secure identity capability.** `storage.ts` is an app-scoped
  UTF-8 KV (by design, codecs out of the seam) — pairing private keys
  must be generated and held in Android Keystore and never enter JS.
  → TN-189, `04-api/keys.md`.
- **G3 — No discovery capability.** No mDNS/NSD browse; `_adb-tls-connect._tcp`-class
  service discovery, and for this driver `_androidtvremote2._tcp`, plus
  a manual host:port fallback, is how a companion finds its device.
  → TN-190, `04-api/discovery.md`.
- **G4 — No documented socket-survival policy** across app
  background/foreground; hosts diverge silently today. The ADR records
  a v1 contract (foreground-first) instead of leaving it undefined.
- **G5 — No vertical slice for the class.** Polytron proves BLE+UI; a
  LAN/TLS companion (the TV remote) would prove net+keys+discovery the
  same way, including a fake-device preview host and a device gate.
  → TN-191, TN-192.

## Recommendations

Adopt ADR-0027 (three capabilities, keys-never-in-JS, contract v1),
implement in the TN-188..190 order, then land `examples/tvremote`
(TN-191) with a latency measurement harness (TN-192) so the class gets
the same evidence discipline as rendering. External protocol reference
for the driver: `github.com/tronikos/androidtvremote2` (Apache-2.0) for
the pairing sequence and protobuf schema; no code is copied in the plan
docs.

## Explicit limits

Static reading only; no bundle was run, no device or CI gate was
driven, and "works" above means source-and-doc-traced, not executed by
this review. The TV-side observation is a property of one firmware
build, not a compatibility claim.

---
okf_version: 0.2
title: "ADR-0027: Companion-connectivity capabilities — net, keys, discovery"
summary: "Companion-device apps (phone pairs with and controls one nearby product over LAN or BLE) need three more host capabilities delivered through the TN-141 seam recipe: net (TCP+TLS sessions with client-certificate auth and push data), keys (Keystore-backed identities whose private material never enters JS), and discovery (mDNS/NSD browse). All follow the ble.ts quality bar: result types, tri-state link, idempotent unsubscribe, static permission metadata, contract v1, preview-host shims and fail-closed stubs."
type: decision
status: accepted
---

# ADR-0027: Companion-connectivity capabilities — net, keys, discovery

## Context

The platform layer covers the UI side of both OSes and, since Polytron,
one device-side capability (BLE GATT) end to end. The companion-device
app class — a phone that pairs with and controls one nearby device
(Android TV remote, appliance, printer, hub) — additionally needs a
persistent client-certificate TLS session, a way to generate and hold
that identity safely, and a way to find the device. None of these exist
in `packages/platform/src/` today (see the 2026-11-07 companion-class
review for the traced gaps G1–G5). The TV-remote driver needs no TV-side
install: the target set's `com.google.android.tv.remote.service` speaks
the v2 protocol.

## Decision

Add three capabilities through the documented `host.ts` recipe, one
issue each (TN-188, TN-189, TN-190), contract version 1:

1. **`net`** — `connect(options) → NetSession`: TCP, optionally TLS
   with a `keys` identity as the client certificate and either a
   pinned server fingerprint or a first-use acceptance mode for
   pairing flows. `NetSession` writes `Uint8Array`s, pushes received
   data and link-state through listeners with idempotent unsubscribe,
   and closes idempotently — the `ble.ts` tri-state link reused
   verbatim (`offline | searching | linked`).
2. **`keys`** — Keystore-backed identities: `generateIdentity`,
   `sign(handle, bytes)`, `exportCertificatePem(handle)`,
   `removeIdentity`. **Private key material never enters JS; handles
   are opaque aliases.** Server-trust pins (SHA-256 of an accepted
   peer certificate) are ordinary values and stay in `storage` —
   `keys` holds only the phone's own identity.
3. **`discovery`** — `browse({ serviceType })` with pushed results and
   idempotent stop, `resolve()` to host/port. Manual host:port entry is
   application UI, not a capability; every discovery UI keeps it as a
   fallback.

Shared rules (all three): `CapabilityResult` returns, never throws;
static `permissionPrerequisites()` metadata; unsupported stubs
fail-closed through `defineHostCapabilities`; the browser preview host
ships a shim (loopback WebSocket proxy for `net`, in-memory keyring for
`keys`, no-op-plus-manual-entry for `discovery`) so authoring and
headless tests need no hardware; Android hosts implement through the
existing JNI host-service bridge (`tenun_host_call`).

**Socket survival, v1 contract:** sockets are foreground-scoped. Hosts
document what happens on background/foreground (Android today: the
process and its sockets are killed at OS discretion; reconnect-on-
foreground is application policy via the tri-state link). A background
service capability is explicitly out of scope until a companion
workload proves it needs one.

The vertical slice that proves all three is `examples/tvremote`
(TN-191) with its fake-TV preview host and a measured end-to-end
latency harness (TN-192), mirroring how Polytron proves BLE. The
external protocol reference is `github.com/tronikos/androidtvremote2`
(Apache-2.0); the example ports its pairing logic, it does not link it.

## Consequences

- `HostCapabilities` grows to seven members; TN-145's parity surface
  and the `unsupportedX` set grow with it (mechanical, recipe-defined).
- The native-module IDL (`04-api/native-module.md`) remains the
  long-term shape for these seams; until codegen lands they follow
  `ble.ts` as hand-written contracts, which the ADR records rather
  than leaving ambiguous.
- `storage` stays a plain UTF-8 KV — no secret flag; secrets are either
  key material (never in JS at all) or ordinary values, and hosts that
  can back storage with encrypted storage may say so in availability
  details.
- iOS implementations follow the same contracts (Network.framework,
  Secure Enclave/keychain, Bonjour) on the ADR-0019 evidence schedule;
  the contracts are written host-neutral for that reason.

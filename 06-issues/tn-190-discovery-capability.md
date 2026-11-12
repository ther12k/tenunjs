---
okf_version: 0.2
title: "TN-190: Discovery capability — mDNS/NSD browse and resolve"
summary: "Add the discovery host capability per ADR-0027 and 04-api/discovery.md: event-driven browse of a service type with idempotent stop and cancel signal, resolve to host/port/TXT, service identity by name@domain. Android NsdManager with multicast lock; iOS NWBrowser later; browsers get the unsupported stub by design so apps always keep manual host:port entry."
type: issue
status: ready
issue_id: "TN-190"
priority: "P1"
depends_on:
  - "TN-141"
---

# TN-190 — Discovery capability

## Purpose

A companion app must find its device without typing addresses (review
2026-11-07, gap G3). The TV driver browses `_androidtvremote2._tcp`;
the pattern is the same for every companion product.

## Required outcome

1. `packages/platform/src/discovery.ts` per `04-api/discovery.md`
   (`contractVersion: 1`, pushed found/lost events, idempotent stop,
   cancel signal, separate resolve).
2. Android host side: NsdManager browse with a multicast lock held for
   the browse's lifetime and released on stop.
3. `unsupportedDiscovery` stub + `defineHostCapabilities` wiring;
   TN-145 parity update. The browser preview host stays unsupported on
   purpose — apps render manual entry from availability, never an
   error screen.

## Verification

- Headless tests against a scripted fake resolver: found/lost events,
  stop idempotence, cancel mid-browse, resolve not-found is structured.
- Android device gate: browsing a real advertised service on the LAN
  (the TN-191 fake TV advertises one) finds, loses (service down), and
  re-finds it.

## Out of scope

- Advertising (the phone as a service), DNS-SD subtypes, Wi-Fi Direct,
  Bluetooth LE discovery (BLE scanning already exists).

## Status note (2026-11-12, implemented — closing evidence gated on the hosted device run)

Implemented on `feat/tn-190-discovery-capability` against the frozen contract (`packages/platform/src/discovery.ts`, contractVersion 1, exactly the `04-api/discovery.md` shapes):

1. **Contract + shared bounds** — `discovery.ts` plus `discovery-validation.ts`: `DISCOVERY_PERMISSIONS` with the android `CHANGE_WIFI_MULTICAST_STATE` tier and empty ios/web tiers; `DiscoveredService` identity `serviceName@domain`; service-type shape `_name._tcp|_name._udp` (label ≤ the DNS 63-char ceiling — the RFC §7 15-char suggestion does not fit the frozen `_androidtvremote2._tcp` driver use), instance names 1..63 **UTF-8 bytes** with no dots/control/edge spaces, TXT tables bounded (64 entries, 255-byte values); bounds shared across the native adapter and the Android host so a payload refused in TypeScript is refused for the same reason in Kotlin. `HostCapabilities` gained its SEVENTH member (`discovery`) with `unsupportedDiscovery` fail-closed wiring and TN-145 parity assertions. The browser preview host stays unsupported ON PURPOSE (manual-entry stub by spec).
2. **Native adapter** — `discovery-native.ts` `createHostDiscoveryBridge(hostCall)`: the split wire (synchronous `browse`/`stop`/`resolve` requests + host-pushed `DISCOVERY_EVENT` dispatch actions: `browseStarted`/`serviceFound`/`serviceLost`/`browseStopped`/`resolve`). The browse promise settles at the start outcome; services flow through listeners; `stop()` is idempotent and crosses the wire once; cancelling settles JS-side from the caller's `CapabilityCancelSignal` — including cancelling AFTER the browse started, which silences it (the frozen contract: a cancelled signal stops the browse, no further events). Resolve settles from its own event: not-found is structured `unavailable`, never a hang. Fail-closed: null replies → `unsupported`, throwing bridge → `platform-error`, unknown failure kinds → `platform-error`, malformed events → visible `false`.
3. **Android host** — `DiscoveryService.kt` behind the bridge, with NsdManager at an injectable `NsdFacade` seam (NsdManager lives behind android.jar stubs on the JVM, so the service's own logic is JVM-testable against a scripted facade; production uses the real adapter). A non-reference-counted WifiManager multicast lock is held for the active-browse lifetime (acquired at 0→1, released at 1→0) and that discipline is asserted by a recording fake. Resolve runs through the (deprecated-but-only) `NsdManager.resolveService`; unusable resolved endpoints surface as `platform-error`, never fabricated. `MainActivity` registers `"discovery"` on the same host→JS channel as NET_EVENT; `CHANGE_WIFI_MULTICAST_STATE` added to the manifest.

Evidence so far: `bun run typecheck` clean; `bun test` 833 pass (27 new in `discovery.test.ts`: bounds incl. the 63-byte UTF-8 limit, availability passthrough, browse wire/events, idempotent stop, cancel before/after start, host-side browse stop, resolve outcomes, fail-closed matrix); the JVM tier runs the same semantics against a scripted NSD facade — `DiscoveryServiceFormatTest` OK (10 tests) alongside NetServiceFormatTest (9) and KeysServiceFormatTest (4), with the isolated K2JVMCompiler rehearsal compiling the full curated Kotlin set INCLUDING the androidTest tier. `DiscoveryBridgeTest` ships with this change and drives the compiled public adapter through a real `TenunEngine` → JNI → NsdManager against a service registered through the platform's own advertiser (find → resolve → lose → re-find → idempotent stop, plus a cancelled browse); **the hosted device run is the closing evidence — the issue moves to `closed` when that run is green**, mirroring the TN-188 gate pattern.

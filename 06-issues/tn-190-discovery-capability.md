---
okf_version: 0.2
title: "TN-190: Discovery capability — mDNS/NSD browse and resolve"
summary: "Add the discovery host capability per ADR-0027 and 04-api/discovery.md: event-driven browse of a service type with idempotent stop and cancel signal, resolve to host/port/TXT, service identity by name@domain. Android NsdManager with multicast lock; iOS NWBrowser later; browsers get the unsupported stub by design so apps always keep manual host:port entry."
type: issue
status: closed
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

## Status note (2026-11-12, closed)

Closed on 2026-11-12 with 8/8 green CI on PR #280 (run 43219092648) after addressing independent review findings. Implemented against the frozen contract (`packages/platform/src/discovery.ts`, contractVersion 1, exactly the `04-api/discovery.md` shapes):

1. **Contract + shared bounds** — `discovery.ts` plus `discovery-validation.ts`: `DISCOVERY_PERMISSIONS` with the android `CHANGE_WIFI_MULTICAST_STATE` tier and empty ios/web tiers; `DiscoveredService` identity `serviceName@domain`; service-type shape `_name._tcp|_name._udp` (label ≤ DNS 63-byte ceiling: 62 chars after '_'); raw instance names 1..63 UTF-8 bytes with punctuation/spaces allowed per RFC 6763 §4.1.1; TXT tables bounded (64 entries, 255-byte `key=value` constituent limit per RFC 6763 §6.5); strict boolean `ok` discriminators; preserved `permission` metadata on `denied` availability and failures; `HostCapabilities` gained its SEVENTH member (`discovery`) with `unsupportedDiscovery` fail-closed wiring and TN-145 parity assertions. The browser preview host stays unsupported ON PURPOSE (manual-entry stub by spec).
2. **Native adapter** — `discovery-native.ts` `createHostDiscoveryBridge(hostCall)`: the split wire (synchronous `browse`/`stop`/`resolve` requests + host-pushed `DISCOVERY_EVENT` dispatch actions: `browseStarted`/`serviceFound`/`serviceLost`/`browseStopped`/`resolve`). The browse promise settles at the start outcome; services flow through listeners; `stop()` is idempotent and crosses the wire once; cancelling settles JS-side from the caller's `CapabilityCancelSignal` — including cancelling AFTER start, which silences the live browse (the frozen contract). Resolve settles from its own event: not-found is structured `unavailable`, never a hang. Fail-closed: null replies → `unsupported`, throwing bridge → `platform-error`, unknown failure kinds → `platform-error`, malformed events → visible `false`.
3. **Android host** — `DiscoveryService.kt` behind the bridge, with NsdManager at an injectable `NsdFacade` seam (NsdManager lives behind android.jar stubs on the JVM, so the service's own logic is JVM-testable against a scripted facade; production uses the real adapter). NsdManager listener identity is preserved across browse and stop (`adaptedListeners` map) so `stopServiceDiscovery` targets the registered object. Platform trailing-dot service types are canonicalized (`canonicalServiceType`) so discovered identities round-trip into `resolve()`. Null-valued TXT attributes (key-only entries) are safely decoded as `""` without crashing the NSD callback thread. Resolution enforces a 15s deadline with structured `timeout` settlement, mapping `FAILURE_ALREADY_ACTIVE` to `busy`. Stop before `onDiscoveryStarted` cancels the accepted native request. Multicast lock acquisition is transactional, mapping `SecurityException` to `denied`. `MainActivity` retires and recreates discovery on engine replacement and activity `onDestroy` (`retireDiscovery()`) to prevent orphaned operations.

Evidence: `bun run typecheck` clean; `bun test` 835 pass (29 in `discovery.test.ts`); JVM tier runs 29 tests OK (`DiscoveryServiceFormatTest` 16 tests, `NetServiceFormatTest` 9 tests, `KeysServiceFormatTest` 4 tests). The isolated K2JVMCompiler rehearsal compiles the curated Kotlin set including the androidTest tier against the real `android-34/android.jar`. Device gate `DiscoveryBridgeTest` passed all 57 tests on the hosted emulator in CI run 43219092648.

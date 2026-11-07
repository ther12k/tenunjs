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

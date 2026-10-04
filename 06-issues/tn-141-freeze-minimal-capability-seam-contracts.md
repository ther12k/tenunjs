---
okf_version: 0.2
title: "TN-141: Freeze the minimal capability-seam contracts (ble, storage, camera) ahead of M5"
summary: "Contracts-first re-sequencing input from the VOTOL consumer build: freeze ble/storage/camera seam types (with permissions and degradation states) early even though implementations land in M5."
type: issue
status: ready
issue_id: "TN-141"
milestone: "M5"
priority: "P1"
depends_on:
  - "TN-133"
---

# TN-141 — Freeze the minimal capability-seam contracts (ble, storage, camera) ahead of M5

## Metadata

| Field | Value |
|---|---|
| Milestone | M5 — Platform services, accessibility, and packaging (contract slice requested early) |
| Priority | P1 |
| Dependencies | TN-133 (public execution contract: services context) |
| Suggested size | One contract-definition PR (types + fail-closed semantics + parity stubs) |
| Gate impact | App-survival: an app can ship with ugly widgets, not without BLE |

## Purpose

Gap 2 of the VOTOL consumer feedback
([record](../08-validation/votol-consumer-feedback-2026-10-02.md)).
The first external-consumer app needed on day one: a BLE GATT client
(scan-with-UUID-filter → connect → discover → write + notify + CCC
descriptor), camera barcode scan, key-value storage, clipboard. The
roadmap schedules native capabilities at M5 (TN-097 IDL, TN-099
permissions, TN-100 reference modules) — too late for real apps, and
contracts can't be retrofitted: seams written against a stable contract
survive, apps written against half-built internals get rewritten. This
issue is explicitly NOT "implement M5 early": it freezes the CONTRACT
slice a companion app binds to, leaving implementations where the
roadmap has them.

## Required outcome

- A versioned, minimal platform capability contract owned by a public
  package, covering `ble` (GATT client surface above), `storage`
  (key-value), `camera` (barcode/scan): method shapes, event/push
  shapes, error taxonomy, and cancellation — aligned with TN-097's IDL
  vocabulary so M5 implements rather than replaces it.
- Permissions are part of the contract: Android S+
  `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`, legacy location, camera — each
  capability declares its permission prerequisites and degradation
  states (denied / unavailable / unsupported), because app authors get
  this wrong every time it is left to them.
- Fail-closed semantics: an app calling an unimplemented capability in a
  host gets a structured "unsupported" result, never a silent no-op or
  crash. (The host-parity side of that guarantee is TN-145.)

## References

- [VOTOL consumer feedback, gap 2](../08-validation/votol-consumer-feedback-2026-10-02.md)
- `examples/votol/src/runtime.ts` (the seam shape a real consumer chose)
- TN-097, TN-099, TN-100 (M5 implementation owners)

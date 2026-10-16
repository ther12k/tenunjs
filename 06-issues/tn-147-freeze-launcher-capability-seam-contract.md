---
okf_version: 0.2
title: "TN-147: Freeze the launcher capability seam contract"
summary: "A launcher-shaped application needs to enumerate the device's launchable apps and start one; freeze that seam as a fourth TN-141-style capability contract (listApps/launch) before any host implementation exists."
type: issue
status: closed
issue_id: "TN-147"
milestone: "M5"
priority: "P1"
depends_on:
  - "TN-141"
---

# TN-147 — Freeze the launcher capability seam contract

## Metadata

| Field | Value |
|---|---|
| Milestone | M5 — Platform capability modules |
| Priority | P1 |
| Dependencies | TN-141 (capability seam contracts: RESULT-shape, degradation states, permission tables) |
| Suggested size | One contract PR (platform package only) |
| Gate impact | Blocks any launcher sample/app; the first non-companion capability domain |

## Purpose

The launcher feasibility review (2026-10-16, conversation record) named
the missing seams a TenunJS launcher needs. The highest-value, smallest
one is not a widget or a host feature — it is the capability vocabulary:
enumerate launchable apps, start one by id. TN-141 froze ble/storage/
camera with the contracts-first policy (shape before implementation,
because seams written against a stable contract survive while apps
written against half-built internals get rewritten); this extends the
same policy to the launcher domain before the Android PackageManager
binding or any sample exists.

Layout is explicitly NOT part of this contract: the display-list
`Wrap` widget already renders an app drawer (flow layout), and icon
policy is v1-unicode (`iconGlyph`), because the scene has text, not
bitmaps. `appId` stays the stable key a future image/icon widget kind
resolves against — the contract does not promise pixels.

## Required outcome

- `@tenunjs/platform` grows `LauncherCapability` (contractVersion 1):
  `listApps(options?)` returning launcher app entries (appId, label,
  iconGlyph) and `launch(appId, options?)`, both RESULT-shaped — never
  throwing across the seam, mapping onto the frozen failure alphabet
  (invalid-argument for an empty appId, cancelled for an aborted
  listApps, unsupported on hosts without app enumeration).
- The permission table declares the maximum manifest-level grant:
  `QUERY_ALL_PACKAGES` on Android (Play-permitted for launcher-role
  apps; hosts may ship a targeted `<queries>` block instead and
  document which), none on iOS/web.
- `HostCapabilities` stays TOTAL: the aggregate gains `launcher` with
  an `unsupportedLauncher` stub wired into `defineHostCapabilities`, so
  existing host compositions stay source-compatible and every
  capability remains callable fail-closed.
- Contract-freeze tests follow the TN-141 triples: fail-closed stubs,
  QuickJS-safe cancellation (listApps honors the signal with
  AbortController deleted from the realm), frozen vocabulary (the
  permission table pinned).

## References

- [TN-141 — capability seam contracts](tn-141-freeze-minimal-capability-seam-contracts.md)
- `packages/platform/src/launcher.ts` (the contract)
- `packages/platform/src/host.ts` (aggregate + stub)
- Android app-visibility policy: package visibility on API 30+;
  QUERY_ALL_PACKAGES is the broad grant, `<queries>` the targeted one

## Status note (2026-10-16, closed)

Closed via PR #228: contract landed in `@tenunjs/platform`: `launcher.ts` freezes
`LauncherCapability` (listApps/launch, RESULT-shaped, cancel-safe) with
`LAUNCHER_PERMISSIONS` declaring the broad Android visibility grant;
`host.ts` grows the TOTAL `launcher` member and `unsupportedLauncher`
stub behind `defineHostCapabilities`; exports and contract-freeze tests
(fail-closed, cancellation, frozen vocabulary) in
`packages/platform/test/platform.test.ts`. No host implementation yet —
M5 modules bind PackageManager against this shape.

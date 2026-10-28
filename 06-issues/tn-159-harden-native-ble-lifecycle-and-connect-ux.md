---
okf_version: 0.2
title: "TN-159: Harden native BLE lifecycle and connect UX"
summary: "Land the native-side follow-ups from the 2026-10-27 framework review: per-session BLE teardown, STOP latch with retry, stale-callback guards, watchdogs, MTU negotiation, permission flow, and the runtime-routed program editor."
type: issue
status: closed
issue_id: "TN-159"
milestone: "M1"
priority: "P0"
depends_on:
  - "TN-154"
---

# TN-159 — Harden native BLE lifecycle and connect UX

## Metadata

| Field | Value |
|---|---|
| Milestone | M1 — Executable toolchain and mobile embedders |
| Priority | P0 |
| Dependencies | TN-154 (native Polytron milestone app, closed) |
| Suggested size | One hardening wave over the native companion path |
| Gate impact | Closes the safety-critical findings from the 2026-10-27 review on the native side |

## Purpose

The 2026-10-27 framework review proved, with production-source probes,
that the shipped BLE service could stall writes after a reconnect race,
drop a failed STOP, and let stale callbacks corrupt a newer session —
and that native program editing bypassed the runtime's send path. This
issue lands the native fixes.

## Required outcome

1. **Per-session teardown** — queue, in-flight write state, and
   characteristic references reset on every connect so nothing leaks
   across a disconnect/reconnect.
2. **STOP latch** — an emergency stop survives an unexpected link drop
   and is retried on submission failure until its write is confirmed;
   explicit connect/disconnect clear the latch (fresh session, fresh
   intent).
3. **Stale-callback guards** (`g !== gatt`), bounded write/connect
   watchdogs, and scan-expiry reporting instead of a silent hang.
4. **MTU 517 negotiation** so whole status lines arrive in one
   notification.
5. **Permission flow** — launch-time request, parked-connect
   auto-resume on grant, permanent-denial guidance, Bluetooth-on radio
   receiver.
6. **Runtime-routed editing** — native dialog saves flow through the
   runtime's SAVE_PROGRAM send path (optimistic cache, pending-ack,
   failure feedback), never a direct BLE write.
7. Launcher branding (Polytron Wash), version 0.1.6, and update-server
   assets.

## Verification

531/0 bun tests (expanded Polytron suite + new polytron-entry tests),
typecheck, manifest validation, and the full Android gate — engine loops
including framework-feel QuickJS parity, APK assembly with the new
branding, and dual-ABI NDK builds — all run in the publishing session
before the merge; all eight CI jobs green on the PR and on main,
including the installed-device gate against the rebranded app.

## Status note (2026-10-29, closed)

Closed via the same PR that introduced the issue: the work was prepared
in a parallel session (verified stale but complete in the shared
checkout), re-verified end-to-end in the publishing session, and merged
with full green CI. deploy.sh stays uncommitted deliberately: it carries
operator infrastructure (SSH key path, internal address) unsuitable for
a public repository.

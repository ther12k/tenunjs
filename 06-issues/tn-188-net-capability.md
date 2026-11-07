---
okf_version: 0.2
title: "TN-188: Net capability — TCP and TLS sessions with client-certificate pairing"
summary: "Add the net host capability per ADR-0027 and 04-api/net.md: connect() to host:port, optional TLS using a keys identity as client certificate, pinned or first-use-accepted server identity, Uint8Array writes, pushed data and tri-state link events, idempotent close. Android implementation behind the existing JNI host-service bridge; a loopback WebSocket proxy shim for the browser preview; fail-closed stub wired through defineHostCapabilities."
type: issue
status: ready
issue_id: "TN-188"
priority: "P1"
depends_on:
  - "TN-141"
  - "TN-189"
---

# TN-188 — Net capability

## Purpose

Companion-device apps converse with one nearby device over a persistent
connection. The Android TV Remote v2 driver needs a TLS session the
phone authenticates with a generated client certificate; today the
platform has no socket seam at all (review 2026-11-07, gap G1).

## Required outcome

1. `packages/platform/src/net.ts` implementing the contract in
   `04-api/net.md` exactly (result types, `contractVersion: 1`,
   tri-state link, idempotent close/unsubscribe, `onServerCertificate`
   in first-use mode).
2. Android host service on the existing bridge: `Socket`/`SSLSocket`
   transport, client key used in place via the TN-189 Keystore side,
   link-state and data events marshalled to the runtime.
3. Browser preview shim (WebSocket↔TCP loopback proxy) plus an
   in-memory fake endpoint for headless tests.
4. `unsupportedNet` stub and `defineHostCapabilities` wiring; TN-145
   parity surface updated.

## Verification

- Headless contract tests against a local echo/fixture server: connect,
  write/receive round-trip, first-use fingerprint delivered, pin
   enforcement on a second connect, link-lost on remote close, double
  close is a no-op, cancelled signal aborts connect.
- Android device gate: the same suite over the real bridge.

## Out of scope

- UDP, sockets beyond a single session per call, SOCKS proxies.
- Background survival (ADR-0027 v1: foreground-scoped).

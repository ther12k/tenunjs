---
okf_version: 0.2
title: "TN-189: Keys capability — Keystore-held device identities"
summary: "Add the keys host capability per ADR-0027 and 04-api/keys.md: generateIdentity (EC P-256 + self-signed cert in Android Keystore), sign in place, exportCertificatePem, removeIdentity. Private key material never enters JS; handles are opaque; duplicate alias fails loudly. Preview shim is an in-memory keyring. No manifest permissions."
type: issue
status: ready
issue_id: "TN-189"
priority: "P1"
depends_on:
  - "TN-141"
---

# TN-189 — Keys capability

## Purpose

Pairing needs the phone to prove a stable identity. Private keys must
not sit in app storage or transit through the runtime (review
2026-11-07, gap G2): only the OS keystore can hold them, and the seam
must make exporting them impossible rather than discouraged.

## Required outcome

1. `packages/platform/src/keys.ts` per `04-api/keys.md` — no export,
   import, or raw-key operation exists anywhere in the contract.
2. Android host side: AndroidKeyStore EC P-256, self-signed
   certificate, in-place signing; the marshalled value is never the
   key.
3. Preview shim: WebCrypto in-memory keyring, plainly labelled as not
   a secure store.
4. `unsupportedKeys` stub, `defineHostCapabilities` wiring, TN-145
   parity update.

## Verification

- Headless tests: generate → sign → verify (with the exported cert),
  PEM export round-trips, duplicate alias is invalid-argument, remove
  then sign is not-found, nothing key-shaped ever appears in a result.
  The signature is asserted to be exactly 64 raw `r || s` bytes for
  P-256 on every host, verified against the exported certificate.
- Android device gate: identity survives process restart; Keystore
   attestation that the key is non-exportable where the device supports
  it.

## Out of scope

- Hardware attestation APIs exposed to apps, key rotation UI,
  certificates signed by a CA (self-signed only at v1).

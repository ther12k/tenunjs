---
okf_version: 0.2
title: "TN-189: Keys capability — Keystore-held device identities"
summary: "Add the keys host capability per ADR-0027 and 04-api/keys.md: generateIdentity (EC P-256 + self-signed cert in Android Keystore), sign in place, exportCertificatePem, removeIdentity. Private key material never enters JS; handles are opaque; duplicate alias fails loudly. Preview shim is an in-memory keyring. No manifest permissions."
type: issue
status: closed
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

## Status note (2026-11-07, closed)

Closed in [PR #278](https://github.com/ther12k/tenunjs/pull/278) (commits `d83b801`, `791ff7a`). Changed files: `packages/platform/src/keys.ts` (contract), `packages/platform/src/keys-preview.ts` (preview WebCrypto keyring + minimal X.509 v3 self-signed encoder + DER↔raw converters), `packages/platform/src/host.ts` + `src/index.ts` (fifth `HostCapabilities` member, `unsupportedKeys`, wiring, exports), `packages/platform/test/keys.test.ts` (+15) and `platform.test.ts` (aggregate totals), `embedders/android/.../KeysService.kt` (AndroidKeyStore host service + `DerSignature`), `MainActivity.kt` (`"keys"` registration), `KeysServiceFormatTest.kt` (JVM, 4), `KeysHostServiceTest.kt` (androidTest, 9).

Evidence: locally `bun run typecheck` clean and `bun test` 737 pass/0 fail (platform package 35, including exactly-64-byte raw `r||s` signatures verified against the exported certificate's SPKI, loud duplicate alias, idempotent remove, nothing-key-shaped); isolated K2JVMCompiler compile + `KeysServiceFormatTest` 4/4 on JVM with the same DER↔raw vectors as the TS suite. Hosted on head `791ff7a`: all 8 checks green; the API 30 emulator device gate ran the full androidTest suite — 41 tests, 0 failures, 0 skipped — including all 9 `KeysHostServiceTest` cases over the real (software-backed) AndroidKeyStore: parseable self-signed certificate, 64-byte signature verified with the certificate's public key, duplicate/unknown-handle/removal semantics, malformed payloads fail visibly, fresh-service + fresh-KeyStore persistence.

Findings recorded: WebCrypto ECDSA output is NOT uniform (Bun returns raw `r||s`, browsers/Node DER) — both the shim and any future host adapter must normalize to the pinned raw format (`ecdsaSignatureToRaw/ToDer`); the preview keyring is the first shipped implementation inside the contracts-only platform package (recorded in the package description and file header). Residuals, deliberately deferred: the JS-side capability adapter over `tenun_host_call` lands with TN-191's app binding (the wire protocol it wraps is frozen and tested here); a literal process-kill restart journey belongs to TN-191's device script (fresh-service + fresh-KeyStore-load semantics are asserted now, which is what a restarted process reads); hardware key attestation is unasserted because the emulator keystore is software-backed — the issue requires it only where the device supports it. Follow-ups: TN-188 (net, needs `KeyHandle`), TN-191, TN-192.

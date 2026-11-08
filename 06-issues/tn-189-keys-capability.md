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

## Status note (2026-11-08, closed after review round 2)

Closed in [PR #278](https://github.com/ther12k/tenunjs/pull/278). Round 1 (2026-11-07, heads `d83b801`/`791ff7a`/`8d0c6cc`) shipped the contract, preview keyring, Android service, and tests — all checks green — but the 2026-11-08 adversarial review (two independent read-only audits with deterministic probes) found real defects and evidence overclaims, all fixed in round 2 on this branch:

**Preview tier (all reproduced deterministically, then fixed):** both X.509 AlgorithmIdentifier fields held a bare OID where RFC 5280 requires SEQUENCE{OID} (Node/OpenSSL rejected the certificate); a valid raw signature beginning 0x30 was misclassified as DER (valid signature became platform-error, and raw bytes were embedded in the cert's DER signature field); two concurrent `generateIdentity` calls for one alias both succeeded and the second silently replaced the first; the DER parser accepted wrong lengths, trailing bytes, negative and redundantly-padded INTEGERs; `availability()` advertised `supported` on hosts with no WebCrypto; the wrong-message test combined checks with `&&` so acceptance could hide. Round 2: canonical AlgorithmIdentifiers, raw-only WebCrypto handling (see corrected fact below), synchronous alias reservation so duplicates fail exactly one caller with no replacement and no resurrection after concurrent removal, canonical-integer DER parsing, honest `unavailable` availability, and tests that independently parse/verify the certificate via node:crypto's OpenSSL-backed `X509Certificate` (including self-signature) instead of trusting the encoder.

**Corrected fact (round 1 recorded it wrongly):** compliant WebCrypto — Bun, Node, and per spec the browsers — returns the **raw IEEE P1363 `r||s`** from `sign()`. There is no Bun-vs-browsers split; **Java `Signature.sign()` is the only DER producer** in play, and the Android host converts DER to raw. The shim now treats WebCrypto output as raw (asserting 64 bytes) and DER-encodes only where X.509 requires it.

**Android host (all reproduced against an explicit provider model, then fixed):** caller handles addressed AndroidKeyStore aliases verbatim, so `removeIdentity` could delete unrelated app-UID keys (P1) — handles now map injectively into a service-owned `tenun.keys.v1.<sha256>` namespace that is the only thing read, created, or deleted; duplicate generation was not atomic (Android Keystore rebinds aliases) — a process-wide lock plus `getKey`-based fail-closed existence (backend failures propagate instead of masquerading as absence, which `containsAlias` cannot promise) makes duplicates loud; `optString` coerced JSON numbers/booleans into operations (`data:true` signed the bytes of the string "true") — strict string typing everywhere; valid empty payloads were rejected; failed enrollment left an occupied alias — generation now rolls back. Tests gained namespace/foreign-handle impotence, concurrent-duplicate, strict-typing, empty/oversized payload, alias-bounds, and availability coverage, plus full self-signature and P-256 curve verification.

**Native seam completed (was deferred in round 1):** `packages/platform/src/keys-native.ts` exports `createHostKeysCapability(hostCall)` — a dependency-free QuickJS-safe adapter (own base64, no `btoa`/`atob`/`Buffer`) over `tenun_host_call("keys", …)` with strict envelope/failure-alphabet validation; headless tests pin the wire behavior and Web-API independence. `KeysBridgeTest` drives the **compiled public adapter** through a real `TenunEngine` (QuickJS -> JNI -> AndroidKeyStore): metadata, generate/export/sign/remove, every-byte-value and empty challenges, duplicate-not-replace, structured failures, nothing-key-shaped — verified with independent JCA code (not the production converters).

**Literal process-restart evidence (was overclaimed in round 1):** `KeysProcessPersistenceTest` runs as two separate `am instrument` invocations in `run_device_acceptance.sh` stage 7b (excluded from the standard suite), with `am force-stop` and an asserted-empty `pidof` before each phase and no uninstall/clear between: seed writes a public witness (handle, certificate, PID) through the real bridge; `verifyAfterRestart` asserts a distinct PID, exports the byte-identical certificate, and signs a fresh SecureRandom challenge with the saved handle without regenerating. Focused run on the API 30 emulator (2026-11-08): seed OK (PID 4265), verifyAfterRestart OK (PID 4316), CheckJNI late-enabled on all three target processes with no JNI aborts.

Evidence: locally `bun run typecheck` clean, `bun test` green (755 pass at the round-2 head; platform package: contract freeze, preview behavior on real crypto, canonical DER vectors shared byte-for-byte with the Kotlin `KeysServiceFormatTest`, adapter wire tests); isolated K2JVMCompiler compile of all keys Kotlin sources + format tests 4/4; focused emulator runs above. Hosted full-suite results for the pushed head are on the PR's checks, including the complete device-acceptance runner with stage 7b.

Residuals, still open and not silently dropped: hardware key attestation (the emulator keystore is software-backed; the issue requires it only where the device supports it) and physical-device acceptance (ADR-0019) — the process gate and bridge test run on the emulator device gate, not a physical set. `MainActivity` registers `"keys"` for production engines; no application bundle binds the capability yet (TN-191 will). Follow-ups: TN-188 (net, consumes `KeyHandle`), TN-191, TN-192.

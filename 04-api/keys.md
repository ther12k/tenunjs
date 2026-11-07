---
okf_version: 0.2
title: "Keys capability — device identities held by the OS keystore"
summary: "Keystore-backed identity for companion pairing: generate a key pair plus self-signed certificate, sign challenge bytes, export the certificate PEM. Private key material never enters JavaScript; handles are opaque aliases. No manifest permissions on any tier."
type: reference
status: accepted
---

# Keys capability

```ts
import type { CapabilityAvailability, CapabilityResult } from "./capability";

export const KEYS_PERMISSIONS: readonly PermissionPrerequisite[] = [];

/** Opaque host alias. Not a path, not a key — never parse it. */
export type KeyHandle = string;

export interface KeyIdentity {
  handle: KeyHandle;
  /** PEM of the self-signed certificate, for display and pairing enrolment. */
  certificatePem: string;
}

export interface KeysCapability {
  readonly contractVersion: 1;
  availability(): CapabilityAvailability;
  permissionPrerequisites(): readonly PermissionPrerequisite[];
  generateIdentity(alias: string): Promise<CapabilityResult<KeyIdentity>>;
  sign(handle: KeyHandle, data: Uint8Array): Promise<CapabilityResult<Uint8Array>>;
  exportCertificatePem(handle: KeyHandle): Promise<CapabilityResult<string>>;
  removeIdentity(handle: KeyHandle): Promise<CapabilityResult<void>>;
}
```

## Semantics

- **Key material never crosses the seam.** The host generates the pair
  inside Android Keystore / iOS keychain / a preview keyring and
  returns only a handle and the certificate. There is deliberately no
  export, import, or raw-key operation; adding one is a contract break.
- **`sign` is the only use of the private key**, and the host performs
  it in place. The signature algorithm follows the generated key
  (ECDSA P-256 unless a host documents otherwise) and is returned raw;
  DER-wrapping is application policy.
- **`alias` is caller-chosen and stable**: regenerating with an existing
  alias is an invalid-argument failure, not a silent replace —
  identities in a pairing flow are precious and mistakes should be loud.
- **Server-trust pins are NOT keys.** A pin (SHA-256 of a peer
  certificate accepted during first-use pairing) is an ordinary value
  and belongs in `storage`; this capability holds only the phone's own
  identity. Keeping the two apart is what makes "never in JS" mean
  something.
- **Never throws**; missing or removed handles are structured
  not-found failures.

## Host implementations

- **Android**: AndroidKeyStore (`AndroidKeyStore` provider, EC P-256,
  self-signed cert via `KeyPairGenerator`); sign via the Keystore's
  in-place signing — the private key is non-exportable at the hardware
  policy level.
- **iOS**: keychain + Secure Enclave where available.
- **Browser preview**: an in-memory keyring (WebCrypto) that survives
  per preview session — enough for authoring and headless tests; the
  shim states plainly that it is not a secure store.

Specified by ADR-0027; implemented by TN-189.

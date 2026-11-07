/**
 * Keys capability contract — device identities held by the OS keystore
 * (TN-189, specified by ADR-0027 and 04-api/keys.md).
 *
 * Companion pairing needs the phone to prove a stable identity without
 * private key material ever entering the runtime: the host generates the
 * pair inside its keystore (AndroidKeyStore / iOS keychain / the preview
 * keyring) and hands JS only an opaque handle plus the self-signed
 * certificate. There is deliberately no export, import, or raw-key
 * operation anywhere in the contract — adding one is a contract break.
 *
 * Semantics frozen with contractVersion 1:
 *  - never throws: every operation resolves to a CapabilityResult;
 *  - `alias` is caller-chosen and stable; generating over an existing
 *    alias is invalid-argument (loud, never a silent replace);
 *  - a missing or removed handle is invalid-argument — the frozen
 *    failure alphabet has no not-found kind, and the handle IS the
 *    argument being rejected;
 *  - `sign` returns the fixed-width raw concatenation r||s: for the
 *    ECDSA P-256 default, 32 bytes each, big-endian, 64 bytes total.
 *    DER providers (Java Signature, WebCrypto) convert before
 *    returning; DER or protocol wrapping on top is application policy;
 *  - server-trust pins are NOT keys: a first-use peer-cert pin is an
 *    ordinary value and belongs in `storage` — keeping the two apart is
 *    what makes "never in JS" mean something.
 *
 * Declares no manifest permissions on any tier: the keystore is
 * app-scoped. The empty table is stated explicitly so permission tables
 * stay total.
 */
import type {
  CapabilityAvailability,
  CapabilityResult,
  PermissionPrerequisite,
} from "./capability";

export const KEYS_PERMISSIONS: readonly PermissionPrerequisite[] = [];

/** Opaque host alias. Not a path, not a key — never parse it. */
export type KeyHandle = string;

export interface KeyIdentity {
  readonly handle: KeyHandle;
  /** PEM of the self-signed certificate, for display and pairing enrolment. */
  readonly certificatePem: string;
}

export interface KeysCapability {
  readonly contractVersion: 1;
  availability(): CapabilityAvailability;
  permissionPrerequisites(): readonly PermissionPrerequisite[];
  /**
   * Generates a key pair inside the host keystore under `alias`. An
   * existing alias fails invalid-argument; key material never crosses
   * the seam — only the handle and the certificate come back.
   */
  generateIdentity(alias: string): Promise<CapabilityResult<KeyIdentity>>;
  /**
   * Signs `data` in place with the identity's private key. Returns the
   * raw r||s concatenation (64 bytes for P-256); the hash is SHA-256
   * unless a host documents its generated key otherwise.
   */
  sign(handle: KeyHandle, data: Uint8Array): Promise<CapabilityResult<Uint8Array>>;
  exportCertificatePem(handle: KeyHandle): Promise<CapabilityResult<string>>;
  removeIdentity(handle: KeyHandle): Promise<CapabilityResult<void>>;
}

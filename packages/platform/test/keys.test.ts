import { describe, expect, test } from "bun:test";
import {
  KEYS_PERMISSIONS,
  defineHostCapabilities,
  previewKeyring,
  unsupportedKeys,
  type HostCapabilities,
} from "../src/index";
import { ecdsaDerToRaw, ecdsaRawToDer } from "../src/keys-preview";

/**
 * TN-189 keys capability: the preview keyring is the reference behavior
 * for the contract — every semantic 04-api/keys.md freezes is asserted
 * here against a REAL crypto stack (WebCrypto), not a mock, because the
 * same assertions run on the AndroidKeyStore tier over the JNI bridge.
 * The signature wire format (raw r||s, 64 bytes) is the pinned parity
 * point between the two tiers and gets its own suite with the same
 * vectors the Kotlin format tests use.
 */

const ALICE = "pairing.tv.alice";

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) der[i] = binary.charCodeAt(i);
  return der;
}

/** Minimal reader sufficient for certs this repo mints (definite lengths). */
function readTlv(
  der: Uint8Array,
  at: number
): { tag: number; full: Uint8Array; content: Uint8Array; next: number } | null {
  if (at + 2 > der.length) return null;
  const tag = der[at]!;
  const lenByte = der[at + 1]!;
  let header = 2;
  let len = lenByte;
  if (lenByte >= 0x80) {
    const n = lenByte & 0x7f;
    if (n === 0 || n > 2 || at + 2 + n > der.length) return null; // no indefinite/huge forms
    len = 0;
    for (let i = 0; i < n; i += 1) len = len * 256 + der[at + 2 + i]!;
    header = 2 + n;
  }
  if (at + header + len > der.length) return null;
  return {
    tag,
    full: der.slice(at, at + header + len),
    content: der.slice(at + header, at + header + len),
    next: at + header + len,
  };
}

/** The SubjectPublicKeyInfo is the LAST TBS element (no extensions). */
function spkiFromCert(certDer: Uint8Array): Uint8Array | null {
  const cert = readTlv(certDer, 0);
  if (!cert || cert.tag !== 0x30) return null;
  const tbs = readTlv(cert.content, 0);
  if (!tbs || tbs.tag !== 0x30) return null;
  let at = 0;
  let last: Uint8Array | null = null;
  for (;;) {
    const el = readTlv(tbs.content, at);
    if (!el) break;
    last = el.full;
    at = el.next;
  }
  return last;
}

describe("TN-189 preview keyring (the contract, on real crypto)", () => {
  test("generate → real PEM self-signed certificate; handle is the alias", async () => {
    const keys = previewKeyring();
    const result = await keys.generateIdentity(ALICE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handle).toBe(ALICE);
    expect(result.value.certificatePem.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(result.value.certificatePem.endsWith("-----END CERTIFICATE-----\n")).toBe(true);
    // The PEM body must be exactly the X.509 DER (round-trips, parses).
    const der = pemToDer(result.value.certificatePem);
    expect(der.length).toBeGreaterThan(100);
    expect(der[0]).toBe(0x30);
  });

  test("sign returns exactly 64 raw r||s bytes, verifiable with the certificate's public key", async () => {
    const keys = previewKeyring();
    const identity = await keys.generateIdentity(ALICE);
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;

    const data = new TextEncoder().encode("tenun pairing challenge");
    const signed = await keys.sign(ALICE, data);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.value).toBeInstanceOf(Uint8Array);
    expect(signed.value.length).toBe(64); // THE pinned parity point

    // Verify against the cert's SPKI — proves the raw bytes really are
    // r||s of a SHA-256 ECDSA signature over `data`. WebCrypto variants
    // also disagree on VERIFY input (Bun wants raw, browsers DER), so
    // accept either representation matching the key.
    const signature = new Uint8Array(signed.value); // ArrayBuffer-backed for WebCrypto
    const derSig = ecdsaRawToDer(signature);
    expect(derSig).not.toBeNull();
    const spki = spkiFromCert(pemToDer(identity.value.certificatePem));
    expect(spki).not.toBeNull();
    const publicKey = await crypto.subtle.importKey(
      "spki",
      new Uint8Array(spki!),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );
    const verified =
      (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, data)) ||
      (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, new Uint8Array(derSig!), data));
    expect(verified).toBe(true);

    // Different data must NOT verify with the same signature.
    const wrongData = new TextEncoder().encode("not the challenge");
    const rejected =
      (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, wrongData)) &&
      (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, new Uint8Array(derSig!), wrongData));
    expect(rejected).toBe(false);
  });

  test("duplicate alias is a loud invalid-argument; the original identity survives", async () => {
    const keys = previewKeyring();
    await keys.generateIdentity(ALICE);
    const dup = await keys.generateIdentity(ALICE);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.failure.kind).toBe("invalid-argument");

    const stillSigns = await keys.sign(ALICE, new Uint8Array([1, 2, 3]));
    expect(stillSigns.ok).toBe(true);
  });

  test("empty alias is invalid-argument", async () => {
    const keys = previewKeyring();
    const result = await keys.generateIdentity("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("invalid-argument");
  });

  test("exportCertificatePem round-trips; unknown handle is invalid-argument", async () => {
    const keys = previewKeyring();
    const identity = await keys.generateIdentity(ALICE);
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    const again = await keys.exportCertificatePem(ALICE);
    expect(again).toEqual({ ok: true, value: identity.value.certificatePem });

    const missing = await keys.exportCertificatePem("no.such.identity");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.failure.kind).toBe("invalid-argument");
  });

  test("remove is idempotent; afterwards sign/export are not-found invalid-arguments", async () => {
    const keys = previewKeyring();
    await keys.generateIdentity(ALICE);
    expect(await keys.removeIdentity(ALICE)).toEqual({ ok: true, value: undefined });
    expect(await keys.removeIdentity(ALICE)).toEqual({ ok: true, value: undefined }); // idempotent

    const signed = await keys.sign(ALICE, new Uint8Array([9]));
    expect(signed.ok).toBe(false);
    if (!signed.ok) expect(signed.failure.kind).toBe("invalid-argument");

    const exported = await keys.exportCertificatePem(ALICE);
    expect(exported.ok).toBe(false);
    if (!exported.ok) expect(exported.failure.kind).toBe("invalid-argument");
  });

  test("nothing key-shaped ever crosses the seam", async () => {
    const keys = previewKeyring();
    const identity = await keys.generateIdentity(ALICE);
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    const signed = await keys.sign(ALICE, new Uint8Array([1]));
    expect(signed.ok).toBe(true);
    expect(JSON.stringify(identity)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(signed)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(keys)).not.toContain("PRIVATE KEY");
  });

  test("the keyring labels itself as not a secure store", () => {
    expect(previewKeyring().notASecureStore).toBe(true);
    expect(previewKeyring().availability()).toEqual({ status: "supported" });
    expect(previewKeyring().permissionPrerequisites()).toEqual([]);
  });
});

describe("TN-189 frozen signature wire format (DER ↔ raw r||s)", () => {
  // The same vectors the Kotlin format tests (KeysServiceFormatTest) use.
  const pad = (tail: number[]): Uint8Array =>
    new Uint8Array([...new Array(32 - tail.length).fill(0), ...tail]);

  test("minimal integers: r=…01, s=…02 round-trip canonically", () => {
    const raw = new Uint8Array([...pad([0x01]), ...pad([0x02])]);
    const der = ecdsaRawToDer(raw);
    expect(der).not.toBeNull();
    expect(ecdsaDerToRaw(der!)).toEqual(raw);
  });

  test("high-bit integers gain a DER sign byte; extraction strips it", () => {
    const raw = new Uint8Array([
      ...new Array(32).fill(0xff), // r: MSB set → DER INTEGER gets 0x00 prefix
      ...pad([0x01]),
    ]);
    const der = ecdsaRawToDer(raw);
    expect(der).not.toBeNull();
    expect(der![2]).toBe(0x02); // first INTEGER
    expect(der![3]).toBe(33); // 32 bytes + sign byte
    expect(ecdsaDerToRaw(der!)).toEqual(raw);
  });

  test("zero integers stay valid (single zero byte in DER)", () => {
    const raw = new Uint8Array(64); // r = s = 0
    const der = ecdsaRawToDer(raw);
    expect(der).not.toBeNull();
    expect(der![3]).toBe(1); // INTEGER length 1, content 0x00
    expect(ecdsaDerToRaw(der!)).toEqual(raw);
  });

  test("malformed DER is refused, never guessed", () => {
    expect(ecdsaDerToRaw(new Uint8Array(0))).toBeNull();
    expect(ecdsaDerToRaw(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01]))).toBeNull(); // truncated s
    expect(ecdsaDerToRaw(new Uint8Array([0x31, 0x00]))).toBeNull(); // not a SEQUENCE
    expect(ecdsaDerToRaw(new Uint8Array([0x30, 0x81, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toBeNull(); // long-form length
    const oversized = new Uint8Array([0x30, 0x24, 0x02, 0x21, ...new Array(33).fill(0x01)]);
    expect(ecdsaDerToRaw(oversized)).toBeNull(); // integer wider than the field
    expect(ecdsaRawToDer(new Uint8Array(63))).toBeNull(); // wrong raw length
  });
});

describe("TN-189 fail-closed wiring", () => {
  const host: HostCapabilities = defineHostCapabilities({}, "test host: nothing bound");

  test("the aggregate grows to include keys, callable and unsupported", async () => {
    expect(host.keys).toBeDefined();
    for (const result of [
      await host.keys.generateIdentity("x"),
      await host.keys.sign("x", new Uint8Array([1])),
      await host.keys.exportCertificatePem("x"),
      await host.keys.removeIdentity("x"),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("unsupported");
    }
    expect(host.keys.permissionPrerequisites()).toBe(KEYS_PERMISSIONS);
  });

  test("the stub carries the host's reason; the permission table stays total and empty", () => {
    expect(unsupportedKeys("no keystore").availability()).toEqual({
      status: "unsupported",
      reason: "no keystore",
    });
    expect(KEYS_PERMISSIONS).toEqual([]);
  });

  test("an implemented keyring passes through the aggregate untouched", async () => {
    const keys = previewKeyring();
    const hostWithKeys = defineHostCapabilities({ keys });
    expect(hostWithKeys.keys).toBe(keys);
    expect((await hostWithKeys.keys.generateIdentity("agg")).ok).toBe(true);
  });
});

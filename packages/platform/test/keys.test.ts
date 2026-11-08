import { describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import {
  KEYS_PERMISSIONS,
  defineHostCapabilities,
  previewKeyring,
  unsupportedKeys,
  type HostCapabilities,
} from "../src/index";
import { ecdsaDerToRaw, ecdsaRawToDer } from "../src/keys-preview";
import { validKeyAlias, validKeyData } from "../src/keys-validation";

/**
 * TN-189 keys capability: the preview keyring is the reference behavior
 * for the contract — every semantic 04-api/keys.md freezes is asserted
 * here against a REAL crypto stack (WebCrypto) and INDEPENDENT X.509
 * tooling (node:crypto's OpenSSL-backed X509Certificate), not the
 * encoder's own assumptions, because the same properties run on the
 * AndroidKeyStore tier over the JNI bridge. The signature wire format
 * (raw r||s, 64 bytes) is the pinned parity point between the tiers and
 * gets its own suite with the same vectors the Kotlin format tests use.
 */

const ALICE = "pairing.tv.alice";

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) der[i] = binary.charCodeAt(i);
  return der;
}

/** Minimal reader for certs this repo mints (definite lengths, ≤2 length bytes). */
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
    if (n === 0 || n > 2 || at + 2 + n > der.length) return null;
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

/** ecdsa-with-SHA256 AlgorithmIdentifier = SEQUENCE { OID 1.2.840.10045.4.3.2 }. */
const EXPECTED_SIG_ALG = new Uint8Array([0x30, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);

function expectValidCertificate(pem: string, alias: string): X509Certificate {
  // INDEPENDENT parse: OpenSSL (via node:crypto) must accept the DER the
  // encoder produced — this is what failed on the review head, where both
  // AlgorithmIdentifier fields held a bare OID and OpenSSL rejected it.
  const x509 = new X509Certificate(pem);
  expect(x509.subject.split("\n").some((l) => l === `CN=${alias}`)).toBe(true);
  expect(x509.issuer).toEqual(x509.subject); // self-signed
  expect(x509.publicKey.asymmetricKeyType).toBe("ec");
  // The self-signature must verify with the certificate's own key.
  expect(x509.verify(x509.publicKey)).toBe(true);
  // Structural pin: BOTH AlgorithmIdentifier fields are the RFC 5280
  // SEQUENCE{OID} shape, not a bare OID.
  const der = pemToDer(pem);
  const cert = readTlv(der, 0)!;
  const tbs = readTlv(cert.content, 0)!;
  const children: Uint8Array[] = [];
  let at = 0;
  for (;;) {
    const el = readTlv(tbs.content, at);
    if (!el) break;
    children.push(el.full);
    at = el.next;
  }
  expect(Array.from(children[2]!)).toEqual(Array.from(EXPECTED_SIG_ALG)); // TBS sigAlg
  const outer = readTlv(cert.content, tbs.next)!; // outer sigAlg, before BITSTRING
  expect(Array.from(outer.full)).toEqual(Array.from(EXPECTED_SIG_ALG));
  return x509;
}

describe("TN-189 preview keyring (the contract, on real crypto)", () => {
  test("generate → independently parseable self-signed X.509 certificate; handle is the alias", async () => {
    const keys = previewKeyring();
    const result = await keys.generateIdentity(ALICE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handle).toBe(ALICE);
    expect(result.value.certificatePem.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(result.value.certificatePem.endsWith("-----END CERTIFICATE-----\n")).toBe(true);
    expectValidCertificate(result.value.certificatePem, ALICE);
  });

  test("unicode aliases are valid identifiers", async () => {
    const keys = previewKeyring();
    const result = await keys.generateIdentity("pairing.🔧.télé");
    expect(result.ok).toBe(true);
    if (result.ok) expectValidCertificate(result.value.certificatePem, "pairing.🔧.télé");
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

    // Verify with the certificate's public key: SPKI is the last TBS
    // element of the cert DER (no extensions in certs this repo mints).
    expectValidCertificate(identity.value.certificatePem, ALICE);
    const der = pemToDer(identity.value.certificatePem);
    const cert = readTlv(der, 0)!;
    const tbs = readTlv(cert.content, 0)!;
    let spki: Uint8Array | null = null;
    let at = 0;
    for (;;) {
      const el = readTlv(tbs.content, at);
      if (!el) break;
      spki = el.full;
      at = el.next;
    }
    const publicKey = await crypto.subtle.importKey(
      "spki",
      new Uint8Array(spki!),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );

    // Compliant WebCrypto verifies the RAW IEEE P1363 r||s directly.
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      new Uint8Array(signed.value),
      data
    );
    expect(verified).toBe(true);

    // Different data must NOT verify — asserted on the raw representation
    // alone (the review head's `&&`-combined check could hide acceptance).
    const wrongData = new TextEncoder().encode("not the challenge");
    const rejected = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      new Uint8Array(signed.value),
      wrongData
    );
    expect(rejected).toBe(false);
  });

  test("sign accepts an empty payload (hash of zero bytes) and stays 64 bytes", async () => {
    const keys = previewKeyring();
    await keys.generateIdentity(ALICE);
    const signed = await keys.sign(ALICE, new Uint8Array(0));
    expect(signed.ok).toBe(true);
    if (signed.ok) expect(signed.value.length).toBe(64);
  });

  test("concurrent duplicate generation fails exactly one caller and never replaces", async () => {
    const keys = previewKeyring();
    const results = await Promise.all([
      keys.generateIdentity(ALICE),
      keys.generateIdentity(ALICE),
    ]);
    const oks = results.filter((r) => r.ok);
    const invalids = results.filter((r) => !r.ok);
    expect(oks.length).toBe(1);
    expect(invalids.length).toBe(1);
    if (!invalids[0]!.ok) expect(invalids[0]!.failure.kind).toBe("invalid-argument");
    // The surviving identity is the one the successful caller was told about.
    if (oks[0]!.ok) {
      const exported = await keys.exportCertificatePem(ALICE);
      expect(exported).toEqual({ ok: true, value: oks[0]!.value.certificatePem });
    }
  });

  test("alias bounds: too long, control characters, and lone surrogates are invalid", async () => {
    const keys = previewKeyring();
    const tooLong = "a".repeat(129);
    for (const alias of [tooLong, "bad\u0000alias", "bad\u007falias", "lone\uDC00surrogate", "high\uD800orphan"]) {
      const result = await keys.generateIdentity(alias);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("invalid-argument");
    }
    // Boundary: exactly 128 is fine.
    const edge = "a".repeat(128);
    expect((await keys.generateIdentity(edge)).ok).toBe(true);
  });

  test("data bounds: over 65536 bytes is invalid; empty is valid", async () => {
    const keys = previewKeyring();
    await keys.generateIdentity(ALICE);
    const oversized = await keys.sign(ALICE, new Uint8Array(65_537));
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.failure.kind).toBe("invalid-argument");
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
    expect(await keys.removeIdentity(ALICE)).toEqual({ ok: true, value: undefined });

    const signed = await keys.sign(ALICE, new Uint8Array([9]));
    expect(signed.ok).toBe(false);
    if (!signed.ok) expect(signed.failure.kind).toBe("invalid-argument");
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
    expect(previewKeyring().permissionPrerequisites()).toEqual([]);
  });

  test("availability is honest: without WebCrypto it reports unavailable", () => {
    const globalAny = globalThis as { crypto?: Crypto };
    const saved = globalAny.crypto;
    const keys = previewKeyring();
    expect(keys.availability()).toEqual({ status: "supported" });
    try {
      delete globalAny.crypto;
      expect(keys.availability()).toEqual({
        status: "unavailable",
        reason: "preview host has no WebCrypto (crypto.subtle)",
      });
    } finally {
      if (saved !== undefined) globalAny.crypto = saved;
    }
  });
});

describe("TN-189 frozen signature wire format (canonical DER ↔ raw r||s)", () => {
  // The same vectors the Kotlin format tests (KeysServiceFormatTest) use.
  const pad = (tail: number[]): Uint8Array =>
    new Uint8Array([...new Array(32 - tail.length).fill(0), ...tail]);

  test("minimal integers: r=…01, s=…02 round-trip canonically", () => {
    const raw = new Uint8Array([...pad([0x01]), ...pad([0x02])]);
    const der = ecdsaRawToDer(raw);
    expect(der).not.toBeNull();
    expect(Array.from(der!)).toEqual([0x30, 6, 2, 1, 1, 2, 1, 2]);
    expect(ecdsaDerToRaw(der!)).toEqual(raw);
  });

  test("high-bit integers gain a DER sign byte; extraction strips it", () => {
    const raw = new Uint8Array([
      ...new Array(32).fill(0xff),
      ...pad([0x01]),
    ]);
    const der = ecdsaRawToDer(raw);
    expect(der).not.toBeNull();
    expect(der![2]).toBe(0x02);
    expect(der![3]).toBe(33);
    expect(ecdsaDerToRaw(der!)).toEqual(raw);
  });

  test("a raw r that itself starts with 0x30 is never misread as DER", () => {
    // The review head treated leading 0x30 as a DER marker. The converters
    // no longer guess — this vector round-trips through the explicit path.
    const raw = new Uint8Array([0x30, ...new Array(31).fill(0x11), ...pad([0x02])]);
    const der = ecdsaRawToDer(raw);
    expect(der).not.toBeNull();
    expect(ecdsaDerToRaw(der!)).toEqual(raw);
  });

  test("zero integers stay valid (single zero byte in DER)", () => {
    const raw = new Uint8Array(64);
    const der = ecdsaRawToDer(raw);
    expect(der).not.toBeNull();
    expect(der![3]).toBe(1);
    expect(ecdsaDerToRaw(der!)).toEqual(raw);
  });

  test("malformed or noncanonical DER is refused, never guessed", () => {
    // wrong outer length
    expect(ecdsaDerToRaw(new Uint8Array([0x30, 0x00, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]))).toBeNull();
    // short outer length claiming more than present
    expect(ecdsaDerToRaw(new Uint8Array([0x30, 0x7f, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]))).toBeNull();
    // trailing byte
    expect(ecdsaDerToRaw(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02, 0x00]))).toBeNull();
    // negative INTEGER (0x80+ with no sign byte)
    expect(ecdsaDerToRaw(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x80, 0x02, 0x01, 0x02]))).toBeNull();
    // redundant sign byte on a positive value
    expect(ecdsaDerToRaw(new Uint8Array([0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x02]))).toBeNull();
    // third element after the two INTEGERs
    expect(
      ecdsaDerToRaw(new Uint8Array([0x30, 0x09, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02, 0x02, 0x01, 0x03]))
    ).toBeNull();
    // integer wider than the field
    expect(
      ecdsaDerToRaw(new Uint8Array([0x30, 0x24, 0x02, 0x21, ...new Array(33).fill(1), 0x02, 0x01, 0x02]))
    ).toBeNull();
    // not a SEQUENCE / empty / wrong raw length
    expect(ecdsaDerToRaw(new Uint8Array([0x31, 0x00]))).toBeNull();
    expect(ecdsaDerToRaw(new Uint8Array(0))).toBeNull();
    expect(ecdsaRawToDer(new Uint8Array(63))).toBeNull();
  });
});

describe("TN-189 shared input validation", () => {
  test("validKeyAlias matches the native bounds exactly", () => {
    expect(validKeyAlias("a")).toBe(true);
    expect(validKeyAlias("a".repeat(128))).toBe(true);
    expect(validKeyAlias("")).toBe(false);
    expect(validKeyAlias("a".repeat(129))).toBe(false);
    expect(validKeyAlias("a\u0000b")).toBe(false);
    expect(validKeyAlias("a\u009fb")).toBe(false);
    expect(validKeyAlias("a\uDC00b")).toBe(false);
    expect(validKeyAlias("a\uD800b")).toBe(false);
    expect(validKeyAlias("a\uD83D\uDD27b")).toBe(true); // paired surrogate 🔧
    expect(validKeyAlias(123 as unknown)).toBe(false);
    expect(validKeyAlias(null as unknown)).toBe(false);
  });

  test("validKeyData: Uint8Array up to 65536 bytes, empty allowed", () => {
    expect(validKeyData(new Uint8Array(0))).toBe(true);
    expect(validKeyData(new Uint8Array(65_536))).toBe(true);
    expect(validKeyData(new Uint8Array(65_537))).toBe(false);
    expect(validKeyData([] as unknown)).toBe(false);
    expect(validKeyData("0102" as unknown)).toBe(false);
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

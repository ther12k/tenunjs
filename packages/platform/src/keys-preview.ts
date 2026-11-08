/**
 * Preview-tier keys implementation: an in-memory WebCrypto keyring (TN-189).
 *
 * **This is not a secure store.** Keys live in process memory, vanish with
 * the page, and are software-only — the marker property `notASecureStore:
 * true` is part of the returned object so the fact survives being passed
 * around. It exists so authoring and headless tests exercise the REAL
 * contract (generate → self-signed X.509 → raw r||s signatures) with no
 * hardware, exactly like the AndroidKeyStore host does.
 *
 * WebCrypto cannot mint certificates, so this file carries the smallest
 * honest X.509 v3 self-signed encoder (no extensions, CN=<alias>,
 * ecdsa-with-SHA256, fixed 2026–2049 validity — UTCTime's range) plus the
 * DER↔raw ECDSA converters shared with the Android tier. Signature byte
 * formats: compliant WebCrypto (browsers, Node, Bun) returns the fixed-width
 * raw IEEE P1363 r||s — exactly the pinned contract format, used verbatim —
 * while the X.509 signature field must be DER, so the encoder converts with
 * `ecdsaRawToDer`. Java's `Signature.sign()` is the DER producer; it lives
 * on the Android host (KeysService) and converts DER→raw for the seam.
 *
 * No top-level WebCrypto access and no imports beyond the contract: the
 * platform package stays dependency-free and QuickJS-loadable; `crypto` is
 * touched only inside methods, and `availability()` reports `unavailable`
 * when the host has no WebCrypto rather than advertising support it cannot
 * deliver.
 */
import type { CapabilityResult } from "./capability";
import type { KeyHandle, KeyIdentity, KeysCapability } from "./keys";
import { validKeyAlias, validKeyData } from "./keys-validation";

// ---------------------------------------------------------------------------
// DER primitives (encode-side only; decode is the converter below)
// ---------------------------------------------------------------------------

const u8 = (...bytes: number[]): Uint8Array => new Uint8Array(bytes);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** DER definite length octets (P-256 artifacts stay in short form). */
const derLength = (n: number): Uint8Array =>
  n < 0x80 ? u8(n) : (() => {
    const bytes: number[] = [];
    let v = n;
    while (v > 0) {
      bytes.unshift(v & 0xff);
      v >>>= 8;
    }
    return u8(0x80 | bytes.length, ...bytes);
  })();

const tlv = (tag: number, content: Uint8Array): Uint8Array =>
  concat(u8(tag), derLength(content.length), content);

/** Dotted OID → DER CONTENT bytes (the 06 header is added by `tlv`). */
const oid = (parts: readonly number[]): Uint8Array => {
  const body: number[] = [parts[0]! * 40 + parts[1]!];
  for (const p of parts.slice(2)) {
    let v = p;
    const stack: number[] = [v & 0x7f];
    v >>>= 7;
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    body.push(...stack);
  }
  return new Uint8Array(body);
};

/** Minimal positive INTEGER (serial numbers); a set MSB gets a sign 0x00. */
const positiveInteger = (bytes: Uint8Array): Uint8Array => {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const trimmed = bytes.slice(start);
  return tlv(0x02, trimmed[0]! >= 0x80 ? concat(u8(0x00), trimmed) : trimmed);
};

/** AlgorithmIdentifier = SEQUENCE { OID } — RFC 5280 §4.1.1.2 shape. */
const ecdsaWithSha256 = tlv(0x30, tlv(0x06, oid([1, 2, 840, 10045, 4, 3, 2])));
const commonName = tlv(0x06, oid([2, 5, 4, 3]));

/** RDNSequence: one UTF8String CN — `UTF8String(0x0C)` accepts any alias. */
const nameCN = (alias: string): Uint8Array => {
  const utf8 = new TextEncoder().encode(alias);
  return tlv(0x30, tlv(0x31, tlv(0x30, concat(commonName, tlv(0x0c, utf8)))));
};

/** Fixed preview validity: 2026-01-01T00:00:00Z → 2049-12-31T23:59:59Z. */
const NOT_BEFORE = u8(...ascii("260101000000Z"));
const NOT_AFTER = u8(...ascii("491231235959Z"));

function ascii(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) out.push(text.charCodeAt(i) & 0x7f);
  return out;
}

/** FNV-1a over the alias → deterministic positive serial (high bit cleared). */
const serialFor = (alias: string): Uint8Array => {
  let h = 0x811c9dc5;
  for (let i = 0; i < alias.length; i += 1) {
    h ^= alias.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return u8((h >>> 24) & 0x7f, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
};

/** Certificate = SEQ(TBSCertificate, sigAlg, BITSTRING(DER signature)). */
async function selfSignedCertificate(
  alias: string,
  spki: Uint8Array,
  privateKey: CryptoKey
): Promise<Uint8Array> {
  const tbs = concat(
    tlv(0xa0, u8(0x02, 0x01, 0x02)), // [0] EXPLICIT version: v3
    positiveInteger(serialFor(alias)),
    ecdsaWithSha256,
    nameCN(alias), // issuer = subject: self-signed
    tlv(0x30, concat(tlv(0x17, NOT_BEFORE), tlv(0x17, NOT_AFTER))),
    nameCN(alias),
    spki // SubjectPublicKeyInfo is already DER from exportKey("spki")
  );
  const tbsDer = tlv(0x30, tbs);
  // WebCrypto returns the raw IEEE P1363 r||s; the X.509 signature field
  // must be DER, so convert explicitly — no format guessing anywhere.
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new Uint8Array(tbsDer))
  );
  if (rawSignature.length !== 64) {
    throw new Error(`host crypto returned a ${rawSignature.length}-byte ECDSA signature, expected 64`);
  }
  const derSignature = ecdsaRawToDer(rawSignature);
  if (!derSignature) throw new Error("failed to DER-encode the certificate signature");
  const bitString = concat(u8(0x00), derSignature); // zero unused bits
  return tlv(0x30, concat(tbsDer, ecdsaWithSha256, tlv(0x03, bitString)));
}

// ---------------------------------------------------------------------------
// PEM + canonical DER(ECDSA SEQUENCE(r,s)) ↔ fixed-width raw r||s
// ---------------------------------------------------------------------------

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const pemWrap = (label: string, der: Uint8Array): string => {
  const b64 = toBase64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
};

/**
 * Reads one CANONICAL DER INTEGER at `at`: length 1..(half+1); zero is the
 * single byte 0x00; the sign byte 0x00 is present (for nonzero values)
 * iff the magnitude's MSB is set; redundant padding and negative values
 * (high bit with no sign byte) are refused. Returns the unsigned
 * magnitude — a lone 0x00 stays a one-byte zero magnitude.
 */
const canonicalInteger = (
  der: Uint8Array,
  at: number,
  half: number
): { bytes: Uint8Array; next: number } | null => {
  if (at + 2 > der.length || der[at] !== 0x02) return null;
  const len = der[at + 1]!;
  if (len === 0 || len > half + 1 || at + 2 + len > der.length) return null;
  let content = der.slice(at + 2, at + 2 + len);
  if (content[0] === 0x00 && content.length > 1) {
    if (content[1]! < 0x80) return null; // redundant sign byte
    content = content.slice(1);
  } else if (content[0]! >= 0x80) {
    return null; // negative integer
  }
  return { bytes: content, next: at + 2 + len };
};

/**
 * Canonical DER SEQUENCE(INTEGER r, INTEGER s) → fixed-width r||s
 * (half+half bytes). The SEQUENCE length must match the buffer exactly —
 * no trailing bytes — and both INTEGERs must be canonical per
 * [canonicalInteger]. Returns null for anything else; callers turn null
 * into a structured failure, never a guess.
 */
export function ecdsaDerToRaw(der: Uint8Array, half = 32): Uint8Array | null {
  if (der.length < 8 || der[0] !== 0x30 || der[1]! >= 0x80) return null;
  if (2 + der[1]! !== der.length) return null; // trailing or short buffer
  const r = canonicalInteger(der, 2, half);
  if (!r) return null;
  const s = canonicalInteger(der, r.next, half);
  if (!s || s.next !== der.length) return null; // s must end the SEQUENCE exactly
  if (r.bytes.length > half || s.bytes.length > half) return null;
  const out = new Uint8Array(half * 2);
  out.set(r.bytes, half - r.bytes.length);
  out.set(s.bytes, half * 2 - s.bytes.length);
  return out;
}

/** Fixed-width r||s (half+half) → canonical DER SEQUENCE(r, s). */
export function ecdsaRawToDer(raw: Uint8Array, half = 32): Uint8Array | null {
  if (raw.length !== half * 2) return null;
  const asInteger = (from: number): Uint8Array => {
    let start = from;
    while (start < from + half - 1 && raw[start] === 0) start += 1;
    const trimmed = raw.slice(start, from + half);
    return trimmed[0]! >= 0x80 ? tlv(0x02, concat(u8(0x00), trimmed)) : tlv(0x02, trimmed);
  };
  return tlv(0x30, concat(asInteger(0), asInteger(half)));
}

// ---------------------------------------------------------------------------
// The keyring
// ---------------------------------------------------------------------------

/** Marker interface: the insecure fact travels with the object. */
export interface PreviewKeysCapability extends KeysCapability {
  readonly notASecureStore: true;
}

interface KeyringEntry {
  readonly certificateDer: Uint8Array;
  readonly certificatePem: string;
  readonly privateKey: CryptoKey;
}

function ok<T>(value: T): CapabilityResult<T> {
  return { ok: true, value };
}
const invalid = (message: string): CapabilityResult<never> => ({
  ok: false,
  failure: { kind: "invalid-argument", message },
});
const platformError = (message: string): CapabilityResult<never> => ({
  ok: false,
  failure: { kind: "platform-error", message },
});

/** Guard: unexpected host failures stay result-shaped, never throws. */
async function guard<T>(work: () => Promise<CapabilityResult<T>>): Promise<CapabilityResult<T>> {
  try {
    return await work();
  } catch (error) {
    return platformError(`preview keyring: ${String(error)}`);
  }
}

const subtle = (): SubtleCrypto | null => {
  const c = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto;
  return c?.subtle ?? null;
};

/**
 * Builds the in-memory preview keyring. Identities are keyed by the
 * caller's alias (which IS the opaque handle here — opaque means apps
 * never parse it, and nothing in this tier gives them a reason to).
 * `removeIdentity` is idempotent; every other missing handle is
 * invalid-argument, exactly like the Android host.
 *
 * Alias uniqueness is enforced with a SYNCHRONOUS reservation taken before
 * the first `await`, so two concurrent generateIdentity calls for one
 * alias can never both succeed — the loser gets invalid-argument, and no
 * generation result can resurrect an alias removed while it was in flight.
 */
export function previewKeyring(): PreviewKeysCapability {
  const identities = new Map<string, KeyringEntry>();
  const generating = new Set<string>();
  const lookup = (handle: KeyHandle): KeyringEntry | null =>
    identities.get(handle) ?? null;

  return {
    notASecureStore: true,
    contractVersion: 1,
    availability: () =>
      subtle()
        ? { status: "supported" }
        : { status: "unavailable", reason: "preview host has no WebCrypto (crypto.subtle)" },
    permissionPrerequisites: () => [],
    generateIdentity(alias) {
      return guard(async () => {
        if (!validKeyAlias(alias)) {
          return invalid("alias must be a string of 1..128 Unicode code points without control characters or lone surrogates");
        }
        // Synchronous reservation: any concurrent duplicate fails here,
        // before any await can interleave.
        if (identities.has(alias) || generating.has(alias)) {
          return invalid(`alias already exists: ${alias}`);
        }
        generating.add(alias);
        try {
          const pair = await subtle()!.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            false, // private key stays non-extractable even here
            ["sign"]
          );
          const spki = new Uint8Array(await subtle()!.exportKey("spki", pair.publicKey));
          const certificateDer = await selfSignedCertificate(alias, spki, pair.privateKey);
          const entry: KeyringEntry = {
            certificateDer,
            certificatePem: pemWrap("CERTIFICATE", certificateDer),
            privateKey: pair.privateKey,
          };
          if (!generating.has(alias)) {
            // removeIdentity won the race: commit nothing and report the
            // interleaving instead of silently resurrecting the alias.
            return platformError(`alias removed during generation: ${alias}`);
          }
          identities.set(alias, entry);
          return ok({ handle: alias, certificatePem: entry.certificatePem });
        } finally {
          generating.delete(alias);
        }
      });
    },
    async sign(handle, data) {
      return guard(async () => {
        const entry = lookup(handle);
        if (!entry) return invalid(`identity not found: ${handle}`);
        if (!validKeyData(data)) {
          return invalid("data must be a Uint8Array of at most 65536 bytes (empty is valid)");
        }
        // Copy to an ArrayBuffer-backed buffer for hosts whose WebCrypto
        // typings require BufferSource (also freezes the input bytes).
        const bytes = new Uint8Array(data);
        const raw = new Uint8Array(
          await subtle()!.sign({ name: "ECDSA", hash: "SHA-256" }, entry.privateKey, bytes)
        );
        // Compliant WebCrypto returns the pinned raw IEEE P1363 r||s
        // directly; anything else is a host defect we surface, never fix up.
        if (raw.length !== 64) {
          return platformError(`host crypto returned a ${raw.length}-byte ECDSA signature, expected 64`);
        }
        return ok(raw);
      });
    },
    async exportCertificatePem(handle) {
      return guard(async () => {
        const entry = lookup(handle);
        return entry ? ok(entry.certificatePem) : invalid(`identity not found: ${handle}`);
      });
    },
    async removeIdentity(handle) {
      return guard(async () => {
        identities.delete(handle);
        generating.delete(handle); // cancels an in-flight generation of the same alias
        return ok(undefined);
      });
    },
  };
}

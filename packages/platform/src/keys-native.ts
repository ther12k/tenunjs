/**
 * Android native-host keys capability: the TypeScript side of the TN-154
 * `tenun_host_call` bridge (TN-189).
 *
 * QuickJS bundles cannot reach AndroidKeyStore directly; they hold the
 * injected `globalThis.tenun_host_call(service, method, payloadJson)` and
 * this adapter turns that synchronous JSON bridge into the frozen
 * `KeysCapability` contract: result-shaped returns, never throws, the
 * frozen failure alphabet, opaque handles, and the pinned raw r||s (64
 * bytes) signature format.
 *
 * Wire contract (service "keys", mirrored by KeysService.kt):
 *   generateIdentity      {"alias"}             → {"ok":true,"value":{"handle","certificatePem"}}
 *   sign                  {"handle","data":b64} → {"ok":true,"value":"<b64 raw r||s, 64 bytes>"}
 *   exportCertificatePem  {"handle"}            → {"ok":true,"value":"<pem>"}
 *   removeIdentity        {"handle"}            → {"ok":true,"value":null}
 *   availability          {}                    → {"ok":true,"value":{"status":"supported"|…}}
 * Failures arrive as {"ok":false,"failure":{"kind","message"}} with kinds
 * from the frozen alphabet; an unknown kind is surfaced as platform-error
 * rather than smuggled through. A null reply means the host has no "keys"
 * service → `unsupported`; a throwing bridge is `platform-error`.
 *
 * Dependency-free by policy: no Node `Buffer`, no `btoa`/`atob` (QuickJS
 * ships neither), no WebCrypto — base64 and UTF-8 are implemented here.
 */
import type {
  CapabilityAvailability,
  CapabilityFailureKind,
  CapabilityResult,
} from "./capability";
import type { KeyHandle, KeyIdentity, KeysCapability } from "./keys";
import { validKeyAlias, validKeyData } from "./keys-validation";

/** The synchronous TN-154 bridge an app host injects globally. */
export type KeysHostCall = (
  service: string,
  method: string,
  payloadJson: string
) => string | null;

const FAILURE_KINDS: readonly CapabilityFailureKind[] = [
  "unsupported",
  "denied",
  "unavailable",
  "busy",
  "timeout",
  "cancelled",
  "invalid-argument",
  "link-lost",
  "platform-error",
];

const invalid = (message: string): CapabilityResult<never> => ({
  ok: false,
  failure: { kind: "invalid-argument", message },
});
const unsupported = (message: string): CapabilityResult<never> => ({
  ok: false,
  failure: { kind: "unsupported", message },
});
const platformError = (message: string): CapabilityResult<never> => ({
  ok: false,
  failure: { kind: "platform-error", message },
});

// --- pure-JS base64 (standard alphabet, padded; QuickJS-safe) -----------
// Exported for the other bridge adapters (net-native.ts) — binary payloads
// cross the JSON bridge the same way in both services.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 0x3f] : "=";
  }
  return out;
}

export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  let length = (text.length / 4) * 3;
  if (text.endsWith("====")) return null;
  if (text.endsWith("==")) length -= 2;
  else if (text.endsWith("=")) length -= 1;
  const out = new Uint8Array(length);
  let at = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    let v: number;
    if (c >= 65 && c <= 90) v = c - 65;
    else if (c >= 97 && c <= 122) v = c - 97 + 26;
    else if (c >= 48 && c <= 57) v = c - 48 + 52;
    else if (c === 43) v = 62;
    else if (c === 47) v = 63;
    else if (c === 61 && i >= text.length - 2) break; // padding
    else return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (at < length) out[at++] = (buffer >> bits) & 0xff;
    }
  }
  return at === length ? out : null;
}

// --- envelope decoding ---------------------------------------------------

interface NativeEnvelope {
  ok: boolean;
  value?: unknown;
  failure?: { kind?: unknown; message?: unknown };
}

function parseEnvelope(reply: string, method: string): CapabilityResult<NativeEnvelope> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return platformError(`keys.${method}: host returned non-JSON reply`);
  }
  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
    return platformError(`keys.${method}: host reply is not a result envelope`);
  }
  const envelope = parsed as NativeEnvelope;
  if (envelope.ok) return { ok: true, value: envelope };
  const kind = envelope.failure?.kind;
  const message =
    typeof envelope.failure?.message === "string" ? envelope.failure.message : undefined;
  if (typeof kind !== "string" || !FAILURE_KINDS.includes(kind as CapabilityFailureKind)) {
    return platformError(`keys.${method}: host failure kind is not in the frozen alphabet`);
  }
  return {
    ok: false,
    failure: { kind: kind as CapabilityFailureKind, message },
  };
}

/**
 * Builds the keys capability over the native bridge. Pass the host's
 * injected bridge (e.g. a type-guarded `globalThis.tenun_host_call`); the
 * capability is fail-closed when the bridge is missing or the host has no
 * "keys" service (null replies) — never a fabricated success.
 */
export function createHostKeysCapability(hostCall: KeysHostCall): KeysCapability {
  const call = (method: string, payloadJson: string): CapabilityResult<string> => {
    let reply: string | null;
    try {
      reply = hostCall("keys", method, payloadJson);
    } catch (error) {
      return platformError(`keys.${method}: bridge threw ${String(error)}`);
    }
    if (reply === null || reply === undefined) {
      return unsupported(`keys.${method}: this host has no keys service`);
    }
    if (typeof reply !== "string") {
      return platformError(`keys.${method}: bridge returned a non-string`);
    }
    return { ok: true, value: reply };
  };

  const availabilityProbe = (): CapabilityAvailability => {
    const reply = call("availability", "{}");
    if (!reply.ok) return { status: "unsupported", reason: reply.failure.message };
    const envelope = parseEnvelope(reply.value, "availability");
    if (!envelope.ok) return { status: "unavailable", reason: envelope.failure.message };
    const statusValue = envelope.value.value as { status?: unknown; reason?: unknown } | undefined;
    const status = statusValue?.status;
    if (
      status === "supported" ||
      status === "unsupported" ||
      status === "denied" ||
      status === "unavailable"
    ) {
      const reason = typeof statusValue?.reason === "string" ? statusValue.reason : undefined;
      return reason === undefined || status === "supported"
        ? ({ status } as CapabilityAvailability)
        : ({ status, reason } as CapabilityAvailability);
    }
    return { status: "unavailable", reason: "keys.availability: malformed status" };
  };

  return {
    contractVersion: 1,
    availability: availabilityProbe,
    permissionPrerequisites: () => [],

    async generateIdentity(alias) {
      if (!validKeyAlias(alias)) {
        return invalid("alias must be a string of 1..128 Unicode code points without control characters or lone surrogates");
      }
      const reply = call("generateIdentity", JSON.stringify({ alias }));
      if (!reply.ok) return reply;
      const envelope = parseEnvelope(reply.value, "generateIdentity");
      if (!envelope.ok) return envelope;
      const value = envelope.value.value as { handle?: unknown; certificatePem?: unknown } | undefined;
      if (
        typeof value?.handle !== "string" ||
        !validKeyAlias(value.handle) ||
        typeof value.certificatePem !== "string" ||
        !value.certificatePem.startsWith("-----BEGIN CERTIFICATE-----")
      ) {
        return platformError("keys.generateIdentity: malformed identity in host reply");
      }
      return { ok: true, value: { handle: value.handle, certificatePem: value.certificatePem } };
    },

    async sign(handle, data) {
      if (typeof handle !== "string") return invalid("handle must be a string");
      if (!validKeyData(data)) {
        return invalid("data must be a Uint8Array of at most 65536 bytes (empty is valid)");
      }
      const reply = call("sign", JSON.stringify({ handle, data: encodeBase64(data) }));
      if (!reply.ok) return reply;
      const envelope = parseEnvelope(reply.value, "sign");
      if (!envelope.ok) return envelope;
      const value = envelope.value.value;
      if (typeof value !== "string") {
        return platformError("keys.sign: malformed signature in host reply");
      }
      const raw = decodeBase64(value);
      if (raw === null || raw.length !== 64) {
        return platformError("keys.sign: host signature is not 64 raw r||s bytes");
      }
      return { ok: true, value: raw };
    },

    async exportCertificatePem(handle) {
      if (typeof handle !== "string") return invalid("handle must be a string");
      const reply = call("exportCertificatePem", JSON.stringify({ handle }));
      if (!reply.ok) return reply;
      const envelope = parseEnvelope(reply.value, "exportCertificatePem");
      if (!envelope.ok) return envelope;
      const value = envelope.value.value;
      if (typeof value !== "string" || !value.startsWith("-----BEGIN CERTIFICATE-----")) {
        return platformError("keys.exportCertificatePem: malformed PEM in host reply");
      }
      return { ok: true, value };
    },

    async removeIdentity(handle) {
      if (typeof handle !== "string") return invalid("handle must be a string");
      const reply = call("removeIdentity", JSON.stringify({ handle }));
      if (!reply.ok) return reply;
      const envelope = parseEnvelope(reply.value, "removeIdentity");
      if (!envelope.ok) return envelope;
      return { ok: true, value: undefined };
    },
  };
}

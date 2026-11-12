/**
 * Shared net-capability argument bounds (TN-188) — the SAME rules on the
 * preview tier, the native adapter, and the Android host service, so a
 * payload refused in TypeScript is refused for the identical reason in
 * Kotlin (the keys-validation.ts discipline).
 *
 * Bounds chosen with the bridge in mind: one write crossing the JNI seam
 * is a base64 string inside a JSON envelope, so 1 MiB of raw bytes is the
 * generous ceiling; the receive-side bound lives host-side (1 MiB buffered
 * ahead of the runtime → overflow is link-lost, never truncation).
 */
import { validKeyAlias } from "./keys-validation";

/** Largest single write the seam accepts (empty writes are valid). */
export const MAX_NET_WRITE_BYTES = 1_048_576;

/** Largest connect timeout the seam accepts; hosts may clamp lower. */
export const MAX_NET_TIMEOUT_MS = 120_000;

function hasControlOrWhitespace(code: number): boolean {
  return code <= 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/**
 * A connect host or SNI serverName: 1..253 UTF-16 code units, no control
 * characters, no whitespace, and none of the reserved URI delimiters —
 * a value like "https://tv.lan" is a URL, not a host, and must be refused
 * loudly rather than silently failing to resolve.
 */
export function validNetHost(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 253) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (hasControlOrWhitespace(c)) return false;
    if (value[i] === "/" || value[i] === "?" || value[i] === "#") return false;
  }
  return true;
}

export function validNetPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function validNetTimeout(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_NET_TIMEOUT_MS
  );
}

/** Lowercase hex from onServerCertificate; pins may arrive upper-case. */
export function validCertSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

/** TLS option table shape check used by both preview and native tiers. */
export function validNetTlsOptions(
  tls: unknown
): tls is { clientIdentity?: string; expectedServerCertSha256?: string; serverName?: string } {
  if (tls === undefined) return true;
  if (typeof tls !== "object" || tls === null) return false;
  const options = tls as Record<string, unknown>;
  for (const key of Object.keys(options)) {
    if (key !== "clientIdentity" && key !== "expectedServerCertSha256" && key !== "serverName") {
      return false;
    }
  }
  if ("clientIdentity" in options) {
    const alias = options.clientIdentity;
    if (alias !== undefined && !validKeyAlias(alias)) return false;
  }
  if ("expectedServerCertSha256" in options) {
    const pin = options.expectedServerCertSha256;
    if (pin !== undefined && !validCertSha256(pin)) return false;
  }
  if ("serverName" in options) {
    const name = options.serverName;
    if (name !== undefined && !validNetHost(name)) return false;
  }
  return true;
}

/** Minimal CapabilityCancelSignal shape check (the seam's, not AbortSignal). */
export function isNetCancelSignal(value: unknown): value is { aborted: boolean; addAbortListener(fn: () => void): () => void } {
  if (typeof value !== "object" || value === null) return false;
  const signal = value as { aborted?: unknown; addAbortListener?: unknown };
  return typeof signal.aborted === "boolean" && typeof signal.addAbortListener === "function";
}

/**
 * Shared connect-argument check for every tier (preview, fake endpoint,
 * native adapter): returns the invalid-argument message, or null when the
 * arguments may cross the seam.
 */
export function netConnectArgumentError(options: unknown): string | null {
  if (typeof options !== "object" || options === null) {
    return "connect options must be an object";
  }
  const opts = options as {
    host?: unknown;
    port?: unknown;
    timeoutMs?: unknown;
    signal?: unknown;
    tls?: unknown;
  };
  if (!validNetHost(opts.host)) {
    return "host must be 1..253 characters without control, whitespace, or URI delimiters";
  }
  if (!validNetPort(opts.port)) {
    return "port must be an integer between 1 and 65535";
  }
  if (opts.timeoutMs !== undefined && !validNetTimeout(opts.timeoutMs)) {
    return "timeoutMs must be an integer between 1 and 120000";
  }
  if (opts.signal !== undefined && !isNetCancelSignal(opts.signal)) {
    return "signal must be a CapabilityCancelSignal";
  }
  if (!validNetTlsOptions(opts.tls)) {
    return "tls may carry only clientIdentity, expectedServerCertSha256 (64 hex chars), and serverName";
  }
  return null;
}

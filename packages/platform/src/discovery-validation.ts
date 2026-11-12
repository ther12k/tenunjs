/**
 * Shared discovery-capability argument bounds (TN-190) — the SAME rules
 * on the native adapter and the Android host service, so a payload
 * refused in TypeScript is refused for the identical reason in Kotlin
 * (the keys/net validation discipline).
 *
 * The bounds follow RFC 6763 DNS-SD where the wire cares: a service type
 * is `_name._tcp`/`_name._udp` (the name label 1..15 chars, the transport
 * spelled out), a service name is 1..63 UTF-8 bytes with no dots (dots
 * are instance separators in DNS-SD), and a domain is 1..253 code units
 * without control characters — `local` is the tier companions use.
 */
import { isNetCancelSignal } from "./net-validation";

/** Longest DNS-SD instance name (RFC 6763: 63 UTF-8 BYTES on the wire,
 * which is stricter than 63 code units for non-ASCII names). */
export const MAX_SERVICE_NAME_BYTES = 63;

/** Largest TXT table the seam accepts (keys and total size are bounded). */
export const MAX_TXT_ENTRIES = 64;
export const MAX_TXT_VALUE_BYTES = 255;

function hasControl(code: number): boolean {
  return code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/**
 * A DNS-SD service type: `_name._tcp` or `_name._udp`. RFC 6763 §7 keeps
 * service names to 15 characters, but real registrations run longer
 * (`_androidtvremote2._tcp` is 16) and NsdManager accepts a full DNS
 * label, so the bound here is the label ceiling of 63 — letters, digits,
 * and hyphen, not starting with a hyphen. Neither `ipps`-style bare
 * names nor `_name._tcp.local.` trailing forms are accepted — the wire
 * carries exactly the pair.
 */
export function validServiceType(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^_[A-Za-z0-9][A-Za-z0-9-]{0,62}\._(tcp|udp)$/.test(value)) return false;
  return !value.includes("--");
}

/**
 * A DNS-SD instance name: 1..63 UTF-8 BYTES, no control characters, no
 * dots (a dot would split the instance from its type on the wire), no
 * leading/trailing space (NsdManager rejects them on Android).
 */
export function validServiceName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_SERVICE_NAME_BYTES) return false;
  if (utf8Length(value) > MAX_SERVICE_NAME_BYTES) return false;
  if (value.startsWith(" ") || value.endsWith(" ")) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (hasControl(code)) return false;
  }
  return !value.includes(".");
}

/** A DNS domain such as "local": 1..253 code units, no control/whitespace. */
export function validDiscoveryDomain(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 253) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false;
  }
  return true;
}

/** A DiscoveredService-shaped value as it crosses tiers and the wire. */
export function isDiscoveredService(value: unknown): value is DiscoveredServiceShape {
  if (typeof value !== "object" || value === null) return false;
  const service = value as { serviceType?: unknown; serviceName?: unknown; domain?: unknown };
  return (
    validServiceType(service.serviceType) &&
    validServiceName(service.serviceName) &&
    validDiscoveryDomain(service.domain)
  );
}

export type DiscoveredServiceShape = {
  serviceType: string;
  serviceName: string;
  domain: string;
};

/**
 * Shared browse-argument check for every tier: returns the invalid-argument
 * message, or null when the arguments may cross the seam.
 */
export function discoveryBrowseArgumentError(options: unknown): string | null {
  if (typeof options !== "object" || options === null) {
    return "browse options must be an object";
  }
  const opts = options as { serviceType?: unknown; signal?: unknown };
  if (!validServiceType(opts.serviceType)) {
    return "serviceType must be _name._tcp or _name._udp (label 1..63 chars)";
  }
  if (opts.signal !== undefined && !isNetCancelSignal(opts.signal)) {
    return "signal must be a CapabilityCancelSignal";
  }
  return null;
}

/** Byte length of a UTF-8 string without allocating (approximation-free). */
export function utf8Length(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) total += 1;
    else if (code < 0x800) total += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      total += 4;
      i += 1; // the low surrogate is part of the pair
    } else total += 3;
  }
  return total;
}

/**
 * A resolved TXT table as it crosses tiers: plain string→string, at most
 * [MAX_TXT_ENTRIES] entries, each value at most [MAX_TXT_VALUE_BYTES]
 * UTF-8 bytes (the RFC 6763 key/value wire limit).
 */
export function validTxtRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_TXT_ENTRIES) return false;
  for (const [key, entryValue] of entries) {
    if (key.length === 0 || key.length > 15) return false; // key ≤ 9 by RFC; hosts pad
    for (let i = 0; i < key.length; i += 1) {
      if (hasControl(key.charCodeAt(i))) return false;
    }
    if (typeof entryValue !== "string") return false;
    if (utf8Length(entryValue) > MAX_TXT_VALUE_BYTES) return false;
    for (let i = 0; i < entryValue.length; i += 1) {
      if (hasControl(entryValue.charCodeAt(i))) return false;
    }
  }
  return true;
}

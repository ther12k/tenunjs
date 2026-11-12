/**
 * Shared discovery-capability argument bounds (TN-190) — the SAME rules
 * on the native adapter and the Android host service, so a payload
 * refused in TypeScript is refused for the identical reason in Kotlin
 * (the keys/net validation discipline).
 *
 * The bounds follow RFC 6763 DNS-SD where the wire actually cares:
 *  - a service type is `_name._tcp`/`_name._udp` — the underscore plus
 *    the label stay within the DNS 63-byte label ceiling;
 *  - a service NAME is a RAW instance label (RFC 6763 §4.1.1): dots and
 *    spaces are legal punctuation inside the label (a device may
 *    legitimately advertise "TV 1.0"), so the bounds are the wire ones —
 *    1..63 UTF-8 bytes and no control characters — nothing more;
 *  - TXT entries are `key=value` constituents whose COMPLETE string is
 *    ≤255 bytes (§6.5); RFC 6763 only RECOMMENDS short keys (§6.4), so
 *    no key-length ceiling is imposed beyond that constituent limit.
 */
import { isNetCancelSignal } from "./net-validation";

/** Longest DNS-SD instance name (RFC 6763: 63 UTF-8 BYTES on the wire,
 * which is stricter than 63 code units for non-ASCII names). */
export const MAX_SERVICE_NAME_BYTES = 63;

/** Largest TXT table the seam accepts. */
export const MAX_TXT_ENTRIES = 64;

/** Longest complete TXT `key=value` constituent (RFC 6763 §6.5 wire limit). */
export const MAX_TXT_CONSTITUENT_BYTES = 255;

function hasControl(code: number): boolean {
  return code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/**
 * A DNS-SD service type: `_name._tcp` or `_name._udp`. RFC 6763 §7 keeps
 * service names to 15 characters, but real registrations run longer
 * (`_androidtvremote2._tcp` is 16) and NsdManager accepts a full DNS
 * label. The bound is the DNS label ceiling: underscore + label ≤ 63
 * bytes, letters/digits/hyphen, not starting with a hyphen. Neither
 * `ipps`-style bare names nor `_name._tcp.local.` trailing forms are
 * accepted — the wire carries exactly the pair.
 */
export function validServiceType(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^_[A-Za-z0-9][A-Za-z0-9-]{0,61}\._(tcp|udp)$/.test(value)) return false;
  return !value.includes("--");
}

/**
 * A DNS-SD instance name (RFC 6763 §4.1.1: a RAW label, not a dotted
 * DNS presentation name): 1..63 UTF-8 bytes, no control characters.
 * Dots and spaces are LEGAL label punctuation on the wire — a device may
 * advertise "TV 1.0" — so only the byte bound and control characters are
 * enforced. Escape-on-the-wire is the HOST's job (NsdManager escapes
 * internally); the contract carries the raw label the app displays.
 */
export function validServiceName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_SERVICE_NAME_BYTES) return false;
  if (utf8Length(value) > MAX_SERVICE_NAME_BYTES) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (hasControl(value.charCodeAt(i))) return false;
  }
  return true;
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
 * [MAX_TXT_ENTRIES] entries. Keys are printable ASCII without `=` (the
 * constituent grammar); each COMPLETE `key=value` string is at most
 * [MAX_TXT_CONSTITUENT_BYTES] UTF-8 bytes (RFC 6763 §6.5 — the limit is
 * on the whole constituent, not the value alone). Values carry arbitrary
 * string content; binary framing is the host's concern.
 */
export function validTxtRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_TXT_ENTRIES) return false;
  for (const [key, entryValue] of entries) {
    if (key.length === 0) return false;
    for (let i = 0; i < key.length; i += 1) {
      const code = key.charCodeAt(i);
      if (code < 0x21 || code > 0x7e || code === 0x3d /* '=' */) return false;
    }
    if (typeof entryValue !== "string") return false;
    // §6.5 permits arbitrary value bytes; the seam is string-typed, so the
    // only bound is the COMPLETE key=value constituent byte ceiling.
    if (utf8Length(`${key}=${entryValue}`) > MAX_TXT_CONSTITUENT_BYTES) return false;
  }
  return true;
}

/**
 * Discovery capability contract — mDNS/NSD service browse and resolve
 * (TN-190, specified by ADR-0027 and 04-api/discovery.md).
 *
 * A companion app must find its device without typing addresses. The TV
 * driver browses `_androidtvremote2._tcp`; the pattern is the same for
 * every companion product. The browse shape mirrors `ble.ts` scanning:
 * pushed results, idempotent stop, cancel signal.
 *
 * Semantics frozen with contractVersion 1:
 *  - never throws: every operation resolves to a CapabilityResult;
 *  - browse is event-driven: services arrive through listeners, `stop()`
 *    is idempotent, and a cancelled signal stops the browse with no
 *    further events;
 *  - resolve is SEPARATE from browse because mDNS resolution can fail
 *    independently (the device left): a not-found outcome is a structured
 *    `unavailable` failure, never a hang. Applications resolve at connect
 *    time, not cache endpoints across sessions;
 *  - service identity is `serviceName@domain`, NOT the endpoint —
 *    addresses change (DHCP) while names survive; pairing state keys off
 *    the name plus the pinned certificate from `net`'s first-use mode;
 *  - manual entry is always the fallback UI: browsers cannot browse mDNS
 *    at all, so every companion app treats
 *    `availability() === "unsupported"` as "show the host:port field",
 *    never as an error screen. The browser preview host therefore stays
 *    unsupported ON PURPOSE.
 *
 * Foreground-scoped like `net` (ADR-0027 v1): a browse stops when the
 * host says so or the app cancels it; no background discovery promises.
 */
import type {
  CapabilityAvailability,
  CapabilityCancelSignal,
  CapabilityResult,
  PermissionPrerequisite,
} from "./capability";

export const DISCOVERY_PERMISSIONS: readonly PermissionPrerequisite[] = [
  // android: CHANGE_WIFI_MULTICAST_STATE (normal, install-time — the
  // multicast lock held while browsing);
  // ios: none (Bonjour is local-network entitlement-scoped at runtime,
  // not a manifest permission); web: none — browsers cannot browse mDNS,
  // the shim is a manual-entry stub.
  { platform: "android", permissions: ["android.permission.CHANGE_WIFI_MULTICAST_STATE"] },
  { platform: "ios", permissions: [] },
  { platform: "web", permissions: [] },
];

/** Identity of a found service — the name survives DHCP address changes. */
export interface DiscoveredService {
  readonly serviceType: string; // e.g. "_androidtvremote2._tcp"
  readonly serviceName: string;
  readonly domain: string; // e.g. "local"
}

export interface DiscoveryBrowse {
  onServiceFound(listener: (service: DiscoveredService) => void): () => void;
  onServiceLost(listener: (service: DiscoveredService) => void): () => void;
  /** Idempotent; after stop no more services arrive. */
  stop(): void;
}

export interface ResolvedEndpoint {
  host: string;
  port: number;
  txt: Readonly<Record<string, string>>;
}

export interface DiscoveryCapability {
  readonly contractVersion: 1;
  availability(): CapabilityAvailability;
  permissionPrerequisites(): readonly PermissionPrerequisite[];
  browse(options: { serviceType: string; signal?: CapabilityCancelSignal }): Promise<
    CapabilityResult<DiscoveryBrowse>
  >;
  resolve(service: DiscoveredService): Promise<CapabilityResult<ResolvedEndpoint>>;
}

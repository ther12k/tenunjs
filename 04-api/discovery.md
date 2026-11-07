---
okf_version: 0.2
title: "Discovery capability — mDNS/NSD service browse"
summary: "Host capability for finding companion devices on the LAN: browse a service type with pushed results and idempotent stop, then resolve a service to host and port. Manual host:port entry stays application UI, not a capability."
type: reference
status: accepted
---

# Discovery capability

```ts
import type {
  CapabilityAvailability,
  CapabilityCancelSignal,
  CapabilityResult,
  PermissionPrerequisite,
} from "./capability";

export const DISCOVERY_PERMISSIONS: readonly PermissionPrerequisite[] = [
  // android: CHANGE_WIFI_MULTICAST_STATE (multicast lock while browsing);
  // ios: none (Bonjour is local-network entitlement-scoped at runtime, not a manifest permission);
  // web: none — browsers cannot browse mDNS; the shim is a manual-entry stub
];

export interface DiscoveredService {
  readonly serviceType: string; // e.g. "_androidtvremote2._tcp"
  readonly serviceName: string;
  readonly domain: string;      // e.g. "local"
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
  browse(options: { serviceType: string; signal?: CapabilityCancelSignal }):
    Promise<CapabilityResult<DiscoveryBrowse>>;
  resolve(service: DiscoveredService): Promise<CapabilityResult<ResolvedEndpoint>>;
}
```

## Semantics

- **Browse is event-driven and cancellable**, shaped like `ble.ts`
  scanning: results arrive through listeners, `stop()` is idempotent,
  and a cancelled signal stops the browse with no further events.
- **Resolve is separate from browse** because mDNS resolution can fail
  independently (the device left); a not-found result is structured, not
  a hang. Applications should resolve at connect time, not cache
  endpoints across sessions.
- **Service identity is `serviceName@domain`, not the endpoint** —
  addresses change (DHCP) while names survive; pairing state keys off
  the name plus the pinned certificate from `net`'s first-use mode.
- **Manual entry is always the fallback UI** in applications; browsers
  cannot browse mDNS at all, so every companion app treats
  `availability() === "unsupported"` as "show the host:port field",
  never as an error screen.
- **Never throws.**

## Host implementations

- **Android**: NsdManager with a multicast lock held while browsing.
- **iOS**: `NWBrowser` (Bonjour).
- **Browser preview**: unsupported stub by design; the fake-TV preview
  host of TN-191 instead offers its known local endpoint, so the
  authoring flow still exercises the app's connect path.

Specified by ADR-0027; implemented by TN-190.

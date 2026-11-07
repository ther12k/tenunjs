---
okf_version: 0.2
title: "Net capability — TCP and TLS sessions"
summary: "Host capability for a persistent connection to one device: TCP, optionally TLS with a keys-identity client certificate and either a pinned server fingerprint or first-use acceptance for pairing. Result types, tri-state link, pushed data events, idempotent close — the ble.ts quality bar."
type: reference
status: accepted
---

# Net capability

```ts
import type { CapabilityAvailability, CapabilityResult } from "./capability";

export const NET_PERMISSIONS: readonly PermissionPrerequisite[] = [
  // android: INTERNET; ios: none (Network.framework); web: none (shim)
];

export interface NetTlsOptions {
  /** keys-identity used as the TLS client certificate. */
  clientIdentity?: KeyHandle;
  /** SHA-256 of the pinned server certificate; absent = first-use mode. */
  expectedServerCertSha256?: string;
  /** SNI / hostname to verify when it differs from the connect host. */
  serverName?: string;
}

export interface NetConnectOptions {
  host: string;
  port: number;
  tls?: NetTlsOptions;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type NetLinkState = "offline" | "searching" | "linked";

export interface NetSession {
  /** Resolves after bytes are handed to the transport; backpressure is the host's. */
  write(data: Uint8Array): Promise<CapabilityResult<void>>;
  onData(listener: (chunk: Uint8Array) => void): () => void;
  onLinkStateChange(listener: (state: NetLinkState) => void): () => void;
  /** In first-use mode carries the peer cert SHA-256 for the app to pin. */
  onServerCertificate(listener: (sha256: string) => void): () => void;
  close(): Promise<CapabilityResult<void>>; // idempotent
}

export interface NetCapability {
  readonly contractVersion: 1;
  availability(): CapabilityAvailability;
  permissionPrerequisites(): readonly PermissionPrerequisite[];
  connect(options: NetConnectOptions): Promise<CapabilityResult<NetSession>>;
}
```

## Semantics

- **Never throws.** Every call returns a `CapabilityResult`; unsupported
  hosts return the fail-closed stub (TN-141).
- **Tri-state link**, the same states and meaning as `ble.ts`: a session
  moves `searching → linked` on connect, `→ offline` on close or
  transport loss; pending writes resolve as link-lost failures, not
  hangs.
- **First-use pairing mode.** With `expectedServerCertSha256` absent,
  the host accepts the peer certificate for this session only and
  reports its fingerprint through `onServerCertificate`; the application
  shows it, stores the pin in `storage` after the user confirms the
  on-device code, and passes it on every later connect. This is the
  client side of companion pairing; the on-device confirmation is the
  server's.
- **Sockets are foreground-scoped** (ADR-0027): what happens across
  background/foreground is host-documented; reconnection is application
  policy driven by the link state.
- **Binary end to end.** Payloads are `Uint8Array`, the same
  representation BLE notifications already use; framing and codecs
  (protobuf, line protocols) are application policy and stay out of the
  seam, exactly as `storage` keeps codecs out.

## Host implementations

- **Android**: `SSLSocket` / `Socket` behind the existing JNI
  host-service bridge; client identity from the Keystore via the
  `keys` capability's host side — the private key is used in place and
  never marshalled.
- **Browser preview**: a loopback WebSocket↔TCP proxy shim so authoring
  and headless tests run without hardware; TLS options are validated
  but the shim may terminate at the proxy.

Specified by ADR-0027; implemented by TN-188.

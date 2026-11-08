/**
 * Net capability contract — TCP and TLS sessions to one nearby device
 * (TN-188, specified by ADR-0027 and 04-api/net.md).
 *
 * Companion-device apps converse over a PERSISTENT connection: the Android
 * TV Remote v2 driver needs a TLS session the phone authenticates with a
 * keys-generated client certificate. The session shape mirrors `ble.ts`:
 * pushed data events, the tri-state link machine the UI renders, and
 * idempotent teardown.
 *
 * Semantics frozen with contractVersion 1:
 *  - never throws: every operation resolves to a CapabilityResult;
 *  - tri-state link: `searching` while connect is pending, `linked` when
 *    the session is handed over, `offline` on close or transport loss;
 *  - writes resolve once bytes are handed to the transport (backpressure
 *    is the host's); after link loss they fail `link-lost`, never hang;
 *  - first-use pairing: with no `expectedServerCertSha256` the host
 *    accepts the peer certificate FOR THIS SESSION ONLY and reports its
 *    SHA-256 through `onServerCertificate`; pinning it in `storage` and
 *    passing it on every later connect is application policy — the
 *    on-device confirmation code is the server's side of the pairing;
 *  - trust is pin/first-use, NOT WebPKI: companion devices present
 *    self-signed certificates the app pins on first sight, so the host
 *    performs no chain or hostname verification beyond the pin;
 *  - the receive side is bounded: the host may coalesce chunks but must
 *    cap bytes buffered ahead of the runtime — overflow is a `link-lost`
 *    failure, never silent truncation, never unbounded growth;
 *  - payloads are Uint8Array end to end; framing and codecs (protobuf,
 *    line protocols) are application policy, exactly as `storage` keeps
 *    codecs out.
 *
 * Sockets are foreground-scoped (ADR-0027 v1): behavior across background
 * is host-documented; reconnection is application policy driven by the
 * link state. The empty permission tiers are stated explicitly so tables
 * stay total; INTERNET is a normal install-time Android permission.
 */
import type {
  CapabilityAvailability,
  CapabilityCancelSignal,
  CapabilityResult,
  PermissionPrerequisite,
} from "./capability";

export const NET_PERMISSIONS: readonly PermissionPrerequisite[] = [
  // android: INTERNET (normal, install-time); ios: none (Network.framework); web: none (shim)
  { platform: "android", permissions: ["android.permission.INTERNET"] },
  { platform: "ios", permissions: [] },
  { platform: "web", permissions: [] },
];

export interface NetTlsOptions {
  /** keys-identity used as the TLS client certificate. */
  clientIdentity?: string;
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
  signal?: CapabilityCancelSignal;
}

/** Companion-app link machine the UI renders (the ble.ts states). */
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

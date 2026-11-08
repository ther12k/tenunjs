/**
 * Android native-host net capability: the TypeScript side of the TN-154
 * `tenun_host_call` bridge (TN-188).
 *
 * Sockets are asynchronous but the bridge is synchronous, so the wire is
 * split in two, the same split the BLE service already uses in production
 * (PolytronBleService → BLE_LINK/BLE_LINE dispatches):
 *
 *  1. REQUESTS (JS → host, synchronous `tenun_host_call("net", …)`):
 *       availability {}            → {"ok":true,"value":{"status":"supported"|…}}
 *       connect {host,port,tls?,timeoutMs?}
 *                                  → {"ok":true,"value":{"sessionId":"n:1"}} — the
 *                                    transport connects ASYNCHRONOUSLY; argument
 *                                    violations are refused synchronously
 *       write {sessionId,data:b64} → {"ok":true,"value":null} — bytes handed to
 *                                    the transport queue
 *       close {sessionId}          → {"ok":true,"value":null} — idempotent, and
 *                                    an unknown id is also ok (idempotency across
 *                                    the boundary must not depend on host memory)
 *
 *  2. EVENTS (host → JS, pushed as "NET_EVENT" dispatch actions into the
 *     bundle's dispatch handler, which routes them to
 *     `bridge.handleHostEvent(payloadJson)`):
 *       {"type":"connect","sessionId","ok":true}
 *       {"type":"connect","sessionId","ok":false,"failure":{"kind","message"}}
 *       {"type":"link","sessionId","state":"offline"}          (loss, overflow)
 *       {"type":"data","sessionId","data":"<b64 chunk>"}
 *       {"type":"serverCertificate","sessionId","sha256":"<hex>"}  (first-use only)
 *
 * The adapter turns that into the frozen `NetCapability` contract: the
 * connect Promise settles when the connect EVENT arrives (or when the
 * caller's cancel signal fires — cancellation is resolved JS-side without a
 * host round trip), session listeners fire from NET_EVENT pushes, and
 * everything is result-shaped with the frozen failure alphabet. A null
 * bridge reply means the host has no "net" service → `unsupported`; a
 * throwing bridge is `platform-error`.
 *
 * Ordering contract: per session, events are delivered in host order; a
 * listener registered on a live session observes its CURRENT state first
 * (and, in first-use mode, the already-delivered fingerprint) so an app
 * that subscribes right after `connect` resolves cannot miss the pairing
 * hash. Failure kinds pass through only from the frozen alphabet —
 * anything else is surfaced as platform-error rather than smuggled through.
 *
 * Dependency-free by policy (QuickJS-safe): base64 comes from the shared
 * bridge helpers in keys-native.ts; no Buffer, no btoa/atob, no timers —
 * the host owns connect timeouts and pushes the outcome.
 */
import type {
  CapabilityAvailability,
  CapabilityFailureKind,
  CapabilityResult,
} from "./capability";
import type { NetCapability, NetLinkState, NetSession } from "./net";
import { NET_PERMISSIONS } from "./net";
import { decodeBase64, encodeBase64 } from "./keys-native";
import {
  MAX_NET_WRITE_BYTES,
  netConnectArgumentError,
  validCertSha256,
} from "./net-validation";

/** The synchronous TN-154 bridge an app host injects globally. */
export type NetHostCall = (
  service: string,
  method: string,
  payloadJson: string
) => string | null;

/** The dispatch action name hosts use to push net events into the bundle. */
export const NET_EVENT_ACTION = "NET_EVENT";

/** The bridge bundle an app entry keeps for routing NET_EVENT dispatches. */
export interface HostNetBridge {
  readonly capability: NetCapability;
  /**
   * Routes one host-pushed NET_EVENT payload into its session. Returns
   * false when the payload is malformed or names an unknown session so a
   * host bug stays visible in dispatch logs instead of being swallowed.
   */
  handleHostEvent(payloadJson: string): boolean;
}

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
const linkLost = (message: string): CapabilityResult<never> => ({
  ok: false,
  failure: { kind: "link-lost", message },
});

/** A host reply's inner result, already validated against the alphabet. */
type NativeInner = { ok: true; value: unknown } | { ok: false; failure: { kind: CapabilityFailureKind; message?: string } };

function parseEnvelope(reply: string, method: string): CapabilityResult<NativeInner> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return platformError(`net.${method}: host returned non-JSON reply`);
  }
  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
    return platformError(`net.${method}: host reply is not a result envelope`);
  }
  const envelope = parsed as { ok: boolean; value?: unknown; failure?: { kind?: unknown; message?: unknown } };
  if (envelope.ok) return { ok: true, value: { ok: true, value: envelope.value } };
  const kind = envelope.failure?.kind;
  const message =
    typeof envelope.failure?.message === "string" ? envelope.failure.message : undefined;
  if (typeof kind !== "string" || !FAILURE_KINDS.includes(kind as CapabilityFailureKind)) {
    return platformError(`net.${method}: host failure kind is not in the frozen alphabet`);
  }
  return {
    ok: false,
    failure: { kind: kind as CapabilityFailureKind, message },
  };
}

type ListenerSet<T> = Set<(value: T) => void>;

interface SessionState {
  readonly id: string;
  closed: boolean;
  state: NetLinkState;
  readonly firstUse: boolean;
  /** Peer fingerprint captured before the session handoff (first-use only). */
  bufferedCertificate: string | null;
  readonly dataListeners: ListenerSet<Uint8Array>;
  readonly linkListeners: ListenerSet<NetLinkState>;
  readonly certificateListeners: ListenerSet<string>;
  settleConnect?: (result: CapabilityResult<NetSession>) => void;
}

/**
 * Builds the net capability over the native bridge. Pass the host's
 * injected `tenun_host_call` and keep the returned bridge so the bundle's
 * dispatch handler can route "NET_EVENT" actions into
 * `handleHostEvent`. The capability is fail-closed when the bridge is
 * missing or the host has no "net" service (null replies) — never a
 * fabricated success.
 */
export function createHostNetBridge(hostCall: NetHostCall): HostNetBridge {
  const sessions = new Map<string, SessionState>();

  const call = (method: string, payloadJson: string): CapabilityResult<string> => {
    let reply: string | null;
    try {
      reply = hostCall("net", method, payloadJson);
    } catch (error) {
      return platformError(`net.${method}: bridge threw ${String(error)}`);
    }
    if (reply === null || reply === undefined) {
      return unsupported(`net.${method}: this host has no net service`);
    }
    if (typeof reply !== "string") {
      return platformError(`net.${method}: bridge returned a non-string`);
    }
    return { ok: true, value: reply };
  };

  const closeOnHost = (id: string) => {
    // Best effort: the host tolerates unknown ids, and a failing close
    // during teardown must not mask the outcome the caller already has.
    try {
      hostCall("net", "close", JSON.stringify({ sessionId: id }));
    } catch {
      // The session is dead either way; surfaced through its own results.
    }
  };

  const goOffline = (session: SessionState) => {
    if (session.closed) return;
    session.closed = true;
    session.state = "offline";
    sessions.delete(session.id); // no host events may follow; a late push stays visible
    for (const listener of [...session.linkListeners]) listener("offline");
  };

  const makeSession = (session: SessionState): NetSession => ({
    async write(data) {
      if (!(data instanceof Uint8Array)) {
        return invalid("data must be a Uint8Array");
      }
      if (data.length > MAX_NET_WRITE_BYTES) {
        return invalid(`data exceeds ${MAX_NET_WRITE_BYTES} bytes`);
      }
      if (session.closed) {
        return linkLost("the session link is offline");
      }
      const reply = call("write", JSON.stringify({
        sessionId: session.id,
        data: encodeBase64(data),
      }));
      if (!reply.ok) return reply;
      const envelope = parseEnvelope(reply.value, "write");
      if (!envelope.ok) {
        // The host's own failure already says why; a dead link also ends
        // event delivery locally so listeners see offline exactly once.
        if (envelope.failure.kind === "link-lost") goOffline(session);
        return envelope;
      }
      return { ok: true, value: undefined };
    },
    onData(listener) {
      session.dataListeners.add(listener);
      return () => {
        session.dataListeners.delete(listener);
      };
    },
    onLinkStateChange(listener) {
      session.linkListeners.add(listener);
      // Replay-on-register: the session is handed over already linked (or
      // offline), and subscribing late must not mean missing that fact.
      listener(session.state);
      return () => {
        session.linkListeners.delete(listener);
      };
    },
    onServerCertificate(listener) {
      session.certificateListeners.add(listener);
      if (session.firstUse && session.bufferedCertificate !== null) {
        listener(session.bufferedCertificate);
      }
      return () => {
        session.certificateListeners.delete(listener);
      };
    },
    async close() {
      if (!session.closed) {
        closeOnHost(session.id);
        goOffline(session);
      }
      return { ok: true, value: undefined }; // idempotent
    },
  });

  const handleHostEvent = (payloadJson: string): boolean => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadJson);
    } catch {
      return false;
    }
    if (typeof parsed !== "object" || parsed === null) return false;
    const event = parsed as Record<string, unknown>;
    const sessionId = event.sessionId;
    if (typeof sessionId !== "string") return false;
    const session = sessions.get(sessionId);
    if (session === undefined) return false;
    switch (event.type) {
      case "connect": {
        const settle = session.settleConnect;
        if (settle === undefined) return false; // duplicate or late connect event
        if (event.ok === true) {
          session.state = "linked";
          settle({ ok: true, value: makeSession(session) });
        } else {
          sessions.delete(sessionId);
          const failure = event.failure as { kind?: unknown; message?: unknown } | undefined;
          if (
            typeof failure?.kind !== "string" ||
            !FAILURE_KINDS.includes(failure.kind as CapabilityFailureKind)
          ) {
            settle(platformError("net.connect: host connect failure kind is not in the frozen alphabet"));
          } else {
            settle({
              ok: false,
              failure: {
                kind: failure.kind as CapabilityFailureKind,
                message: typeof failure.message === "string" ? failure.message : undefined,
              },
            });
          }
        }
        return true;
      }
      case "link": {
        if (event.state !== "offline") return false; // linked is implied by connect-ok
        const pending = session.settleConnect;
        if (pending !== undefined) {
          // Transport died before the connect event arrived — settle it.
          session.settleConnect = undefined;
          sessions.delete(sessionId);
          pending(linkLost("the transport was lost before the session was established"));
        }
        goOffline(session);
        return true;
      }
      case "data": {
        if (session.closed) return true; // drained, not dead: post-loss bytes are dropped
        if (session.settleConnect !== undefined) return false; // impossible order; keep visible
        if (typeof event.data !== "string") return false;
        const chunk = decodeBase64(event.data);
        if (chunk === null) return false;
        for (const listener of [...session.dataListeners]) listener(chunk);
        return true;
      }
      case "serverCertificate": {
        if (typeof event.sha256 !== "string" || !validCertSha256(event.sha256)) return false;
        session.bufferedCertificate = event.sha256.toLowerCase();
        for (const listener of [...session.certificateListeners]) listener(session.bufferedCertificate);
        return true;
      }
      default:
        return false;
    }
  };

  const capability: NetCapability = {
    contractVersion: 1,

    availability() {
      const reply = call("availability", "{}");
      if (!reply.ok) return { status: "unsupported", reason: reply.failure.message };
      const envelope = parseEnvelope(reply.value, "availability");
      if (!envelope.ok) return { status: "unavailable", reason: envelope.failure.message };
      if (!envelope.value.ok) return { status: "unavailable", reason: "net.availability: malformed status" };
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
      return { status: "unavailable", reason: "net.availability: malformed status" };
    },

    permissionPrerequisites: () => NET_PERMISSIONS,

    async connect(options) {
      const argumentError = netConnectArgumentError(options);
      if (argumentError !== null) return invalid(argumentError);
      const payload: Record<string, unknown> = { host: options.host, port: options.port };
      if (options.timeoutMs !== undefined) payload.timeoutMs = options.timeoutMs;
      if (options.tls !== undefined) {
        const tls: Record<string, unknown> = {};
        if (options.tls.clientIdentity !== undefined) {
          tls.clientIdentity = options.tls.clientIdentity;
        }
        if (options.tls.expectedServerCertSha256 !== undefined) {
          tls.expectedServerCertSha256 = options.tls.expectedServerCertSha256;
        }
        if (options.tls.serverName !== undefined) tls.serverName = options.tls.serverName;
        payload.tls = tls;
      }
      const reply = call("connect", JSON.stringify(payload));
      if (!reply.ok) return reply;
      const envelope = parseEnvelope(reply.value, "connect");
      if (!envelope.ok) return envelope;
      if (!envelope.value.ok) return { ok: false, failure: envelope.value.failure };
      const value = envelope.value.value as { sessionId?: unknown } | undefined;
      if (typeof value?.sessionId !== "string" || value.sessionId.length === 0) {
        return platformError("net.connect: malformed session id in host reply");
      }
      const session: SessionState = {
        id: value.sessionId,
        closed: false,
        state: "searching",
        firstUse: options.tls?.expectedServerCertSha256 === undefined,
        bufferedCertificate: null,
        dataListeners: new Set(),
        linkListeners: new Set(),
        certificateListeners: new Set(),
      };
      sessions.set(session.id, session);
      const signal = options.signal;
      return await new Promise<CapabilityResult<NetSession>>((resolve) => {
        let settled = false;
        let offAbort: () => void = () => undefined;
        const settle = (result: CapabilityResult<NetSession>) => {
          if (settled) return;
          settled = true;
          session.settleConnect = undefined;
          offAbort();
          resolve(result);
        };
        session.settleConnect = settle;
        // Cancellation settles JS-side: the caller's signal notifies inside
        // their cancel() call (an already-aborted signal notifies during
        // registration), so the Promise resolves without a host push. The
        // host session is closed best-effort behind it.
        if (signal) {
          offAbort = signal.addAbortListener(() => {
            if (session.settleConnect !== undefined) {
              sessions.delete(session.id);
              session.closed = true;
              closeOnHost(session.id);
              settle({
                ok: false,
                failure: {
                  kind: "cancelled",
                  message: "connect was cancelled before the session was established",
                },
              });
            }
          });
        }
      });
    },
  };

  return { capability, handleHostEvent };
}

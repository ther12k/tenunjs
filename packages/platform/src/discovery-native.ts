/**
 * Android native-host discovery capability: the TypeScript side of the
 * TN-154 `tenun_host_call` bridge (TN-190).
 *
 * Browsing/resolution are asynchronous but the bridge is synchronous, so
 * the wire is split the same way the net service splits it:
 *
 *  1. REQUESTS (JS → host, synchronous `tenun_host_call("discovery", …)`):
 *       availability {}      → {"ok":true,"value":{"status":"supported"|…}}
 *       browse {serviceType} → {"ok":true,"value":{"browseId":"d:1"}} — the
 *                              browse starts ASYNCHRONOUSLY; argument
 *                              violations are refused synchronously
 *       stop {browseId}      → {"ok":true,"value":null} — idempotent, and
 *                              an unknown id is also ok (idempotency across
 *                              the boundary must not depend on host memory)
 *       resolve {service:{serviceType,serviceName,domain}}
 *                            → {"ok":true,"value":{"resolveId":"r:1"}} —
 *                              resolution runs asynchronously and settles
 *                              through a resolve event (mDNS resolution
 *                              can fail independently of browsing)
 *
 *  2. EVENTS (host → JS, pushed as "DISCOVERY_EVENT" dispatch actions into
 *     the bundle's dispatch handler, which routes them to
 *     `bridge.handleHostEvent(payloadJson)`):
 *       {"type":"serviceFound","browseId","service":{serviceType,serviceName,domain}}
 *       {"type":"serviceLost","browseId","service":{…}}
 *       {"type":"browseStopped","browseId","reason"?}     (host-side stop)
 *       {"type":"resolve","resolveId","ok":true,"host","port","txt":{…}}
 *       {"type":"resolve","resolveId","ok":false,"failure":{"kind","message"}}
 *
 * The adapter turns that into the frozen `DiscoveryCapability` contract:
 * the browse Promise resolves at the FIRST event for its browseId (browse
 * started) — or a connect-refusal-style synchronous failure — while
 * services flow through listeners; the resolve Promise settles when the
 * resolve EVENT arrives (or when the caller's cancel signal fires —
 * cancellation is resolved JS-side without a host round trip). A null
 * bridge reply means the host has no "discovery" service → `unsupported`;
 * a throwing bridge is `platform-error`.
 *
 * Ordering contract: per browse, events arrive in host order; a listener
 * registered on a live browse observes services from registration onward
 * only (browsing is live state, not replayable history — unlike net's
 * link state). Failure kinds pass through only from the frozen alphabet.
 *
 * Dependency-free by policy (QuickJS-safe): no Buffer, no timers — the
 * host owns browse/resolve timeouts and pushes the outcomes.
 */
import type {
  CapabilityAvailability,
  CapabilityFailureKind,
  CapabilityResult,
} from "./capability";
import type { DiscoveryBrowse, DiscoveryCapability, DiscoveredService } from "./discovery";
import { DISCOVERY_PERMISSIONS } from "./discovery";
import {
  discoveryBrowseArgumentError,
  isDiscoveredService,
  validTxtRecord,
} from "./discovery-validation";

/** The synchronous TN-154 bridge an app host injects globally. */
export type DiscoveryHostCall = (
  service: string,
  method: string,
  payloadJson: string
) => string | null;

/** The dispatch action name hosts use to push discovery events into the bundle. */
export const DISCOVERY_EVENT_ACTION = "DISCOVERY_EVENT";

/** The bridge bundle an app entry keeps for routing DISCOVERY_EVENT dispatches. */
export interface HostDiscoveryBridge {
  readonly capability: DiscoveryCapability;
  /**
   * Routes one host-pushed DISCOVERY_EVENT payload into its browse/resolve.
   * Returns false when the payload is malformed or names an unknown
   * browse/resolve id so a host bug stays visible in dispatch logs.
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

/** A host reply's inner result, already validated against the alphabet. */
type NativeInner =
  | { ok: true; value: unknown }
  | { ok: false; failure: { kind: CapabilityFailureKind; message?: string } };

function parseEnvelope(reply: string, method: string): CapabilityResult<NativeInner> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return platformError(`discovery.${method}: host returned non-JSON reply`);
  }
  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
    return platformError(`discovery.${method}: host reply is not a result envelope`);
  }
  const envelope = parsed as { ok: boolean; value?: unknown; failure?: { kind?: unknown; message?: unknown } };
  if (envelope.ok) return { ok: true, value: { ok: true, value: envelope.value } };
  const kind = envelope.failure?.kind;
  const message =
    typeof envelope.failure?.message === "string" ? envelope.failure.message : undefined;
  if (typeof kind !== "string" || !FAILURE_KINDS.includes(kind as CapabilityFailureKind)) {
    return platformError(`discovery.${method}: host failure kind is not in the frozen alphabet`);
  }
  return {
    ok: false,
    failure: { kind: kind as CapabilityFailureKind, message },
  };
}

type ListenerSet<T> = Set<(value: T) => void>;

interface BrowseState {
  readonly id: string;
  stopped: boolean;
  readonly foundListeners: ListenerSet<DiscoveredService>;
  readonly lostListeners: ListenerSet<DiscoveredService>;
  settleStart?: (result: CapabilityResult<DiscoveryBrowse>) => void;
  /** Detaches the caller's cancel listener; runs at browse teardown. */
  detachCancel?: () => void;
}

interface ResolveState {
  readonly id: string;
  settle?: (result: CapabilityResult<unknown>) => void;
}

/**
 * Builds the discovery capability over the native bridge. Pass the host's
 * injected `tenun_host_call` and keep the returned bridge so the bundle's
 * dispatch handler can route "DISCOVERY_EVENT" actions into
 * `handleHostEvent`. The capability is fail-closed when the bridge is
 * missing or the host has no "discovery" service (null replies) — never
 * a fabricated success.
 */
export function createHostDiscoveryBridge(hostCall: DiscoveryHostCall): HostDiscoveryBridge {
  const browses = new Map<string, BrowseState>();
  const resolves = new Map<string, ResolveState>();

  const call = (method: string, payloadJson: string): CapabilityResult<string> => {
    let reply: string | null;
    try {
      reply = hostCall("discovery", method, payloadJson);
    } catch (error) {
      return platformError(`discovery.${method}: bridge threw ${String(error)}`);
    }
    if (reply === null || reply === undefined) {
      return unsupported(`discovery.${method}: this host has no discovery service`);
    }
    if (typeof reply !== "string") {
      return platformError(`discovery.${method}: bridge returned a non-string`);
    }
    return { ok: true, value: reply };
  };

  const stopOnHost = (id: string) => {
    // Best effort: the host tolerates unknown ids, and a failing stop
    // during cancellation must not mask the outcome the caller already has.
    try {
      hostCall("discovery", "stop", JSON.stringify({ browseId: id }));
    } catch {
      // The browse is dead to JS either way; events for a removed id are
      // rejected by handleHostEvent instead of reaching listeners.
    }
  };

  const stopBrowse = (browse: BrowseState) => {
    if (browse.stopped) return;
    browse.stopped = true;
    browses.delete(browse.id); // no host events may follow; a late push stays visible
    browse.detachCancel?.();
  };

  const makeBrowse = (browse: BrowseState): DiscoveryBrowse => ({
    onServiceFound(listener) {
      browse.foundListeners.add(listener);
      return () => {
        browse.foundListeners.delete(listener);
      };
    },
    onServiceLost(listener) {
      browse.lostListeners.add(listener);
      return () => {
        browse.lostListeners.delete(listener);
      };
    },
    stop() {
      if (!browse.stopped) {
        stopOnHost(browse.id);
        stopBrowse(browse);
      }
      // idempotent by design: after stop no more services arrive
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
    switch (event.type) {
      case "serviceFound":
      case "serviceLost": {
        const browseId = event.browseId;
        if (typeof browseId !== "string") return false;
        const browse = browses.get(browseId);
        if (browse === undefined) return false;
        if (!isDiscoveredService(event.service)) return false;
        const listeners =
          event.type === "serviceFound" ? browse.foundListeners : browse.lostListeners;
        for (const listener of [...listeners]) listener(event.service);
        return true;
      }
      case "browseStarted": {
        const browseId = event.browseId;
        if (typeof browseId !== "string") return false;
        const browse = browses.get(browseId);
        if (browse === undefined) return false;
        const settle = browse.settleStart;
        if (settle === undefined) return false; // duplicate browseStarted
        browse.settleStart = undefined;
        settle({ ok: true, value: makeBrowse(browse) });
        return true;
      }
      case "browseStopped": {
        // The host ended the browse (failure or teardown): settle a still-
        // pending start with the host's failure, then silence the browse.
        const browseId = event.browseId;
        if (typeof browseId !== "string") return false;
        const browse = browses.get(browseId);
        if (browse === undefined) return false;
        const failure = event.failure as { kind?: unknown; message?: unknown } | undefined;
        const pending = browse.settleStart;
        if (pending !== undefined) {
          browse.settleStart = undefined;
          if (
            typeof failure?.kind !== "string" ||
            !FAILURE_KINDS.includes(failure.kind as CapabilityFailureKind)
          ) {
            pending(platformError("discovery.browse: host stop failure kind is not in the frozen alphabet"));
          } else {
            pending({
              ok: false,
              failure: {
                kind: failure.kind as CapabilityFailureKind,
                message: typeof failure.message === "string" ? failure.message : undefined,
              },
            });
          }
        }
        stopBrowse(browse);
        return true;
      }
      case "resolve": {
        const resolveId = event.resolveId;
        if (typeof resolveId !== "string") return false;
        const resolve = resolves.get(resolveId);
        if (resolve === undefined) return false;
        const settle = resolve.settle;
        if (settle === undefined) return false; // duplicate or late resolve event
        resolve.settle = undefined;
        resolves.delete(resolveId);
        if (event.ok !== true) {
          const failure = event.failure as { kind?: unknown; message?: unknown } | undefined;
          if (
            typeof failure?.kind !== "string" ||
            !FAILURE_KINDS.includes(failure.kind as CapabilityFailureKind)
          ) {
            settle(platformError("discovery.resolve: host failure kind is not in the frozen alphabet"));
          } else {
            settle({
              ok: false,
              failure: {
                kind: failure.kind as CapabilityFailureKind,
                message: typeof failure.message === "string" ? failure.message : undefined,
              },
            });
          }
          return true;
        }
        const host = event.host;
        const port = event.port;
        const txt = event.txt ?? {};
        if (
          typeof host !== "string" ||
          host.length === 0 ||
          typeof port !== "number" ||
          !Number.isInteger(port) ||
          port < 1 ||
          port > 65535 ||
          !validTxtRecord(txt)
        ) {
          settle(platformError("discovery.resolve: malformed endpoint in host reply"));
          return true; // the event was for a known resolve; the outcome is a visible failure
        }
        settle({ ok: true, value: { host, port, txt } });
        return true;
      }
      default:
        return false;
    }
  };

  const capability: DiscoveryCapability = {
    contractVersion: 1,

    availability() {
      const reply = call("availability", "{}");
      if (!reply.ok) return { status: "unsupported", reason: reply.failure.message };
      const envelope = parseEnvelope(reply.value, "availability");
      if (!envelope.ok) return { status: "unavailable", reason: envelope.failure.message };
      if (!envelope.value.ok) return { status: "unavailable", reason: "discovery.availability: malformed status" };
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
      return { status: "unavailable", reason: "discovery.availability: malformed status" };
    },

    permissionPrerequisites: () => DISCOVERY_PERMISSIONS,

    async browse(options) {
      const argumentError = discoveryBrowseArgumentError(options);
      if (argumentError !== null) return invalid(argumentError);
      const reply = call("browse", JSON.stringify({ serviceType: options.serviceType }));
      if (!reply.ok) return reply;
      const envelope = parseEnvelope(reply.value, "browse");
      if (!envelope.ok) return envelope;
      if (!envelope.value.ok) return { ok: false, failure: envelope.value.failure };
      const value = envelope.value.value as { browseId?: unknown } | undefined;
      if (typeof value?.browseId !== "string" || value.browseId.length === 0) {
        return platformError("discovery.browse: malformed browse id in host reply");
      }
      const browse: BrowseState = {
        id: value.browseId,
        stopped: false,
        foundListeners: new Set(),
        lostListeners: new Set(),
      };
      browses.set(browse.id, browse);
      const signal = options.signal;
      return await new Promise<CapabilityResult<DiscoveryBrowse>>((resolve) => {
        let settled = false;
        const settle = (result: CapabilityResult<DiscoveryBrowse>) => {
          if (settled) return;
          settled = true;
          browse.settleStart = undefined;
          resolve(result);
          // The abort listener STAYS attached after a successful start:
          // cancelling a live browse must silence it (the frozen contract).
          // stopBrowse detaches it at teardown.
        };
        browse.detachCancel = () => undefined;
        browse.settleStart = settle;
        // Cancellation settles JS-side: the caller's signal notifies inside
        // their cancel() call (an already-aborted signal notifies during
        // registration), so the Promise resolves without a host push. The
        // host browse is stopped best-effort behind it — and per the frozen
        // contract, cancelling AFTER the browse started also silences it:
        // no further events for a caller that walked away.
        if (signal) {
          browse.detachCancel = signal.addAbortListener(() => {
            if (browse.settleStart !== undefined) {
              settle({
                ok: false,
                failure: {
                  kind: "cancelled",
                  message: "browse was cancelled before it started",
                },
              });
            }
            stopOnHost(browse.id);
            stopBrowse(browse);
          });
        }
      });
    },

    async resolve(service) {
      if (!isDiscoveredService(service)) {
        return invalid(
          "service must carry serviceType (_name._tcp|_name._udp), serviceName (1..63 UTF-8 bytes), and domain"
        );
      }
      const reply = call(
        "resolve",
        JSON.stringify({
          service: {
            serviceType: service.serviceType,
            serviceName: service.serviceName,
            domain: service.domain,
          },
        })
      );
      if (!reply.ok) return reply;
      const envelope = parseEnvelope(reply.value, "resolve");
      if (!envelope.ok) return envelope;
      if (!envelope.value.ok) return { ok: false, failure: envelope.value.failure };
      const value = envelope.value.value as { resolveId?: unknown } | undefined;
      if (typeof value?.resolveId !== "string" || value.resolveId.length === 0) {
        return platformError("discovery.resolve: malformed resolve id in host reply");
      }
      const state: ResolveState = { id: value.resolveId };
      resolves.set(state.id, state);
      return await new Promise<CapabilityResult<{ host: string; port: number; txt: Record<string, string> }>>(
        (resolve) => {
          state.settle = (result) => resolve(result as never);
        }
      );
    },
  };

  return { capability, handleHostEvent };
}

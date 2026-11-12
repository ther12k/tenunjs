/** TN-190 device fixture: compile the PUBLIC adapter, never a bridge facsimile. */
import {
  createCancelSource,
  createHostDiscoveryBridge,
  type CapabilityResult,
  type DiscoveryHostCall,
  type DiscoveryBrowse,
  type DiscoveredService,
} from "@tenunjs/platform";

const host = globalThis as typeof globalThis & {
  tenun_host_call?: unknown;
  Buffer?: unknown;
  atob?: unknown;
  btoa?: unknown;
  __tenun_dispatch_action?: (action: string, payloadJson: string) => string;
};

function isHostCall(value: unknown): value is DiscoveryHostCall {
  return typeof value === "function";
}

const hostCall = host.tenun_host_call;
if (!isHostCall(hostCall)) throw new Error("discovery fixture requires the native host bridge");
const bridge = createHostDiscoveryBridge(hostCall);

let completed: string | undefined;
let browse: DiscoveryBrowse | undefined;
let cancelSource: ReturnType<typeof createCancelSource> | undefined;

interface RecordedEvent {
  k: "found" | "lost" | "resolved";
  n?: string; // serviceName
  t?: string; // serviceType
  d?: string; // domain
  h?: string; // resolved host
  p?: number; // resolved port
  x?: Record<string, string>; // resolved txt
}
const events: RecordedEvent[] = [];

function attach(live: DiscoveryBrowse): void {
  live.onServiceFound((service) => events.push({ k: "found", n: service.serviceName, t: service.serviceType, d: service.domain }));
  live.onServiceLost((service) => events.push({ k: "lost", n: service.serviceName, t: service.serviceType, d: service.domain }));
}

function start<T>(operation: Promise<CapabilityResult<T>>, normalize: (value: T) => unknown): string {
  completed = undefined;
  // JNI accepts a synchronous string, NOT a Promise. Pending-job drains (the
  // browse/resolve settle path crosses several dispatches: DISCOVERY_EVENT
  // pushes resolve the promise; a later synchronous dispatch reads the result).
  void operation.then(
    (result) => {
      completed = JSON.stringify(result.ok ? { ok: true, value: normalize(result.value) } : result);
    },
    (error: unknown) => {
      completed = JSON.stringify({ fixtureError: String(error) });
    },
  );
  return JSON.stringify({ pending: true });
}

host.__tenun_dispatch_action = (action, payloadJson) => {
  if (action === "result") return completed ?? JSON.stringify({ pending: true });
  if (action === "events") return JSON.stringify({ events });
  if (action === "cancel") {
    cancelSource?.cancel("fixture cancel");
    return JSON.stringify({ ok: true });
  }
  if (action === "metadata") {
    return JSON.stringify({
      contractVersion: bridge.capability.contractVersion,
      availability: bridge.capability.availability(),
      permissions: bridge.capability.permissionPrerequisites(),
      globals: { Buffer: typeof host.Buffer, atob: typeof host.atob, btoa: typeof host.btoa },
    });
  }
  const payload = JSON.parse(payloadJson) as {
    serviceType?: string;
    cancel?: boolean;
    service?: DiscoveredService;
  };
  switch (action) {
    case "DISCOVERY_EVENT":
      // The production host pushes events as dispatch actions routed here.
      return JSON.stringify(bridge.handleHostEvent(payloadJson));
    case "browse": {
      cancelSource = payload.cancel ? createCancelSource() : undefined;
      return start(
        bridge.capability.browse({ serviceType: payload.serviceType!, signal: cancelSource }),
        (live) => {
          browse = live;
          attach(live);
          return { browse: true };
        },
      );
    }
    case "stop":
      if (browse === undefined) throw new Error("no browse");
      browse.stop();
      return JSON.stringify({ ok: true });
    case "resolve":
      return start(bridge.capability.resolve(payload.service!), (endpoint) => {
        events.push({ k: "resolved", h: endpoint.host, p: endpoint.port, x: { ...endpoint.txt } });
        return { host: endpoint.host, port: endpoint.port, txt: endpoint.txt };
      });
    default:
      throw new Error(`unknown discovery fixture action: ${action}`);
  }
};

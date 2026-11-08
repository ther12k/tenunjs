/** TN-188 device fixture: compile the PUBLIC adapter, never a bridge facsimile. */
import {
  createCancelSource,
  createHostNetBridge,
  type CapabilityResult,
  type NetHostCall,
  type NetSession,
} from "@tenunjs/platform";

const host = globalThis as typeof globalThis & {
  tenun_host_call?: unknown;
  Buffer?: unknown;
  atob?: unknown;
  btoa?: unknown;
  __tenun_dispatch_action?: (action: string, payloadJson: string) => string;
};

function isHostCall(value: unknown): value is NetHostCall {
  return typeof value === "function";
}

const hostCall = host.tenun_host_call;
if (!isHostCall(hostCall)) throw new Error("net fixture requires the native host bridge");
const bridge = createHostNetBridge(hostCall);

let completed: string | undefined;
let session: NetSession | undefined;
let cancelSource: ReturnType<typeof createCancelSource> | undefined;

interface RecordedEvent {
  k: "data" | "link" | "cert";
  b?: number[];
  s?: string;
  h?: string;
}
const events: RecordedEvent[] = [];

function attach(live: NetSession): void {
  live.onData((chunk) => events.push({ k: "data", b: Array.from(chunk) }));
  live.onLinkStateChange((state) => events.push({ k: "link", s: state }));
  live.onServerCertificate((sha) => events.push({ k: "cert", h: sha }));
}

function start<T>(operation: Promise<CapabilityResult<T>>, normalize: (value: T) => unknown): string {
  completed = undefined;
  // JNI accepts a synchronous string, NOT a Promise. Pending-job drains (the
  // connect/settle path crosses several dispatches: NET_EVENT pushes resolve
  // the connect promise; a later synchronous dispatch reads the result).
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
    host: string;
    port: number;
    timeoutMs?: number;
    cancel?: boolean;
    tls?: { clientIdentity?: string; expectedServerCertSha256?: string; serverName?: string };
    data?: number[];
  };
  switch (action) {
    case "NET_EVENT":
      // The production host pushes events as dispatch actions routed here.
      return JSON.stringify(bridge.handleHostEvent(payloadJson));
    case "connect": {
      cancelSource = payload.cancel ? createCancelSource() : undefined;
      return start(
        bridge.capability.connect({
          host: payload.host,
          port: payload.port,
          timeoutMs: payload.timeoutMs,
          tls: payload.tls,
          signal: cancelSource,
        }),
        (live) => {
          session = live;
          attach(live);
          return { session: true };
        },
      );
    }
    case "write":
      if (session === undefined) throw new Error("no session");
      return start(session.write(new Uint8Array(payload.data ?? [])), () => null);
    case "close":
      if (session === undefined) throw new Error("no session");
      return start(session.close(), () => null);
    default:
      throw new Error(`unknown net fixture action: ${action}`);
  }
};

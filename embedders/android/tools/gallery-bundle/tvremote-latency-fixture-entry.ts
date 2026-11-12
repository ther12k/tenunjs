/** TN-192 device fixture: TvRemoteRuntime over the compiled public net adapter. */
import { createHostNetBridge, type NetHostCall } from "@tenunjs/platform";
import { TvRemoteRuntime } from "../../../../examples/tvremote/src/runtime";
import { LatencyRecorder, digestToJson } from "../../../../examples/tvremote/src/latency";
import { RemoteKeyCode, RemoteDirection, type RemoteDirectionVal } from "../../../../examples/tvremote/src/protocol";

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
if (!isHostCall(hostCall)) throw new Error("tvremote latency fixture requires the native host bridge");
const bridge = createHostNetBridge(hostCall);

const latency = new LatencyRecorder();
let runtime: TvRemoteRuntime | null = null;

let completed: string | undefined;

function start<T>(operation: Promise<T>, normalize: (value: T) => unknown): string {
  completed = undefined;
  void operation.then(
    (result) => {
      completed = JSON.stringify({ ok: true, value: normalize(result) });
    },
    (error: unknown) => {
      completed = JSON.stringify({ ok: false, fixtureError: String(error) });
    },
  );
  return JSON.stringify({ pending: true });
}

host.__tenun_dispatch_action = (action, payloadJson) => {
  if (action === "result") return completed ?? JSON.stringify({ pending: true });
  if (action === "digest") {
    // The digest travels as a STRING field so the Kotlin test parses it
    // with JSONObject(String) — android.jar's JSONObject has no
    // single-argument JSONObject copy constructor.
    const digest = runtime?.hostLatency()?.digest();
    return JSON.stringify({ digest: digest ? digestToJson(digest) : null });
  }
  if (action === "pending") return JSON.stringify({ pending: runtime?.hostLatency()?.pendingCount() ?? 0, dropped: runtime?.hostLatency()?.droppedCount() ?? 0 });
  if (action === "link") return JSON.stringify({ phase: runtime?.linkPhase() ?? "offline" });
  if (action === "metadata") {
    return JSON.stringify({
      contractVersion: bridge.capability.contractVersion,
      availability: bridge.capability.availability(),
      globals: { Buffer: typeof host.Buffer, atob: typeof host.atob, btoa: typeof host.btoa },
    });
  }
  const payload = JSON.parse(payloadJson) as {
    host?: string;
    port?: number;
    keyCode?: number;
    direction?: number;
  };

  switch (action) {
    case "NET_EVENT":
      // NetService pushes ride the same channel as production MainActivity.
      return JSON.stringify(bridge.handleHostEvent(payloadJson));
    case "connect": {
      runtime = new TvRemoteRuntime(
        { net: bridge.capability, latency },
        { initialRoute: "remote" },
      );
      (runtime as unknown as { activeTv: unknown }).activeTv = {
        name: "Gate Echo TV",
        host: payload.host ?? "10.0.2.2",
        port: payload.port ?? 6466,
      };
      return start(runtime.connectRemoteSession(), () => ({ connected: true }));
    }
    case "press": {
      if (!runtime) throw new Error("connect first");
      return start(
        runtime.sendKey(
          payload.keyCode ?? RemoteKeyCode.KEYCODE_DPAD_UP,
          (payload.direction ?? RemoteDirection.SHORT) as RemoteDirectionVal,
        ),
        () => ({ pressed: true }),
      );
    }
    default:
      throw new Error(`unknown tvremote latency fixture action: ${action}`);
  }
};

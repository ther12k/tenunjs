/**
 * TN-154 native host entry for the Polytron Wash companion app:
 * Packages WasherRuntime for native Android execution in QuickJS
 * with JNI Host Service Bridge for Bluetooth Low Energy and native Canvas rendering.
 */
import { installHostHandoff } from "@tenunjs/widgets";
import { WasherRuntime, type BleSeam } from "../../../../examples/polytron/src/runtime";
import { withChrome } from "../../../../examples/polytron/src/chrome";
import { PROGRAM_SLOTS } from "../../../../examples/polytron/src/protocol";

const host = globalThis as Record<string, unknown>;

interface ActiveTimer {
  id: number;
  runAt: number;
  fn: () => void;
}

let nextTimerId = 1;
const activeTimers = new Map<number, ActiveTimer>();

function drainTimers(): void {
  const now = Date.now();
  for (const [id, t] of Array.from(activeTimers.entries())) {
    if (now >= t.runAt) {
      activeTimers.delete(id);
      try {
        t.fn();
      } catch (e) {
        // Continue draining
      }
    }
  }
}

// QuickJS timer shim for command timeout guards & async operations
if (typeof (host as { setTimeout?: unknown }).setTimeout !== "function") {
  (host as { setTimeout: (fn: () => void, ms?: number) => number }).setTimeout = (
    fn: () => void,
    ms: number = 0
  ) => {
    const id = nextTimerId++;
    const delay = Math.max(0, ms);
    activeTimers.set(id, { id, runAt: Date.now() + delay, fn });
    if (typeof host.tenun_host_call === "function") {
      try {
        (host.tenun_host_call as (s: string, m: string, p: string) => string | null)(
          "system",
          "scheduleTimer",
          JSON.stringify({ delayMs: delay })
        );
      } catch {
        // Host scheduler optional; dispatch entry drains automatically
      }
    }
    return id;
  };
  (host as { clearTimeout: (id: number) => void }).clearTimeout = (id: number) => {
    activeTimers.delete(id);
  };
}

const nativeBleBridge: BleSeam = {
  supported: () => {
    if (typeof host.tenun_host_call === "function") {
      const res = (host.tenun_host_call as (svc: string, method: string, payload: string) => string | null)(
        "ble",
        "supported",
        "{}"
      );
      return res === "true" || res === "1";
    }
    return false;
  },
  connect: async () => {
    if (typeof host.tenun_host_call === "function") {
      const res = (host.tenun_host_call as (svc: string, method: string, payload: string) => string | null)(
        "ble",
        "connect",
        "{}"
      );
      const ok = res === "true" || res === "1";
      if (!ok) {
        // Host refused synchronously (no adapter etc.) and no event will
        // follow — release the connecting lock ourselves, whoever called
        // (header row on any tab).
        app.linkPush({ connected: false, connecting: false, phase: null });
      }
      return ok;
    }
    app.linkPush({ connected: false, connecting: false, phase: null });
    return false;
  },
  disconnect: () => {
    if (typeof host.tenun_host_call === "function") {
      (host.tenun_host_call as (svc: string, method: string, payload: string) => string | null)(
        "ble",
        "disconnect",
        "{}"
      );
    }
  },
  write: async (cmd: string) => {
    if (typeof host.tenun_host_call === "function") {
      const res = (host.tenun_host_call as (svc: string, method: string, payload: string) => string | null)(
        "ble",
        "write",
        JSON.stringify({ cmd })
      );
      return res === "true" || res === "1";
    }
    return false;
  },
};

const clockNow = (): string | null => {
  if (typeof host.tenun_host_call === "function") {
    const res = (host.tenun_host_call as (svc: string, method: string, payload: string) => string | null)(
      "system",
      "clockNow",
      "{}"
    );
    if (res && res !== "null") return res;
  }
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const editProgram = async (slot: number, current: string): Promise<string | null> => {
  if (typeof host.tenun_host_call === "function") {
    const res = (host.tenun_host_call as (s: string, m: string, p: string) => string | null)(
      "system",
      "editProgram",
      JSON.stringify({ slot, current })
    );
    // If the native host handled editing via native UI (dialog), it returns "true".
    // Return null to avoid double-sending. If the host returned replacement tokens, return them.
    if (res && res !== "null" && res !== "true") return res;
  }
  return null;
};

const app = new WasherRuntime({
  ble: nativeBleBridge,
  clockNow,
  editProgram,
  designWidth: 390,
});

// The fixed bottom chrome (pinned STOP band + navigation) is the shared
// module — the SAME drawing serves the native entry and the browser
// preview, so the preview finally renders the APK's shell.
const appWithNavBar = {
  route: () => app.route(),
  routes: () => app.routes(),
  stateSchema: () => app.stateSchema(),
  exportState: () => app.exportState(),
  onStateInvalidation: (listener: () => void) => app.onStateInvalidation(listener),
  dispatch: (action: string, payload?: unknown) => app.dispatch(action, payload),
  render: () => chromeApp.render(),
};

const chromeApp = withChrome(app);

const handoff = installHostHandoff({
  app: appWithNavBar,
  commit: (json: string) => {
    const sink = host["tenun_commit"];
    if (typeof sink === "function") {
      (sink as (value: string) => void)(json);
    } else {
      host["__tenun_last_scene"] = json;
    }
  },
});

host["__tenun_dispatch_action"] = (action: string, payloadJson: string): string => {
  drainTimers();
  const norm = action.toUpperCase();
  if (norm === "TIMER") {
    return JSON.stringify({ route: app.route() });
  }
  if (norm === "SAVE_PROGRAM") {
    // Native program-editor Save: run through the runtime send path so the
    // optimistic cache, ack tracking and failure feedback all apply (a
    // direct ble write bypassed them and left Programs stale).
    let slot = 0;
    let tokens = "";
    try {
      const parsed = JSON.parse(payloadJson);
      slot = typeof parsed.slot === "number" ? parsed.slot : 0;
      tokens = typeof parsed.tokens === "string" ? parsed.tokens.trim() : "";
    } catch {
      // fall through with defaults — an empty payload edits nothing
    }
    const key = PROGRAM_SLOTS[slot]?.key;
    if (key && tokens) app.send(`SET ${key} ${tokens}`);
    return JSON.stringify({ route: app.route() });
  }
  if (norm === "BLE_LINE") {
    let line = "";
    try {
      const parsed = JSON.parse(payloadJson);
      line = typeof parsed === "string" ? parsed : parsed.line || "";
    } catch {
      line = payloadJson;
    }
    app.lineIn(line);
    return JSON.stringify({ route: app.route() });
  }
  if (norm === "BLE_LINK") {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      payload = {};
    }
    app.linkPush(payload);
    if (payload.connected) {
      // Tracked quiet send: the immediate "OK 14 settings follow" ack now
      // settles its own pending entry instead of consuming the first user
      // command's reply.
      app.send("GET:ALL", { quiet: true });
    }
    return JSON.stringify({ route: app.route() });
  }
  return handoff.dispatch(action, payloadJson);
};

if (typeof host["tenun_commit"] !== "function") {
  host["__tenun_device_test"] = {
    route: () => app.route(),
    dispatch: host["__tenun_dispatch_action"],
    lastScene: () => host["__tenun_last_scene"] as string | null,
  };
}

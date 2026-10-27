/**
 * TN-154 native host entry for the Polytron Wash companion app:
 * Packages WasherRuntime for native Android execution in QuickJS
 * with JNI Host Service Bridge for Bluetooth Low Energy and native Canvas rendering.
 */
import { installHostHandoff } from "@tenunjs/widgets";
import { WasherRuntime, type BleSeam } from "../../../../examples/polytron/src/runtime";

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
      return res === "true" || res === "1";
    }
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

/**
 * Mobile navigation tabs for phone SurfaceView rendering.
 */
const TABS = [
  { route: "home", label: "Beranda", icon: "⌂" },
  { route: "programs", label: "Program", icon: "☰" },
  { route: "controls", label: "Kontrol", icon: "⚙" },
  { route: "settings", label: "Setelan", icon: "🔧" },
] as const;

const BAR_H = 56;

// Wrap app to inject fixed bottom navigation bar into display list scenes
const appWithNavBar = {
  route: () => app.route(),
  routes: () => app.routes(),
  stateSchema: () => app.stateSchema(),
  exportState: () => app.exportState(),
  onStateInvalidation: (listener: () => void) => app.onStateInvalidation(listener),
  dispatch: (action: string, payload?: unknown) => app.dispatch(action, payload),
  render: () => {
    const res = app.render();
    const scene = res.scene;
    const currentRoute = app.route();
    const w = scene.designWidth;
    const tabW = w / TABS.length;

    // 1. Background for bottom navigation
    scene.ops.push({
      op: "rect",
      x: 0,
      y: 0,
      w,
      h: BAR_H,
      r: 0,
      color: "#081110",
      fixed: true,
      anchor: "bottom",
      anchorSize: BAR_H,
    });
    // Top border line
    scene.ops.push({
      op: "line",
      x1: 0,
      y1: 0,
      x2: w,
      y2: 0,
      color: "#182624",
      width: 1,
      fixed: true,
      anchor: "bottom",
      anchorSize: BAR_H,
    });

    // 2. Tabs
    TABS.forEach((tab, i) => {
      const active = tab.route === currentRoute;
      const tabX = i * tabW;
      const textX = tabX + tabW / 2;
      const color = active ? "#39D2C0" : "#6E8883";

      // Icon
      scene.ops.push({
        op: "text",
        x: textX,
        y: 22,
        text: tab.icon,
        size: 16,
        weight: active ? 700 : 400,
        color,
        align: "center",
        width: 0,
        fixed: true,
        anchor: "bottom",
        anchorSize: BAR_H,
      });

      // Label
      scene.ops.push({
        op: "text",
        x: textX,
        y: 42,
        text: tab.label,
        size: 11,
        weight: active ? 600 : 400,
        color,
        align: "center",
        width: 0,
        fixed: true,
        anchor: "bottom",
        anchorSize: BAR_H,
      });

      // Tap hit region
      const tapId = res.tapRuns.length;
      scene.taps.push({
        x: tabX,
        y: 0,
        w: tabW,
        h: BAR_H,
        action: "tap",
        fixed: true,
        anchor: "bottom",
        anchorSize: BAR_H,
        payload: { id: tapId },
      });
      res.tapRuns.push(() => {
        app.navigate(tab.route);
      });
    });

    // 3. Native on-screen connect banner when offline on mobile
    // Layout anchor: sits directly above the bottom navigation bar.
    // Bottom bar has height BAR_H (56) and anchorSize BAR_H (56).
    // To place a 36-height banner 8px above the nav bar, its combined bottom
    // chrome height is TOTAL_BOTTOM_H = BAR_H + 8 + 36 = 100.
    // In bottom-anchored coordinates:
    // nav bar: y = 100 - BAR_H = 44, h = 56, anchorSize = 100
    // banner:  y = 0, h = 36, anchorSize = 100
    // Or simpler: anchorSize represents the bottom region height, and y is offset from its top.
    // With anchor="bottom", offset = visibleHeight - anchorSize.
    // When anchorSize = 104, offset = visibleHeight - 104.
    // Nav bar with anchorSize = 56 sits at [visibleHeight - 56, visibleHeight].
    // Connect banner at [visibleHeight - 100, visibleHeight - 64] needs:
    // targetY = visibleHeight - 100.
    // With anchorSize = 104, targetY = (visibleHeight - 104) + y => y must be 4!
    // Previously y was BAR_H + 8 = 64 => (visibleHeight - 104) + 64 = visibleHeight - 40 (inside nav bar!).
    const homeState = app.exportState().states.home as { link?: { connected?: boolean } } | undefined;
    const isConnected = homeState?.link?.connected === true;
    if (!isConnected && currentRoute === "home") {
      const BANNER_H = 36;
      const BANNER_ANCHOR_SIZE = BAR_H + 8 + BANNER_H; // 100
      const BANNER_Y = 0; // top of the 100px bottom zone: [visibleHeight - 100, visibleHeight - 64]
      scene.ops.push({
        op: "rect",
        x: 16,
        y: BANNER_Y,
        w: w - 32,
        h: BANNER_H,
        r: 10,
        color: "#163430",
        fixed: true,
        anchor: "bottom",
        anchorSize: BANNER_ANCHOR_SIZE,
      });
      scene.ops.push({
        op: "text",
        x: w / 2,
        y: BANNER_Y + 23,
        text: "⚡ SAMBUNGKAN KE MESIN CUCI",
        size: 11.5,
        weight: 700,
        color: "#39D2C0",
        align: "center",
        width: 0,
        fixed: true,
        anchor: "bottom",
        anchorSize: BANNER_ANCHOR_SIZE,
      });
      const connectTapId = res.tapRuns.length;
      scene.taps.push({
        x: 16,
        y: BANNER_Y,
        w: w - 32,
        h: BANNER_H,
        action: "tap",
        fixed: true,
        anchor: "bottom",
        anchorSize: BANNER_ANCHOR_SIZE,
        payload: { id: connectTapId },
      });
      res.tapRuns.push(() => {
        void nativeBleBridge.connect();
      });
    }

    return res;
  },
};

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
      void nativeBleBridge.write("GET:ALL");
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

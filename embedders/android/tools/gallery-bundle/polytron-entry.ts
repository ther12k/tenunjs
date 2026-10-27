/**
 * TN-154 native host entry for the Polytron Wash companion app:
 * Packages WasherRuntime for native Android execution in QuickJS
 * with JNI Host Service Bridge for Bluetooth Low Energy and native Canvas rendering.
 */
import { installHostHandoff } from "@tenunjs/widgets";
import { WasherRuntime, type BleSeam } from "../../../../examples/polytron/src/runtime";

const host = globalThis as Record<string, unknown>;

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

const app = new WasherRuntime({
  ble: nativeBleBridge,
  clockNow,
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
  const norm = action.toUpperCase();
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

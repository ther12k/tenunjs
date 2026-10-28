/**
 * TN-154 native host entry for the Polytron Wash companion app:
 * Packages WasherRuntime for native Android execution in QuickJS
 * with JNI Host Service Bridge for Bluetooth Low Energy and native Canvas rendering.
 */
import { installHostHandoff } from "@tenunjs/widgets";
import { WasherRuntime, type BleSeam } from "../../../../examples/polytron/src/runtime";
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

    // 3. THE connection control — one persistent band on every tab, FULL
    //    WIDTH and FLUSH against the bottom navigation (no inset, no gap):
    //    it reads as the nav bar's status row, not a floating button. It is
    //    always visible: disconnected (why + connect), in progress (phase,
    //    tappable to cancel), connected (device name, tappable to
    //    disconnect), and connected-but-silent (DATA BEKU warning). The
    //    scene has no shell header here, so this band IS the header status
    //    the user asked for: one place that always answers "what is wrong
    //    right now" and "is the machine's Bluetooth actually on".
    // Layout anchor math: with anchor="bottom", a region's offset is
    // visibleHeight - anchorSize + y, so with anchorSize = BAR_H + STRIP_H
    // the 44px band sits at [visibleHeight - 100, visibleHeight - 56],
    // touching the nav bar exactly.
    // app.link() — NOT exportState().states.home, which only exists while
    // Home is mounted; the band must know the link on every tab.
    const linkState = app.link();
    const STRIP_H = 44;
    const STRIP_ANCHOR_SIZE = BAR_H + STRIP_H; // 100 — flush, no gap
    const STRIP_Y = 0; // top of the 100px bottom zone: [vh-100, vh-56]

    let bg = "#163430";
    let fg = "#39D2C0";
    let line1 = "";
    let line2 = "";
    let stripTap: (() => void) | null = null;
    if (!linkState.supported) {
      bg = "#101917";
      fg = "#6E8883";
      line1 = "BLUETOOTH TIDAK DIDUKUNG";
      line2 = "perangkat ini tidak punya Bluetooth LE";
    } else if (linkState.connected) {
      const staleFor = app.statusAt() === null ? null : Math.max(0, Math.round((Date.now() - app.statusAt()!) / 1000));
      if (staleFor !== null && staleFor > 15) {
        bg = "#3B2E12";
        fg = "#FCB518";
        line1 = "DATA MESIN BEKU";
        line2 = `tidak ada kabar ${staleFor}s — dekati mesin · tekan utk putus`;
      } else {
        bg = "#0E3B2E";
        fg = "#7CE8C5";
        line1 = `● ${linkState.name ?? "MESIN CUCI"}`;
        line2 = "terhubung · tekan untuk memutuskan";
      }
      stripTap = () => nativeBleBridge.disconnect();
    } else if (linkState.connecting) {
      bg = "#1C3A36";
      line1 =
        linkState.phase === "scanning"
          ? "MENCARI MESIN CUCI…"
          : linkState.phase === "found"
            ? "MESIN TERDETEKSI · MENYAMBUNG…"
            : linkState.phase === "reconnecting"
              ? "MENYAMBUNG ULANG KE MESIN CUCI…"
              : "MENYAMBUNG KE MESIN CUCI…";
      line2 =
        linkState.phase === "found"
          ? "Bluetooth mesin AKTIF — sedang membuka sambungan"
          : "tekan untuk membatalkan";
      stripTap = () => nativeBleBridge.disconnect();
    } else {
      line1 = "⚡ SAMBUNGKAN KE MESIN CUCI";
      line2 = linkState.reason ? linkState.reason : "nyalakan mesin & Bluetooth ponsel";
      stripTap = () => {
        app.linkPush({ connecting: true, phase: "scanning" });
        void nativeBleBridge.connect().then(
          (ok) => {
            // Host refused synchronously (no adapter etc.) and no event will
            // follow — release the connecting lock ourselves.
            if (!ok) app.linkPush({ connected: false, connecting: false, phase: null });
          },
          () => app.linkPush({ connected: false, connecting: false, phase: null }),
        );
      };
    }

    scene.ops.push({
      op: "rect",
      x: 0,
      y: STRIP_Y,
      w,
      h: STRIP_H,
      r: 0,
      color: bg,
      fixed: true,
      anchor: "bottom",
      anchorSize: STRIP_ANCHOR_SIZE,
    });
    // Top border shared with the nav bar's own border: one continuous edge.
    scene.ops.push({
      op: "line",
      x1: 0,
      y1: 0.5,
      x2: w,
      y2: 0.5,
      color: "#182624",
      width: 1,
      fixed: true,
      anchor: "bottom",
      anchorSize: STRIP_ANCHOR_SIZE,
    });
    scene.ops.push({
      op: "text",
      x: 18,
      y: STRIP_Y + 18,
      text: line1,
      size: 12,
      weight: 700,
      color: fg,
      align: "left",
      width: 0,
      fixed: true,
      anchor: "bottom",
      anchorSize: STRIP_ANCHOR_SIZE,
    });
    scene.ops.push({
      op: "text",
      x: 18,
      y: STRIP_Y + 34,
      text: line2,
      size: 10,
      weight: 400,
      color: fg,
      align: "left",
      width: 0,
      fixed: true,
      anchor: "bottom",
      anchorSize: STRIP_ANCHOR_SIZE,
    });
    if (stripTap) {
      const stripTapId = res.tapRuns.length;
      scene.taps.push({
        x: 0,
        y: STRIP_Y,
        w,
        h: STRIP_H,
        action: "tap",
        fixed: true,
        anchor: "bottom",
        anchorSize: STRIP_ANCHOR_SIZE,
        payload: { id: stripTapId },
      });
      res.tapRuns.push(stripTap);
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

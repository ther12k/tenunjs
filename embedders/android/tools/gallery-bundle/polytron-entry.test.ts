import { describe, expect, test } from "bun:test";

/**
 * Native entry (TN-154) tests: boot the real polytron-entry module with a
 * fake JNI host-call bridge and drive it exactly like the Android engine
 * does — BLE_LINK/BLE_LINE/SAVE_PROGRAM dispatches against the committed
 * display-list scenes. The module is imported once (module cache) after the
 * fake host bridge is installed.
 *
 * 2026-10-30 redesign: the fixed bottom connection band is GONE — the
 * connection control is the LinkHeader row at the top of every screen
 * (in-content, non-fixed). The nav bar is the only fixed chrome.
 */

const host = globalThis as Record<string, unknown>;

let bleWrites: string[] = [];
let connects = 0;
let disconnects = 0;
// Captured ONCE at first boot: other suites in the same test process import
// their own entries (device-entry, gallery preview) that overwrite the same
// __tenun_* globals — this object holds direct references and stays ours.
let booted: DeviceTest | null = null;

interface DeviceTest {
  route(): string;
  dispatch(action: string, payloadJson: string): string;
  lastScene(): string | null;
}

async function bootEntry(): Promise<DeviceTest> {
  if (booted) return booted;
  bleWrites = [];
  connects = 0;
  delete host.tenun_commit; // headless mode: lastScene() instead of a commit sink
  host.tenun_host_call = (svc: string, method: string, payload: string): string => {
    if (svc === "ble" && method === "write") {
      bleWrites.push(JSON.parse(payload).cmd);
      return "true";
    }
    if (svc === "ble" && method === "connect") {
      connects++;
      return "true";
    }
    if (svc === "ble" && method === "disconnect") {
      disconnects++;
      return "true";
    }
    if (svc === "ble" && method === "supported") return "true";
    return "null";
  };
  await import("./polytron-entry");
  booted = host.__tenun_device_test as DeviceTest;
  return booted;
}

function sceneOf(t: DeviceTest): {
  designWidth: number;
  ops: Array<{ op: string; text?: string; x: number; y: number }>;
  taps: Array<{ x: number; y: number; w: number; h: number; anchorSize?: number; anchor?: string; fixed?: boolean; payload: unknown }>;
} {
  return JSON.parse(t.lastScene() ?? "null");
}

const texts = (scene: ReturnType<typeof sceneOf>): string =>
  scene.ops.filter((op) => op.op === "text").map((op) => op.text ?? "").join("\n");

/** The LinkHeader connection row's tap payload: the (non-fixed) tap region
 *  containing the given header label ("SAMBUNGKAN", "Terhubung · …"). */
const headerTap = (scene: ReturnType<typeof sceneOf>, label: string): unknown => {
  const op = scene.ops.find((o) => o.op === "text" && (o.text ?? "").startsWith(label));
  if (!op) return null;
  const tap = scene.taps.find(
    (t) => !t.fixed && op.x >= t.x && op.x <= t.x + t.w && op.y >= t.y && op.y <= t.y + t.h,
  );
  return tap?.payload ?? null;
};

const tapIdForText = (scene: ReturnType<typeof sceneOf>, label: string): unknown => {
  const op = scene.ops.find((o) => o.op === "text" && o.text === label);
  if (!op) return null;
  const tap = scene.taps.find(
    (t) => !t.fixed && op.x >= t.x && op.x <= t.x + t.w && op.y >= t.y && op.y <= t.y + t.h,
  );
  return tap?.payload ?? null;
};

describe("native polytron entry", () => {
  test("boots in the fake JNI host and commits a display-list scene", async () => {
    const t = await bootEntry();
    expect(t).toBeDefined();
    const raw = JSON.parse(t.lastScene() ?? "null") as { tenun?: string };
    expect(raw.tenun).toBe("display-list");
  });

  test("the nav bar is the ONLY fixed chrome — no bottom connection band", async () => {
    const t = await bootEntry();
    for (const route of ["home", "programs", "controls", "settings"]) {
      t.dispatch("NAVIGATE", JSON.stringify({ route }));
      const scene = sceneOf(t);
      const fixed = scene.taps.filter((tap) => tap.fixed);
      expect(fixed.length).toBe(4); // the four nav tabs, nothing else
      const tabW = scene.designWidth / 4;
      for (const tap of fixed) {
        expect(tap.anchorSize).toBe(80); // kit nav bar (navigationHeight)
        expect(tap.w).toBe(tabW);
        expect(tap.x % tabW).toBe(0); // tab columns
      }
    }
  });

  test("the connection header row shows on EVERY tab with a ≥40px target", async () => {
    const t = await bootEntry();
    for (const route of ["home", "programs", "controls", "settings"]) {
      t.dispatch("NAVIGATE", JSON.stringify({ route }));
      const scene = sceneOf(t);
      expect(texts(scene)).toContain("Tidak tersambung");
      expect(texts(scene)).toContain("SAMBUNGKAN");
      const tap = headerTap(scene, "SAMBUNGKAN");
      expect(tap).not.toBeNull();
      // The header tap region is the row band: h 42 (wet-hands ≥40px).
      const region = scene.taps.find((tr) => tr.payload === tap);
      expect(region!.h).toBeGreaterThanOrEqual(40);
      expect(region!.w).toBe(scene.designWidth - 24); // full content width
    }
  });

  test("header phases render — Mencari, Mesin terdeteksi, Menyambung ulang", async () => {
    const t = await bootEntry();
    t.dispatch("BLE_LINK", JSON.stringify({ connected: false, connecting: true, phase: "scanning" }));
    let scene = sceneOf(t);
    expect(texts(scene)).toContain("Mencari mesin…");
    t.dispatch("BLE_LINK", JSON.stringify({ connected: false, connecting: true, phase: "found", name: "Polytron Wash" }));
    scene = sceneOf(t);
    // "the ESP's Bluetooth is on" is exactly what the user must be told
    expect(texts(scene)).toContain("Mesin terdeteksi — menyambung…");
    expect(texts(scene)).toContain("BATALKAN"); // in-progress is cancellable
    t.dispatch("BLE_LINK", JSON.stringify({ connected: false, connecting: true, phase: "reconnecting" }));
    expect(texts(sceneOf(t))).toContain("Menyambung ulang…");
  });

  test("native-shaped failure releases the MENYAMBUNG lock and retry works", async () => {
    const t = await bootEntry();
    t.dispatch("BLE_LINK", JSON.stringify({ connected: false, connecting: false })); // reset
    t.dispatch("NAVIGATE", JSON.stringify({ route: "settings" }));
    const before = connects;
    t.dispatch("TAP", JSON.stringify(headerTap(sceneOf(t), "SAMBUNGKAN")));
    expect(connects).toBe(before + 1);
    expect(texts(sceneOf(t))).toContain("Menyambung…"); // optimistic lock
    // Exact native failure shape: notifyLink(false, name) — NO connecting
    // field. Before terminal normalization this left MENYAMBUNG forever.
    t.dispatch("BLE_LINE", JSON.stringify({ line: "ERR bluetooth mati — nyalakan Bluetooth" }));
    t.dispatch("BLE_LINK", JSON.stringify({ connected: false, name: "" }));
    const after = sceneOf(t);
    expect(texts(after)).toContain("SAMBUNGKAN"); // lock released
    t.dispatch("TAP", JSON.stringify(headerTap(after, "SAMBUNGKAN"))); // retry is possible
    expect(connects).toBe(before + 2);
  });

  test("connected header persists on every tab and tapping it disconnects", async () => {
    const t = await bootEntry();
    t.dispatch("BLE_LINK", JSON.stringify({ connected: false, connecting: false }));
    t.dispatch("BLE_LINK", JSON.stringify({ connected: true, name: "Polytron Wash" }));
    for (const route of ["home", "programs", "controls", "settings"]) {
      t.dispatch("NAVIGATE", JSON.stringify({ route }));
      const scene = sceneOf(t);
      expect(texts(scene)).toContain("Terhubung · Polytron Wash"); // identity always visible
      expect(headerTap(scene, "Terhubung")).not.toBeNull();
    }
    const before = disconnects;
    t.dispatch("TAP", JSON.stringify(headerTap(sceneOf(t), "Terhubung")));
    expect(disconnects).toBe(before + 1);
  });

  test("connect sends a TRACKED GET:ALL whose ack cannot steal a user reply", async () => {
    const t = await bootEntry();
    t.dispatch("BLE_LINK", JSON.stringify({ connected: false, connecting: false }));
    t.dispatch("BLE_LINK", JSON.stringify({ connected: true, name: "Polytron Wash" }));
    expect(bleWrites).toContain("GET:ALL");
    // The machine speaks (idle) so the function tiles arm — the fresh-status
    // gate keeps them inert until real telemetry arrives.
    t.dispatch("BLE_LINE", "ST:IDLE|READY|0/0|0|0|0000|180|W10");
    t.dispatch("NAVIGATE", JSON.stringify({ route: "home" })); // the grid lives on Home
    const cucci = tapIdForText(sceneOf(t), "Cuci");
    t.dispatch("TAP", JSON.stringify(cucci)); // user fires before the ack lands
    t.dispatch("BLE_LINE", JSON.stringify({ line: "OK 14 settings follow" }));
    t.dispatch("BLE_LINE", JSON.stringify({ line: "OK WASH 600 s" }));
    const scene = sceneOf(t);
    expect(texts(scene)).toContain("Cuci dimulai (10 mnt)");
    expect(texts(scene)).not.toContain("MENGIRIM");
    // quiet housekeeping: the GET:ALL the entry sends on connect must never
    // log a "> GET:ALL" activity row of its own (ERR residue from earlier
    // tests in this shared module is fine).
    expect(texts(scene)).not.toContain("> GET:ALL");
  });

  test("SAVE_PROGRAM writes through the runtime and a rejection rolls it back", async () => {
    const t = await bootEntry();
    t.dispatch("BLE_LINK", JSON.stringify({ connected: false, connecting: false }));
    t.dispatch("BLE_LINK", JSON.stringify({ connected: true, name: "Polytron Wash" }));
    t.dispatch("BLE_LINE", JSON.stringify({ line: "OK 14 settings follow" }));
    t.dispatch("SAVE_PROGRAM", JSON.stringify({ slot: 0, tokens: "WASH:600, SPIN:300" }));
    expect(bleWrites).toContain("SET PROG0 WASH:600, SPIN:300");
    t.dispatch("BLE_LINE", JSON.stringify({ line: "BUSY - STOP first" })); // machine rejects
    t.dispatch("NAVIGATE", JSON.stringify({ route: "programs" }));
    let scene = sceneOf(t);
    expect(texts(scene)).not.toContain("±15 mnt"); // optimistic steps rolled back
    // and the accepted path keeps them
    t.dispatch("SAVE_PROGRAM", JSON.stringify({ slot: 0, tokens: "WASH:600, SPIN:300" }));
    t.dispatch("BLE_LINE", JSON.stringify({ line: "OK SET PROG0" }));
    t.dispatch("NAVIGATE", JSON.stringify({ route: "programs" }));
    scene = sceneOf(t);
    expect(texts(scene)).toContain("±15 mnt");
    expect(texts(scene)).toContain("2 tahap");
  });
});

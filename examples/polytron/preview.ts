/**
 * Browser preview host for the Polytron Wash app: canvas host shell (same
 * renderer contract as the Android embedder), route bar, and the LIVE
 * link wiring — Web Bluetooth straight to the washer's BLE GATT service
 * (no WiFi, no backend). This module implements the service seams the
 * runtime expects; the runtime and screens stay Bluetooth-free and
 * headless-testable.
 *
 * Secure context note: Web Bluetooth needs HTTPS or localhost. Open this
 * page as http://localhost:PORT on the same machine, or serve the dev
 * server over TLS (dev.ts picks up dev-cert.pem/dev-key.pem) before
 * opening it from a phone on the LAN.
 */
import { withChrome } from "./src/chrome";
import { WasherRuntime, type BleLinkState } from "./src/runtime";
import {
  BLE_CMD_UUID,
  BLE_SVC_UUID,
  BLE_STAT_UUID,
  parseProgramSteps,
  formatProgramSteps,
  fmtDurationS,
  fmtClock,
  MODE_LABELS,
  PROGRAM_SLOTS,
  type ProgramStep,
} from "./src/protocol";
import { createWriteQueue } from "./src/write-queue";
import { CanvasPreviewRenderer, anchorOffsetForTest } from "../gallery-preview/renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#preview");
const routes = document.querySelector<HTMLElement>("#routes");
const linkBtn = document.querySelector<HTMLButtonElement>("#link-btn");
const statusText = document.querySelector<HTMLElement>("#status");
if (!canvas || !routes || !linkBtn || !statusText) throw new Error("preview shell is incomplete");
const previewCanvas = canvas;
const routeNav = routes;

/* ------------------------------------------------------------------ *
 * Washer BLE link — Web Bluetooth client for the polytronwash v4
 * GATT service. Commands are single-line writes on …e002; the status
 * characteristic …e003 notifies ST:/SET:/reply lines (and is readable
 * for a seed status on connect).
 * ------------------------------------------------------------------ */

/** Minimal structural Web Bluetooth types (no lib.dom bluetooth yet). */
interface GattCharacteristic {
  value?: DataView;
  writeValue(v: BufferSource): Promise<void>;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<GattCharacteristic>;
  addEventListener(type: "characteristicvaluechanged", f: (e: { target: GattCharacteristic }) => void): void;
}
interface GattServer {
  connect(): Promise<unknown>;
  getPrimaryService(u: string): Promise<{ getCharacteristic(u: string): Promise<GattCharacteristic> }>;
}
interface BleDevice {
  name?: string;
  gatt?: GattServer;
  addEventListener(type: "gattserverdisconnected", f: () => void): void;
}
type RequestDeviceFn = (o: unknown) => Promise<BleDevice>;

let device: BleDevice | null = null;
let cmdChar: GattCharacteristic | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bleSupported(): boolean {
  return typeof (navigator as { bluetooth?: { requestDevice?: unknown } }).bluetooth?.requestDevice === "function";
}

function textOf(dv: DataView): string {
  return decoder.decode(dv.buffer.byteOffset === 0 && dv.buffer.byteLength === dv.byteLength ? dv.buffer : dv);
}

/** Write queue: the firmware executes one command per loop tick — space
 *  rapid taps (settings steppers) so no write is dropped. A failed write
 *  must not poison the queue: later commands (STOP included) still go out. */
const gattQueue = createWriteQueue(
  async (cmd: string) => {
    if (!cmdChar) throw new Error("not connected");
    await cmdChar.writeValue(encoder.encode(cmd));
    await new Promise((r) => setTimeout(r, 80));
  },
  (_cmd, e) => {
    statusText.textContent = `write failed: ${String(e)}`;
    statusText.className = "status error";
  },
);
function enqueueWrite(cmd: string): Promise<boolean> {
  return gattQueue.enqueue(cmd);
}

let userDisconnected = false;
let reconnectTimer = 0;
let reconnectAttempts = 0;

function clearAutoReconnect(): void {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  }
  reconnectAttempts = 0;
}

async function attemptAutoReconnect(): Promise<void> {
  if (userDisconnected || !device || demoActive || reconnectAttempts >= 3) {
    return;
  }
  reconnectAttempts++;
  statusText.textContent = `sambung ulang (${reconnectAttempts}/3)…`;
  linkBtn.className = "wait";
  reconnectTimer = window.setTimeout(async () => {
    if (userDisconnected || !device || demoActive) return;
    try {
      const server = await device.gatt?.connect();
      if (!server) throw new Error("no server");
      const svc = await server.getPrimaryService(BLE_SVC_UUID);
      cmdChar = await svc.getCharacteristic(BLE_CMD_UUID);
      const stat = await svc.getCharacteristic(BLE_STAT_UUID);
      await stat.startNotifications();
      stat.addEventListener("characteristicvaluechanged", (e) => {
        if (e.target.value) runtime.lineIn(textOf(e.target.value));
      });
      clearAutoReconnect();
      pushLink({ connected: true, connecting: false, name: device.name ?? "polytron" });
      runtime.lineIn(textOf(await stat.readValue()));
      void enqueueWrite("GET:ALL");
    } catch {
      if (reconnectAttempts < 3 && !userDisconnected) {
        void attemptAutoReconnect();
      } else {
        clearAutoReconnect();
        pushLink({ connected: false, connecting: false });
      }
    }
  }, reconnectAttempts * 2000);
}

async function bleConnect(): Promise<boolean> {
  const bt = (navigator as { bluetooth?: { requestDevice?: RequestDeviceFn } }).bluetooth;
  if (!bt?.requestDevice) return false;
  userDisconnected = false;
  clearAutoReconnect();
  pushLink({ connecting: true });
  try {
    device = await bt.requestDevice({ filters: [{ services: [BLE_SVC_UUID] }] });
    device.addEventListener("gattserverdisconnected", () => {
      cmdChar = null;
      pushLink({ connected: false, connecting: false });
      if (!userDisconnected && !demoActive && device) {
        void attemptAutoReconnect();
      }
    });
    const server = await device.gatt?.connect();
    if (!server) throw new Error("no gatt server");
    const svc = await server.getPrimaryService(BLE_SVC_UUID);
    cmdChar = await svc.getCharacteristic(BLE_CMD_UUID);
    const stat = await svc.getCharacteristic(BLE_STAT_UUID);
    await stat.startNotifications();
    stat.addEventListener("characteristicvaluechanged", (e) => {
      if (e.target.value) runtime.lineIn(textOf(e.target.value));
    });
    pushLink({ connected: true, connecting: false, name: device.name ?? "polytron" });
    runtime.lineIn(textOf(await stat.readValue())); // seed the hero
    void enqueueWrite("GET:ALL");
    return true;
  } catch {
    pushLink({ connected: false, connecting: false });
    return false;
  }
}

/** Program overlay editor — visual step builder with raw-token fallback. */
function editProgramOverlay(slot: number, current: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.querySelector<HTMLElement>("#prog-edit");
    const title = document.querySelector<HTMLElement>("#prog-edit-title");
    const stepsContainer = document.querySelector<HTMLElement>("#prog-edit-steps");
    const summary = document.querySelector<HTMLElement>("#prog-edit-summary");
    const quickAdds = document.querySelector<HTMLElement>(".quick-adds");
    const toggleRawBtn = document.querySelector<HTMLButtonElement>("#prog-edit-toggle-raw");
    const rawSection = document.querySelector<HTMLElement>("#prog-edit-raw-section");
    const input = document.querySelector<HTMLInputElement>("#prog-edit-input");
    const msg = document.querySelector<HTMLElement>("#prog-edit-msg");
    const saveBtn = document.querySelector<HTMLButtonElement>("#prog-edit-save");
    const cancelBtn = document.querySelector<HTMLButtonElement>("#prog-edit-cancel");
    if (!overlay || !input || !msg || !saveBtn || !cancelBtn) {
      resolve(null);
      return;
    }

    let steps: ProgramStep[] = parseProgramSteps(current);
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      overlay.hidden = true;
      resolve(v);
    };

    const slotName = PROGRAM_SLOTS[slot]?.name ?? `Slot ${slot}`;
    if (title) title.textContent = `${slotName} (Slot ${slot})`;
    overlay.hidden = false;
    input.value = current;
    msg.textContent = `Token mentah: WASH:600, DRAIN:30, SPIN:300, FILL:60, WAIT:60`;

    const stepColors: Record<string, string> = {
      WASH: "#00B7FD",
      SPIN: "#BB86FC",
      DRAIN: "#00FFC8",
      FILL: "#00FF80",
      RINSE: "#38BDF8",
      WAIT: "#FCB518",
    };

    function renderSteps(): void {
      if (!stepsContainer || !summary) return;
      stepsContainer.replaceChildren();

      if (steps.length === 0) {
        const empty = document.createElement("div");
        empty.style.color = "var(--dim)";
        empty.style.fontSize = "12px";
        empty.style.padding = "10px";
        empty.style.textAlign = "center";
        empty.textContent = "Belum ada langkah. Tambahkan langkah di bawah:";
        stepsContainer.appendChild(empty);
      }

      steps.forEach((st, idx) => {
        const row = document.createElement("div");
        row.className = "step-row";

        const badge = document.createElement("span");
        badge.className = "step-mode";
        const color = stepColors[st.mode] ?? "#9DB2C7";
        badge.style.color = color;
        badge.style.border = `1px solid ${color}66`;
        badge.style.background = `${color}18`;
        badge.textContent = `${idx + 1}. ${MODE_LABELS[st.mode] ?? st.mode}`;

        const stepper = document.createElement("div");
        stepper.className = "step-stepper";

        const minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.textContent = "−";
        minusBtn.title = "Kurangi durasi";
        minusBtn.onclick = () => {
          const stepDelta = st.s <= 60 ? 10 : st.s <= 300 ? 30 : 60;
          st.s = Math.max(10, st.s - stepDelta);
          syncFromSteps();
        };

        const valSpan = document.createElement("span");
        valSpan.className = "step-val";
        valSpan.textContent = fmtDurationS(st.s);

        const plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.textContent = "+";
        plusBtn.title = "Tambah durasi";
        plusBtn.onclick = () => {
          const stepDelta = st.s < 60 ? 10 : st.s < 300 ? 30 : 60;
          st.s = Math.min(3600, st.s + stepDelta);
          syncFromSteps();
        };

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "step-del";
        delBtn.textContent = "×";
        delBtn.title = "Hapus langkah ini";
        delBtn.onclick = () => {
          steps.splice(idx, 1);
          syncFromSteps();
        };

        stepper.append(minusBtn, valSpan, plusBtn, delBtn);
        row.append(badge, stepper);
        stepsContainer.appendChild(row);
      });

      const totalS = steps.reduce((sum, s) => sum + s.s, 0);
      summary.textContent = steps.length > 0
        ? `Total durasi: ${fmtClock(totalS)} (${steps.length} langkah)`
        : "Total durasi: 0:00 (kosong)";
    }

    function syncFromSteps(): void {
      const formatted = formatProgramSteps(steps);
      input.value = formatted;
      renderSteps();
    }

    if (quickAdds) {
      quickAdds.onclick = (e) => {
        const target = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-add]");
        if (!target) return;
        const [mode, sStr] = (target.dataset.add ?? "").split(":");
        if (mode && sStr) {
          steps.push({ mode: mode.toUpperCase(), s: parseInt(sStr, 10) || 60 });
          syncFromSteps();
        }
      };
    }

    if (toggleRawBtn && rawSection) {
      rawSection.hidden = true;
      toggleRawBtn.textContent = "Tampilkan format teks mentah";
      toggleRawBtn.onclick = () => {
        rawSection.hidden = !rawSection.hidden;
        toggleRawBtn.textContent = rawSection.hidden
          ? "Tampilkan format teks mentah"
          : "Sembunyikan format teks mentah";
      };
    }

    input.oninput = () => {
      steps = parseProgramSteps(input.value);
      renderSteps();
    };

    saveBtn.onclick = () => finish(input.value.trim());
    cancelBtn.onclick = () => finish(null);
    input.onkeydown = (e) => {
      if (e.key === "Enter") finish(input.value.trim());
      if (e.key === "Escape") finish(null);
    };

    renderSteps();
    if (rawSection && rawSection.hidden) {
      saveBtn.focus();
    } else {
      input.focus();
    }
  });
}

function clockNow(): string | null {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ *
 * Demo simulator — review the UI/UX without a washer. Toggled by the
 * DEMO pill in the header: fakes the GATT link, answers commands like
 * the firmware does, and ticks a running cycle (ST lines) every second.
 * ------------------------------------------------------------------ */
let demoActive = false;
let demoTimer = 0;

const DEMO_SET: readonly string[] = [
  "SET WASHMIN 10", "SET SPINMIN 7", "SET DRAINMIN 2", "SET FILLMIN 3",
  "SET RINSEMIN 5", "SET SPINDRAINS 30", "SET RINSEDRAINS 60",
  "SET STOPCOASTS 10", "SET PULSES 2.5", "SET DEADS 0.05",
  "SET SPINMOTOR B",
  "SET PROG0 WASH:300, SPIN:120",
  "SET PROG1 WASH:600, DRAIN:30, SPIN:300",
  "SET PROG2 WASH:900, DRAIN:60, FILL:60, SPIN:300",
];

interface SimTok {
  mode: string;
  s: number;
}
const SIM_DEFAULT: readonly SimTok[] = [
  { mode: "WASH", s: 600 },
  { mode: "DRAIN", s: 60 },
  { mode: "SPIN", s: 300 },
  { mode: "FILL", s: 60 },
  { mode: "SPIN", s: 180 },
];
const SIM_FUNCS: Readonly<Record<string, readonly SimTok[]>> = {
  WASH: [{ mode: "WASH", s: 300 }],
  SPIN: [{ mode: "SPIN", s: 300 }],
  DRAIN: [{ mode: "DRAIN", s: 120 }],
  FILL: [{ mode: "FILL", s: 120 }],
};
const FN_NAMES: Readonly<Record<string, string>> = {
  WASH: "CUCI", SPIN: "PERAS", DRAIN: "BUANG", FILL: "ISI", RINSE: "BILAS", RINSEND: "BILAS ND",
};
let simToks: readonly SimTok[] = SIM_DEFAULT;
let simName = "NORMAL";
let simRun = false;
let simEl = 0;
let simWater = 63;

const simTotal = (): number => simToks.reduce((a, t) => a + t.s, 0);

function simTokAt(el: number): { mode: string; idx: number } {
  let acc = 0;
  for (let i = 0; i < simToks.length; i++) {
    acc += simToks[i]!.s;
    if (el < acc) return { mode: simToks[i]!.mode, idx: i };
  }
  return { mode: simToks[simToks.length - 1]!.mode, idx: simToks.length - 1 };
}

function simRelays(mode: string): string {
  if (mode === "WASH") return "1000";
  if (mode === "SPIN") return "0100";
  if (mode === "DRAIN") return "0010";
  if (mode === "FILL") return "0001";
  return "0000";
}

function simStart(toks: readonly SimTok[], name: string): void {
  simToks = toks;
  simName = name;
  simEl = 0;
  simRun = true;
}

function pushSimStatus(): void {
  const line = simRun
    ? (() => {
        const t = simTokAt(simEl);
        return `ST:${t.mode}|${simName}|${t.idx + 1}/${simToks.length}|${simEl}|${Math.max(0, simTotal() - simEl)}|${simRelays(t.mode)}|180|W${simWater}`;
      })()
    : `ST:IDLE|${simName.startsWith("DONE") ? simName : "READY"}|0/0|${simEl}|0|0000|180|W${simWater}`;
  runtime.lineIn(line);
}

/** Device-side behavior for one command (replies + state + status push). */
function demoExec(rawCmd: string): void {
  const cmd = rawCmd.toUpperCase();
  const reply = (r: string) => runtime.lineIn(r);
  const start = (toks: readonly SimTok[], name: string, ok: string) => {
    simStart(toks, name);
    reply(ok);
  };
  if (cmd === "STOP") {
    if (simRun) simName = `DONE ${simName.replace(/^DONE /, "")}`;
    simRun = false;
    reply("OK STOP");
  } else if (cmd.startsWith("GET")) {
    reply("OK 14 settings follow");
    for (const l of DEMO_SET) runtime.lineIn(l);
  } else if (cmd.startsWith("SET")) {
    reply(`OK SET ${cmd.slice(4).split(" ")[0]}`);
  } else if (cmd.startsWith("PROG")) {
    const n = Math.max(0, Math.min(2, parseInt(cmd.split(" ")[1] ?? "0", 10) || 0));
    const sets: readonly SimTok[][] = [
      [{ mode: "WASH", s: 300 }, { mode: "SPIN", s: 120 }],
      [...SIM_DEFAULT],
      [{ mode: "WASH", s: 900 }, { mode: "DRAIN", s: 60 }, { mode: "FILL", s: 60 }, { mode: "SPIN", s: 300 }],
    ];
    start(sets[n]!, ["CEPAT", "NORMAL", "KUSTOM"][n]!, `OK ${["CEPAT", "NORMAL", "KUSTOM"][n]}`);
  } else if (cmd === "TUB") {
    start([{ mode: "WASH", s: 900 }, { mode: "DRAIN", s: 60 }, { mode: "SPIN", s: 300 }], "TUB CLEAN", "OK TUB CLEAN");
  } else if (cmd === "CLOCK") {
    reply("OK CLOCK 10:24");
  } else if (cmd === "WATER") {
    reply(`WATER raw 433 ema 430 pct ${simRun ? simWater : -1} cal 310..1024`);
  } else if (cmd === "VER") {
    reply("polytron-wash-tft v4.10");
  } else if (cmd.startsWith("WCAL")) {
    reply("OK WCAL");
  } else if (cmd.startsWith("RINSE")) {
    const nd = cmd.startsWith("RINSEND");
    start([{ mode: "FILL", s: 60 }, { mode: "DRAIN", s: 60 }, { mode: "SPIN", s: 120 }], FN_NAMES[nd ? "RINSEND" : "RINSE"]!, nd ? "OK RINSEND" : "OK RINSE");
  } else if (cmd.startsWith("WASH") || cmd.startsWith("SPIN") || cmd.startsWith("DRAIN") || cmd.startsWith("FILL")) {
    const verb = ["WASH", "SPIN", "DRAIN", "FILL"].find((v) => cmd.startsWith(v))!;
    start(SIM_FUNCS[verb]!, FN_NAMES[verb]!, `OK ${verb} 300 s`);
  } else {
    reply("ERR verb");
  }
  pushSimStatus();
}

function demoTick(): void {
  if (!simRun) return;
  simEl += 1;
  const mode = simTokAt(simEl).mode;
  if (mode === "FILL") simWater = Math.min(100, simWater + 1);
  if (mode === "DRAIN") simWater = Math.max(0, simWater - 2);
  if (simEl >= simTotal()) {
    simRun = false;
    simName = `DONE ${simName.replace(/^DONE /, "")}`;
  }
  pushSimStatus();
}

function toggleDemo(on: boolean): void {
  if (on === demoActive) return;
  demoActive = on;
  const btn = document.querySelector<HTMLElement>("#demo-btn");
  if (on) {
    simToks = SIM_DEFAULT;
    simName = "NORMAL";
    simEl = 0;
    simRun = true;
    simWater = 63;
    pushLink({ supported: true, connecting: false, connected: true, name: "simulator" });
    for (const l of DEMO_SET) runtime.lineIn(l);
    pushSimStatus();
    demoTimer = window.setInterval(demoTick, 1000);
    btn?.classList.add("on");
  } else {
    window.clearInterval(demoTimer);
    // linkPush(connected:false) clears live status — no ghost cycle
    pushLink({ supported: bleSupported(), connecting: false, connected: false, name: null });
    btn?.classList.remove("on");
  }
  btn?.setAttribute("aria-pressed", on ? "true" : "false");
}

// The BLE seam is shared by the runtime and the header's link button —
// the button IS the connect affordance now that no tab renders a banner.
// In the Android APK, `window.PolytronNative` takes over: true native BLE
// without needing a browser, Web Bluetooth or device pickers.
interface PolytronNativeBridge {
  connect(): void;
  disconnect(): void;
  write(cmd: string): boolean;
}
const nativeBle: PolytronNativeBridge | undefined =
  (window as unknown as { PolytronNative?: PolytronNativeBridge }).PolytronNative;

const bleSeam = {
  supported: () => demoActive || nativeBle !== undefined || bleSupported(),
  connect: () => {
    if (demoActive) return Promise.resolve(true);
    if (nativeBle) {
      nativeBle.connect();
      return Promise.resolve(true);
    }
    return bleConnect();
  },
  disconnect: () => {
    userDisconnected = true;
    clearAutoReconnect();
    if (demoActive) {
      toggleDemo(false);
      return;
    }
    if (nativeBle) {
      nativeBle.disconnect();
      return;
    }
    try {
      device?.gatt?.disconnect();
    } catch {
      /* already gone */
    }
  },
  write: (cmd: string) => {
    if (demoActive) {
      demoExec(cmd);
      return Promise.resolve(true);
    }
    if (nativeBle) {
      return Promise.resolve(nativeBle.write(cmd));
    }
    return enqueueWrite(cmd);
  },
};

// Android APK bridge callbacks — native layer pushes lines and link changes here.
(window as unknown as { __nativeLine?: (l: string) => void }).__nativeLine = (line: string) => {
  runtime.lineIn(line);
};
(window as unknown as { __nativeLink?: (l: { connected: boolean; name: string | null }) => void }).__nativeLink = (
  l: { connected: boolean; name: string | null },
) => {
  pushLink({ supported: true, connected: l.connected, connecting: false, name: l.name });
  if (l.connected) {
    void bleSeam.write("GET:ALL");
  }
};

const runtime = new WasherRuntime({
  ble: bleSeam,
  clockNow,
  editProgram: editProgramOverlay,
  // Lay out at the real phone width (clamped to the phone range) so a
  // 320px screen renders at 1:1 instead of scaling a 390 design down to
  // unreadable sizes; wide desktops keep the centered phone card.
  designWidth: Math.round(Math.min(430, Math.max(320, window.innerWidth || 390))),
});

/** Link pushes drive the header's link pill — the ONE connection
 *  indicator (icon + short text), replacing the per-tab banner. */
let linkNow: BleLinkState = { supported: false, connecting: false, connected: false, name: null };
function pushLink(link: Partial<BleLinkState>): void {
  linkNow = { ...linkNow, ...link };
  runtime.linkPush(linkNow);
  linkBtn.classList.toggle("ok", linkNow.connected);
  linkBtn.classList.toggle("wait", !linkNow.connected && linkNow.supported && !linkNow.connecting);
  // Keep button enabled so mobile/touch users can tap for guidance
  linkBtn.disabled = false;
  if (linkNow.connected) {
    statusText.textContent = linkNow.name ?? "tersambung";
    linkBtn.title = "tersambung — ketuk untuk memutuskan";
  } else if (linkNow.connecting) {
    statusText.textContent = "menghubungkan…";
    linkBtn.title = "sedang memilih perangkat";
  } else if (linkNow.supported) {
    statusText.textContent = "belum tersambung";
    linkBtn.title = "ketuk untuk menyambungkan ke mesin";
  } else {
    statusText.textContent = "offline";
    linkBtn.title = "Bluetooth tidak tersedia — ketuk untuk info atau coba mode DEMO";
  }
  paint();
}
linkBtn.addEventListener("click", () => {
  if (linkNow.connecting) return;
  if (linkNow.connected) {
    userDisconnected = true;
    clearAutoReconnect();
    bleSeam.disconnect();
    return;
  }
  if (linkNow.supported) {
    userDisconnected = false;
    clearAutoReconnect();
    void bleSeam.connect();
    return;
  }
  alert(
    "Browser ini belum mendukung Web Bluetooth (misalnya di iOS/Safari).\n\n" +
      "Gunakan Google Chrome atau Microsoft Edge di Android / PC, atau aktifkan mode DEMO di kanan atas untuk simulasi kontrol.",
  );
});

// The pinned STOP band + bottom nav — the SAME shared chrome the native
// entry draws, so this preview renders the APK's actual shell.
const chromeApp = withChrome(runtime);
const renderer = new CanvasPreviewRenderer(previewCanvas);
let scrollY = 0;
let activeTap: { x: number; y: number; w: number; h: number } | null = null;
let prevRunning = false;

function updateDocumentFeedback(): void {
  const st = runtime.status();
  if (st?.running) {
    document.title = `(${fmtClock(st.remainS)}) ${st.mode} · Polytron Wash`;
    prevRunning = true;
  } else if (st && !st.running && st.prog.startsWith("DONE")) {
    document.title = `(✓ Selesai) Polytron Wash`;
    if (prevRunning) {
      prevRunning = false;
      try {
        navigator.vibrate?.([200, 100, 200, 100, 300]);
      } catch {
        /* ignore */
      }
    }
  } else {
    document.title = "Polytron Wash · TenunJS";
    prevRunning = false;
  }
}

function paint(): void {
  updateDocumentFeedback();
  const result = chromeApp.render();
  scrollY = Math.min(scrollY, renderer.maxScroll(result.scene));
  renderer.render(result.scene, scrollY);
  if (activeTap) {
    const ctx = previewCanvas.getContext("2d");
    if (ctx) {
      const scale = previewCanvas.clientWidth / result.scene.designWidth;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.scale(scale, scale);
      // activeTap is already in viewport space (fixed anchors included) —
      // no content translate here.
      ctx.fillStyle = "rgba(0, 183, 253, 0.16)";
      ctx.strokeStyle = "rgba(0, 183, 253, 0.45)";
      ctx.lineWidth = 2;
      const r = Math.min(14, activeTap.h / 3);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(activeTap.x, activeTap.y, activeTap.w, activeTap.h, r);
      } else {
        ctx.rect(activeTap.x, activeTap.y, activeTap.w, activeTap.h);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  for (const button of routeNav.querySelectorAll<HTMLButtonElement>("button")) {
    button.classList.toggle("active", button.dataset.route === runtime.route());
  }
}

function makeRouteButtons(): void {
  routeNav.replaceChildren();
  const labels: Record<string, string> = {
    home: "Home",
    programs: "Programs",
    controls: "Controls",
    settings: "Settings",
  };
  for (const route of runtime.routes()) {
    const button = document.createElement("button");
    button.className = "route";
    button.dataset.route = route;
    button.textContent = labels[route] ?? route;
    button.addEventListener("click", () => {
      runtime.navigate(route);
      scrollY = 0;
      paint();
    });
    routeNav.append(button);
  }
}

previewCanvas.addEventListener("pointerdown", (event) => {
  previewCanvas.setPointerCapture(event.pointerId);
  pointerY = event.clientY;
  dragging = false;
  // Fixed-aware topmost-wins resolution (the renderer's shared rule) —
  // the old content-space scan tested the pinned chrome against scrolled
  // coordinates and fired EVERY overlapping region, so the visible STOP
  // button and nav tabs silently did nothing.
  const render = chromeApp.render();
  const rect = previewCanvas.getBoundingClientRect();
  const scale = rect.width / render.scene.designWidth;
  const hitIdx = renderer.hitTest(render.scene, event.clientX, event.clientY, scrollY, "tap");
  activeTap = null;
  if (hitIdx !== null) {
    const t = render.scene.taps[hitIdx]!;
    const vy = t.fixed ? t.y + anchorOffsetForTest(t, rect.height / scale) : t.y - scrollY;
    activeTap = { x: t.x, y: vy, w: t.w, h: t.h }; // viewport space for the highlight
  }
  if (activeTap) paint();
});
previewCanvas.addEventListener("pointermove", (event) => {
  if (!previewCanvas.hasPointerCapture(event.pointerId)) return;
  const delta = pointerY - event.clientY;
  if (Math.abs(delta) > 1) {
    dragging = true;
    if (activeTap) {
      activeTap = null;
      paint();
    }
  }
  pointerY = event.clientY;
  const scene = chromeApp.render().scene;
  const scale = previewCanvas.clientWidth / scene.designWidth;
  scrollY = Math.max(0, Math.min(renderer.maxScroll(scene), scrollY + delta / scale));
  renderer.render(scene, scrollY);
});
previewCanvas.addEventListener("pointerup", (event) => {
  previewCanvas.releasePointerCapture(event.pointerId);
  activeTap = null;
  if (dragging) return;
  // Same fixed-aware topmost-wins rule as pointerdown: ONE region fires.
  const render = chromeApp.render();
  const hitIdx = renderer.hitTest(render.scene, event.clientX, event.clientY, scrollY, "tap");
  if (hitIdx !== null) {
    const run = render.tapRuns[hitIdx];
    if (typeof run === "function") {
      run();
      try {
        navigator.vibrate?.(12);
      } catch {
        /* ignore */
      }
    }
  }
  paint();
});
previewCanvas.addEventListener("pointercancel", () => {
  activeTap = null;
  paint();
});
/** Mouse wheel / trackpad scroll — desktop users don't drag canvases. */
previewCanvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const scene = chromeApp.render().scene;
    const scale = previewCanvas.clientWidth / scene.designWidth;
    scrollY = Math.max(0, Math.min(renderer.maxScroll(scene), scrollY + event.deltaY / scale));
    renderer.render(scene, scrollY);
  },
  { passive: false },
);
let pointerY = 0;
let dragging = false;

makeRouteButtons();
document.querySelector("#demo-btn")?.addEventListener("click", () => toggleDemo(!demoActive));
pushLink({ supported: bleSupported() }); // header dot + status line
paint();
window.addEventListener("resize", () => paint()); // responsive canvas re-fit
// Push-driven repaint: BLE notifications, demo ticks and write failures
// mutate state outside TAP dispatches — without this the canvas looks
// frozen while the model updates (the review's "timer doesn't move").
runtime.onStateInvalidation(() => paint());

// Dev-only handles for e2e-driving the canvas host (taps by scene
// coordinates, scene inspection, fake inbound lines).
interface PolytronDebug {
  runtime: WasherRuntime;
  tapAt: (fx: number, fy: number) => boolean;
  sceneTexts: () => string[];
  lineIn: (line: string) => void;
  toggleDemo: (on: boolean) => void;
}
(window as unknown as Record<string, unknown>).__polytronDebug = {
  runtime,
  tapAt: (fx: number, fy: number): boolean => {
    const r = previewCanvas.getBoundingClientRect();
    const render = chromeApp.render();
    const scene = render.scene;
    const x = fx * scene.designWidth;
    const visibleHeight = r.height / (r.width / scene.designWidth);
    const y = fy * (scene.contentHeight ?? visibleHeight);
    // Topmost-wins, fixed anchors honored — mirrors the hosts' shared
    // hit-test rule (the old first-match-in-order scan was close enough
    // for disjoint content taps but wrong wherever regions overlapped).
    for (let i = scene.taps.length - 1; i >= 0; i--) {
      const t = scene.taps[i]!;
      const ty = t.fixed ? t.y + anchorOffsetForTest(t, visibleHeight) : t.y;
      if (t.x <= x && x <= t.x + t.w && ty <= y && y <= ty + t.h) {
        const run = render.tapRuns[i];
        if (typeof run === "function") {
          run();
          paint();
          return true;
        }
        return false;
      }
    }
    return false;
  },
  sceneTexts: (): string[] => {
    const scene = chromeApp.render().scene;
    const texts: string[] = [];
    for (const op of scene.ops) if (op.op === "text") texts.push(op.text);
    return texts;
  },
  lineIn: (line: string) => runtime.lineIn(line),
  toggleDemo,
} satisfies PolytronDebug;

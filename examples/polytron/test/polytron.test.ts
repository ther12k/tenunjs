import { describe, expect, test } from "bun:test";
import { WasherRuntime, type BleSeam } from "../src/runtime";
import { createWriteQueue } from "../src/write-queue";
import { textWidth } from "@tenunjs-examples/ui-kit";
import {
  fmtActivityLine,
  fmtClock,
  fmtDurationS,
  fmtProgramSummary,
  formatProgramSteps,
  parseProgramSteps,
  parseReply,
  parseSetting,
  parseStatus,
} from "../src/protocol";

/**
 * Headless app tests: real washer wire lines (the v4 firmware's
 * statusLine()/settingsLine()/execCmd() formats) drive the runtime, and
 * the assertions observe the committed display list — the same posture
 * as the other example tests. The BLE seam is a fake; replies are fed
 * back through lineIn exactly like a real notify would.
 */

function sceneTexts(runtime: WasherRuntime): string[] {
  const scene = runtime.render().scene;
  const texts: string[] = [];
  for (const op of scene.ops) if (op.op === "text") texts.push(op.text);
  return texts;
}

/** Tap-run id of the FIRST region containing the text op `label`. */
function tapIdFor(runtime: WasherRuntime, label: string): number {
  const { scene } = runtime.render();
  return scene.taps.findIndex((tap) =>
    scene.ops.some(
      (op) =>
        op.op === "text" &&
        op.text === label &&
        op.x >= tap.x &&
        op.x <= tap.x + tap.w &&
        op.y >= tap.y &&
        op.y <= tap.y + tap.h,
    ),
  );
}

function fakeBle(): { seam: BleSeam; writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    seam: {
      supported: () => true,
      connect: () => Promise.resolve(true),
      disconnect: () => undefined,
      write: (cmd: string) => {
        writes.push(cmd);
        return Promise.resolve(true);
      },
    },
  };
}

/** Every text op must sit inside the scene's own content box — guards
 *  against the double-offset bug that painted tiles below the
 *  scrollable area (fixed 2026-10-22). */
function assertSceneWithinBounds(runtime: WasherRuntime): void {
  const { scene } = runtime.render();
  for (const op of scene.ops) {
    if (op.op !== "text") continue;
    if (op.y > scene.contentHeight + 1 || op.x < -1 || op.x > scene.designWidth + 1) {
      throw new Error(`text op "${op.text}" outside scene bounds: x=${op.x} y=${op.y} contentHeight=${scene.contentHeight}`);
    }
  }
  for (const tap of scene.taps) {
    if (tap.y + tap.h > scene.contentHeight + 1) {
      throw new Error(`tap region at y=${tap.y} h=${tap.h} exceeds contentHeight=${scene.contentHeight}`);
    }
  }
}

describe("wire protocol parsing", () => {
  test("full ST line parses every field", () => {
    const st = parseStatus("ST:WASH|NORMAL|2/5|120|480|1010|142|W63");
    expect(st).not.toBeNull();
    expect(st!.mode).toBe("WASH");
    expect(st!.prog).toBe("NORMAL");
    expect(st!.step).toBe(2);
    expect(st!.steps).toBe(5);
    expect(st!.elapsedS).toBe(120);
    expect(st!.remainS).toBe(480);
    expect(st!.motorA).toBe(true);
    expect(st!.motorB).toBe(false);
    expect(st!.drain).toBe(true);
    expect(st!.inlet).toBe(false);
    expect(st!.heapKB).toBe(142);
    expect(st!.waterPct).toBe(63);
    expect(st!.running).toBe(true);
  });

  test("uncalibrated water (W-1) and legacy lines without the field degrade to null", () => {
    expect(parseStatus("ST:IDLE|READY|0/0|0|0|0000|180|W-1")!.waterPct).toBeNull();
    expect(parseStatus("ST:IDLE|READY|0/0|0|0|0000|180")!.waterPct).toBeNull();
    expect(parseStatus("ST:STOP|CEPAT|1/3|5|115|0000|180|W50")!.running).toBe(false);
  });

  test("garbage never throws and never parses as status", () => {
    expect(parseStatus("")).toBeNull();
    expect(parseStatus("OK WASH 600 s")).toBeNull();
    expect(parseStatus("ST:|")).toBeNull();
  });

  test("SET lines split on the FIRST space only (program strings keep commas/colons)", () => {
    expect(parseSetting("SET WASHMIN 10")).toEqual({ key: "WASHMIN", value: "10" });
    expect(parseSetting("SET PROG2 WASH:600, DRAIN:30, SPIN:300")).toEqual({
      key: "PROG2",
      value: "WASH:600, DRAIN:30, SPIN:300",
    });
    expect(parseSetting("SET PROG0 ")).toEqual({ key: "PROG0", value: "" });
    expect(parseSetting("ST:WASH|x")).toBeNull();
  });

  test("replies classify ok/busy/error; info lines are not replies", () => {
    expect(parseReply("OK WASH 600 s")).toEqual({ ok: true, busy: false, msg: "WASH 600 s" });
    expect(parseReply("BUSY - STOP first")!.busy).toBe(true);
    expect(parseReply("ERR seconds 1..3600")!.ok).toBe(false);
    expect(parseReply("CLOCK 10:24 (set: CLOCK 10:24)")).toBeNull();
    expect(parseReply("WATER raw 433 ema 430 pct -1 cal 0..0")).toBeNull();
  });

  test("clock formatting matches the LCD SISA style", () => {
    expect(fmtClock(480)).toBe("8:00");
    expect(fmtClock(65)).toBe("1:05");
    expect(fmtClock(-5)).toBe("0:00");
  });

  test("program token strings become human summaries; junk passes through", () => {
    expect(fmtDurationS(600)).toBe("10 mnt");
    expect(fmtDurationS(30)).toBe("30 dtk");
    expect(fmtProgramSummary("WASH:600, DRAIN:30, SPIN:300")).toBe("Cuci 10 mnt · Buang 30 dtk · Peras 5 mnt");
    expect(fmtProgramSummary("WASH:900, DRAIN:60, FILL:60, SPIN:300")).toBe(
      "Cuci 15 mnt · Buang 1 mnt · Isi 1 mnt · Peras 5 mnt",
    );
    expect(fmtProgramSummary("")).toBe("");
    expect(fmtProgramSummary("custom junk")).toBe("custom junk"); // never hide machine text
  });

  test("program steps parse into structured objects and format back cleanly", () => {
    const parsed = parseProgramSteps("WASH:600, DRAIN:30, SPIN:300");
    expect(parsed).toEqual([
      { mode: "WASH", s: 600 },
      { mode: "DRAIN", s: 30 },
      { mode: "SPIN", s: 300 },
    ]);
    expect(formatProgramSteps(parsed)).toBe("WASH:600, DRAIN:30, SPIN:300");
    expect(parseProgramSteps("")).toEqual([]);
    expect(parseProgramSteps("INVALID")).toEqual([]);
  });

  test("activity lines format into friendly Indonesian sentences", () => {
    expect(fmtActivityLine("> WASH")).toBe("Mulai Cuci");
    expect(fmtActivityLine("> PROG 0")).toBe("Mulai program CEPAT");
    expect(fmtActivityLine("> STOP")).toBe("Minta stop");
    expect(fmtActivityLine("OK WASH 600 s")).toBe("Cuci dimulai (10 mnt)");
    expect(fmtActivityLine("OK STOP")).toBe("Mesin berhenti");
    expect(fmtActivityLine("BUSY - STOP first")).toBe("Ditolak: mesin sedang berjalan");
    expect(fmtActivityLine("ERR motor fail")).toBe("ERR motor fail");
    expect(fmtActivityLine("> SET WASHMIN 11")).toBe("Atur WASHMIN");
    expect(fmtActivityLine("> SET PROG0 WASH:600")).toBe("Edit program CEPAT");
    expect(fmtActivityLine("OK SET WASHMIN")).toBe("Tersimpan: WASHMIN");
  });
});

describe("WasherRuntime screens", () => {
  test("offline home keeps washer controls visible and disabled", () => {
    const runtime = new WasherRuntime(); // no host services: unsupported
    let texts = sceneTexts(runtime).join("\n");
    // Connection state lives in the LinkHeader row — the canvas never
    // prints an all-caps Bluetooth banner.
    expect(texts).not.toContain("BLUETOOTH");
    expect(texts).toContain("Bluetooth tidak tersedia");
    expect(texts).toContain("Cuci");
    expect(texts).toContain("Peras");
    expect(texts).toContain("STOP MESIN");
    expect(tapIdFor(runtime, "Cuci")).toBe(-1);
    expect(tapIdFor(runtime, "STOP MESIN")).toBe(-1);
    expect(runtime.render().scene.taps).toHaveLength(0); // nothing tappable at all

    const supported = new WasherRuntime({ ble: fakeBle().seam });
    texts = sceneTexts(supported).join("\n");
    expect(texts).toContain("Tidak tersambung");
    expect(texts).toContain("SAMBUNGKAN"); // the header row offers the connect tap
    expect(texts).toContain("Cuci");
    expect(texts).toContain("Peras");
    expect(texts).toContain("belum pernah"); // offline cards keep the useful sub, lock says disabled
    expect(texts).toContain("belum ada aktivitas");
    expect(tapIdFor(supported, "Cuci")).toBe(-1);
    expect(tapIdFor(supported, "STOP MESIN")).toBe(-1);
    // Exactly ONE tappable surface offline: the header connect row.
    expect(supported.render().scene.taps).toHaveLength(1);
  });

  test("idle home shows the six-function icon grid and the navy program hero", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true, name: "Polytron Wash" });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W63");
    runtime.lineIn("SET PROG0 WASH:600, DRAIN:30, SPIN:300");
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Siap mencuci"); // green banner
    expect(texts).toContain("PROGRAM TERSIMPAN"); // navy hero card
    expect(texts).toContain("Mulai program"); // teal hero button
    expect(texts).toContain("±16 mnt · 3 tahap"); // hero meta from the tokens
    expect(texts).toContain("Fungsi mesin");
    expect(texts).toContain("STOP MESIN");
    expect(texts).toContain("Aktivitas terakhir");
    expect(texts).not.toContain("Sisa waktu"); // ring only while running
    // The whole grid is on the first screen: primary pair AND the
    // last-pair functions are all tappable without paging.
    for (const fn of ["Cuci", "Peras", "Buang", "Isi", "Bilas", "Bilas ND"]) {
      expect(tapIdFor(runtime, fn)).toBeGreaterThanOrEqual(0);
    }
    expect(tapIdFor(runtime, "Mulai program")).toBeGreaterThanOrEqual(0);
    assertSceneWithinBounds(runtime);
  });

  test("running home shows the ring hero, step chips and solid STOP", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true, name: "Polytron Wash" });
    runtime.lineIn("ST:WASH|NORMAL|2/5|120|480|1010|142|W63");
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Sedang mencuci"); // header title
    expect(texts).toContain("Sisa waktu"); // ring caption
    expect(texts).toContain("8:00"); // remaining inside the ring
    expect(texts).toContain("20%"); // elapsed/total
    expect(texts).toContain("Tahap 2 dari 5"); // stage banner sub
    expect(texts).toContain("Cuci"); // current-mode chip / banner title
    expect(texts).toContain("Ketinggian air"); // water wave card
    expect(texts).toContain("63%");
    expect(texts).toContain("Fungsi lain terkunci selama proses");
    expect(texts).not.toContain("Mulai program"); // hero hidden while running
    // Grid hidden while running — the ring replaced it (mockup 03).
    expect(tapIdFor(runtime, "Peras")).toBe(-1);
    expect(tapIdFor(runtime, "STOP MESIN")).toBeGreaterThanOrEqual(0);
    assertSceneWithinBounds(runtime);
  });

  test("running a known slot lights the full step timeline with the active step", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true, name: "Polytron Wash" });
    runtime.lineIn("SET PROG0 WASH:600, DRAIN:30, SPIN:300");
    runtime.lineIn("ST:WASH|CEPAT|2/3|630|30|1000|142|W63");
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Tahap 2 dari 3 · CEPAT");
    // All three step labels from the parsed tokens render as chips.
    expect(texts).toContain("Buang");
    expect(texts).toContain("Peras");
  });

  test("ST chatter stays out of the activity feed; commands and replies land", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:WASH|NORMAL|1/1|1|1|0000|180|W10");
    expect(sceneTexts(runtime).join("\n")).not.toContain("ST:WASH");
    runtime.lineIn("> WASH");
    runtime.lineIn("OK WASH 600 s");
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Mulai Cuci");
    expect(texts).toContain("Cuci dimulai (10 mnt)");
  });

  test("finished cycles show the completion banner and unlock the grid", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|DONE NORMAL|0/0|0|0|0000|180|W0");
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Siklus selesai"); // header title + banner
    expect(texts).toContain("Siklus selesai · NORMAL"); // banner names the program
    expect(tapIdFor(runtime, "Cuci")).toBeGreaterThanOrEqual(0); // grid back, enabled
  });

  test("SET lines stream to Settings and Programs", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("settings");
    runtime.lineIn("SET WASHMIN 10");
    runtime.lineIn("SET SPINMOTOR A");
    let texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Cuci min");
    expect(texts).toContain("10");
    expect(texts).toContain("MOTOR A");

    runtime.navigate("programs");
    runtime.lineIn("SET PROG1 WASH:600, DRAIN:30, SPIN:300");
    texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("NORMAL");
    expect(texts).toContain("Cuci 10 mnt · Buang 30 dtk · Peras 5 mnt");
    expect(texts).toContain("TUB CLEAN");
  });

  test("tap Cuci writes WASH; the reply lands in Recent Activity", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W10"); // idle → grid visible
    const tapId = tapIdFor(runtime, "Cuci");
    expect(tapId).toBeGreaterThanOrEqual(0);
    runtime.tap(tapId);
    runtime.lineIn("OK WASH 600 s");
    const texts = sceneTexts(runtime).join("\n");
    expect(ble.writes).toEqual(["WASH"]);
    expect(texts).toContain("Mulai Cuci");
    expect(texts).toContain("Cuci dimulai (10 mnt)");
    expect(texts).toContain("baru saja"); // usage sub-label flipped
  });

  test("BUSY replies warn in the activity feed while a cycle runs", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W80"); // idle → grid visible
    const tapId = tapIdFor(runtime, "Cuci");
    expect(tapId).toBeGreaterThanOrEqual(0);
    runtime.tap(tapId);
    runtime.lineIn("BUSY - STOP first");
    const texts = sceneTexts(runtime).join("\n");
    expect(ble.writes).toEqual(["WASH"]);
    expect(texts).toContain("Ditolak: mesin sedang berjalan");
  });

  test("offline Programs, Controls and Settings remain visible without unsafe taps", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    for (const [route, visible] of [
      ["programs", ["CEPAT", "NORMAL", "KUSTOM", "TUB CLEAN", "tersimpan di mesin"]],
      ["controls", ["Motor A", "Ketinggian air", "offline"]],
      ["settings", ["Durasi", "Lanjutan", "Motor peras", "Jam LCD", "Sensor air", "tersimpan"]],
    ] as const) {
      runtime.navigate(route);
      const texts = sceneTexts(runtime).join("\n");
      expect(texts).not.toContain("BLUETOOTH"); // header owns connection state
      for (const label of visible) expect(texts).toContain(label);
      // No unsafe taps; the ONLY offline tap is the header connect row.
      expect(runtime.render().scene.taps).toHaveLength(1);
      assertSceneWithinBounds(runtime);
    }
  });

  test("Controls tab shows live relays, the water wave and the running banner", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("controls");
    runtime.lineIn("ST:WASH|NORMAL|1/1|10|590|1000|142|W63");
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Motor A");
    expect(texts).toContain("Aktif"); // relay state wording
    expect(texts).toContain("Motor B");
    expect(texts).toContain("Nonaktif");
    expect(texts).toContain("63%");
    expect(texts).toContain("Mencuci · 9:50"); // running banner with remaining
  });

  test("settings steppers clamp to the firmware range and send immediately", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("settings");
    runtime.lineIn("SET WASHMIN 60"); // at max
    let tapId = tapIdFor(runtime, "+");
    expect(tapId).toBeGreaterThanOrEqual(0);
    runtime.tap(tapId); // + at max clamps to 60
    expect(ble.writes).toEqual(["SET WASHMIN 60"]);
    runtime.lineIn("SET WASHMIN 60");
    tapId = tapIdFor(runtime, "−");
    runtime.tap(tapId); // − steps to 59
    expect(ble.writes).toEqual(["SET WASHMIN 60", "SET WASHMIN 59"]);
  });

  test("an unloaded setting shows no stepper — no silent min-jump sends", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("settings");
    // Connected but no SET WASHMIN yet: the machine's real value is
    // unknown, so there is nothing safe to step from.
    expect(tapIdFor(runtime, "+")).toBe(-1);
    expect(sceneTexts(runtime).join("\n")).toContain("belum dimuat");
    expect(ble.writes).toEqual([]);
  });

  test("clock action sends the host time; missing host time explains itself", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam, clockNow: () => "10:24" });
    runtime.linkPush({ connected: true });
    runtime.navigate("settings");
    const tapId = tapIdFor(runtime, "SET CLOCK");
    expect(tapId).toBeGreaterThanOrEqual(0);
    runtime.tap(tapId);
    expect(ble.writes).toEqual(["CLOCK 10:24"]);
    runtime.lineIn("OK CLOCK 10:24");

    const noClock = new WasherRuntime({ ble: fakeBle().seam, clockNow: () => null });
    noClock.linkPush({ connected: true });
    noClock.navigate("settings");
    const t2 = tapIdFor(noClock, "SET CLOCK");
    noClock.tap(t2);
    expect(sceneTexts(noClock).join("\n")).toContain("waktu host tidak");
  });

  test("the canvas step editor resolves edits into a SET PROG write", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("programs");
    runtime.lineIn("SET PROG0 WASH:600");
    const tapId = tapIdFor(runtime, "Ubah");
    expect(tapId).toBeGreaterThanOrEqual(0);
    runtime.tap(tapId);
    // The editor opens pre-filled with the machine's tokens.
    let texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Edit · CEPAT");
    expect(texts).toContain("Cuci");
    expect(texts).toContain("Estimasi durasi");
    expect(texts).toContain("10 mnt");
    expect(texts).toContain("Simpan program");
    // Bump the duration 600 → 630 and save.
    runtime.tap(tapIdFor(runtime, "+"));
    runtime.tap(tapIdFor(runtime, "Simpan program"));
    expect(ble.writes).toEqual(["SET PROG0 WASH:630"]);
    texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Cuci 11 mnt"); // optimistic cache shows the edit
    runtime.dispose(); // the ack never arrives in this test
  });

  test("STOP from Controls while elsewhere still routes its reply back", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("controls");
    const tapId = tapIdFor(runtime, "STOP MESIN");
    expect(tapId).toBeGreaterThanOrEqual(0);
    runtime.tap(tapId);
    runtime.navigate("settings"); // user walks away mid-command
    runtime.lineIn("OK STOP");
    runtime.navigate("controls"); // returning shows the outcome
    expect(sceneTexts(runtime).join("\n")).toContain("OK · STOP");
    expect(ble.writes).toEqual(["STOP"]);
  });

  test("STOP is never blocked by a pending command", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W10"); // idle → grid visible
    const cucci = tapIdFor(runtime, "Cuci");
    runtime.tap(cucci); // no reply yet → Cuci still pending
    const stop = tapIdFor(runtime, "STOP MESIN");
    expect(stop).toBeGreaterThanOrEqual(0);
    runtime.tap(stop); // safety command must fire anyway
    expect(ble.writes).toEqual(["WASH", "STOP"]);
    runtime.dispose(); // no reply will ever settle these two
  });

  test("a BUSY SET rolls the optimistic value back — motor B never lingers", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("settings");
    runtime.lineIn("SET SPINMOTOR A");
    runtime.tap(tapIdFor(runtime, "B")); // optimistic A → B
    expect(ble.writes).toEqual(["SET SPINMOTOR B"]);
    runtime.lineIn("BUSY - STOP first"); // machine rejects it
    expect(sceneTexts(runtime).join("\n")).toContain("aktif: MOTOR A"); // reverted
    runtime.tap(tapIdFor(runtime, "B")); // retry still starts from A
    expect(ble.writes).toEqual(["SET SPINMOTOR B", "SET SPINMOTOR B"]);
  });

  test("a failed SET write rolls the optimistic value back", async () => {
    const ble = fakeBle();
    const seam: BleSeam = {
      ...ble.seam,
      write: async (cmd: string) => {
        ble.writes.push(cmd);
        return false; // radio dropped it
      },
    };
    const runtime = new WasherRuntime({ ble: seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("settings");
    runtime.lineIn("SET WASHMIN 10");
    runtime.tap(tapIdFor(runtime, "+")); // 10 → 11 optimistic, write fails
    await new Promise((r) => setTimeout(r, 0));
    runtime.tap(tapIdFor(runtime, "+")); // steps from the RESTORED 10 again
    expect(ble.writes).toEqual(["SET WASHMIN 11", "SET WASHMIN 11"]);
  });

  test("a rejected program edit rolls the cached tokens back", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("programs");
    runtime.lineIn("SET PROG0 WASH:600");
    runtime.tap(tapIdFor(runtime, "Ubah")); // open the canvas editor
    runtime.tap(tapIdFor(runtime, "+")); // 600 → 630
    runtime.tap(tapIdFor(runtime, "Simpan program"));
    expect(ble.writes).toEqual(["SET PROG0 WASH:630"]);
    // Optimistic window: the edited summary shows before the reply.
    expect(sceneTexts(runtime).join("\n")).toContain("Cuci 11 mnt");
    runtime.lineIn("BUSY - STOP first");
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).not.toContain("Cuci 11 mnt"); // optimistic edit gone
    expect(texts).toContain("Cuci 10 mnt"); // machine's stored program intact
  });

  test("quiet GET:ALL ack settles only itself — cannot steal a user reply", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W10"); // idle → grid visible
    runtime.send("GET:ALL", { quiet: true });
    runtime.tap(tapIdFor(runtime, "Cuci")); // user fires before the ack lands
    runtime.lineIn("OK 14 settings follow"); // GET's own ack
    runtime.lineIn("OK WASH 600 s"); // WASH's reply — must reach WASH
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Cuci dimulai (10 mnt)");
    expect(texts).not.toContain("MENGIRIM");
    expect(texts).not.toContain("GET:ALL"); // housekeeping stays out of the feed
  });

  test("replies route to the screen that SENT each command — a query from another tab cannot steal a reply", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|142|W63"); // idle → grid visible
    runtime.tap(tapIdFor(runtime, "Cuci")); // Home sends WASH, no reply yet
    runtime.navigate("controls");
    runtime.tap(tapIdFor(runtime, "KIRIM")); // Controls sends WATER meanwhile
    // Serial wire answers in order: this reply settles WASH (the front).
    runtime.lineIn("OK WASH 600 s");
    runtime.lineIn("WATER raw 433 ema 430 pct 63 cal 310..1024");
    runtime.navigate("home");
    const homeTexts = sceneTexts(runtime).join("\n");
    expect(homeTexts).not.toContain("MENGIRIM"); // Home's tile un-stuck
    expect(homeTexts).toContain("Cuci dimulai (10 mnt)");
    runtime.navigate("controls");
    expect(sceneTexts(runtime).join("\n")).toContain("WATER raw 433"); // Controls got its own reply
    // Home's single-flight guard is free again
    runtime.navigate("home");
    runtime.tap(tapIdFor(runtime, "Peras"));
    expect(ble.writes).toEqual(["WASH", "WATER", "SPIN"]);
  });

  test("disconnect settles in-flight commands — no tile sticks on MENGIRIM", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W-1");
    runtime.tap(tapIdFor(runtime, "Cuci")); // write ok, reply never comes
    runtime.linkPush({ connected: false }); // link drops mid-command
    runtime.linkPush({ connected: true });
    const again = tapIdFor(runtime, "Cuci");
    expect(again).toBeGreaterThanOrEqual(0); // un-stuck: tappable again
    runtime.tap(again);
    expect(ble.writes).toEqual(["WASH", "WASH"]);
  });

  test("stepped settings survive navigation — no phantom revert after the ack", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.navigate("settings");
    runtime.lineIn("SET WASHMIN 10");
    runtime.tap(tapIdFor(runtime, "+")); // 10 → 11
    expect(ble.writes).toEqual(["SET WASHMIN 11"]);
    runtime.lineIn("OK SET WASHMIN"); // firmware ack carries NO value echo
    runtime.navigate("home");
    runtime.navigate("settings");
    expect(sceneTexts(runtime).join("\n")).toContain("11"); // not reverted to 10
    runtime.tap(tapIdFor(runtime, "+"));
    expect(ble.writes).toEqual(["SET WASHMIN 11", "SET WASHMIN 12"]); // steps from 11
  });

  test("connected before the first status shows MENUNGGU — never a fake SIAP/IDLE", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true, name: "Polytron Wash" });
    let texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Menunggu status…");
    expect(texts).toContain("menunggu kabar pertama dari mesin");
    expect(texts).not.toContain("Siap mencuci");
    runtime.navigate("controls");
    texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Menunggu status…");
    expect(texts).not.toContain("Siap");
    expect(texts).toContain("belum terbaca"); // unknown ≠ "belum dikalibrasi"
  });

  test("while a cycle runs, Program MULAI and edit are visibly unavailable", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:WASH|NORMAL|1/5|0|600|1000|142|W63");
    runtime.navigate("programs");
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Mesin sedang berjalan"); // banner explains WHY
    expect(texts).toContain("MULAI"); // label still visible…
    expect(tapIdFor(runtime, "MULAI")).toBe(-1); // …but inert, matching the guidance
    expect(tapIdFor(runtime, "Ubah")).toBe(-1);
    expect(ble.writes).toEqual([]);
  });

  test("while a cycle runs, tapping the running banner on Programs or Controls jumps to Home", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:WASH|NORMAL|1/5|0|600|1000|142|W63");
    expect(runtime.status()?.running).toBe(true);

    runtime.navigate("programs");
    expect(runtime.route()).toBe("programs");
    // The running banner card is tappable (h=68 with sub)
    const progBannerTap = runtime.render().scene.taps.find((t) => t.h === 68);
    expect(progBannerTap).toBeDefined();
    const tapId = (progBannerTap!.payload as { id: number }).id;
    runtime.tap(tapId);
    expect(runtime.route()).toBe("home"); // navigated back to Home

    runtime.navigate("controls");
    expect(runtime.route()).toBe("controls");
    const ctrlBannerTap = runtime.render().scene.taps.find((t) => t.h === 68);
    expect(ctrlBannerTap).toBeDefined();
    const ctrlTapId = (ctrlBannerTap!.payload as { id: number }).id;
    runtime.tap(ctrlTapId);
    expect(runtime.route()).toBe("home");
  });

  test("disconnect clears runtime.status()", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:WASH|NORMAL|1/5|0|600|1000|142|W63");
    expect(runtime.status()).not.toBeNull();
    runtime.linkPush({ connected: false });
    expect(runtime.status()).toBeNull();
  });

  test("failed writes recover the pending state via an ERR feed row", async () => {
    const ble = fakeBle();
    const seam: BleSeam = {
      ...ble.seam,
      write: async (cmd: string) => {
        ble.writes.push(cmd);
        return false; // radio dropped it
      },
    };
    const runtime = new WasherRuntime({ ble: seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W10"); // idle → grid visible
    runtime.tap(tapIdFor(runtime, "Cuci"));
    await new Promise((r) => setTimeout(r, 0)); // write result settles
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("ERR kirim gagal"); // feed explains it
    expect(texts).not.toContain("MENGIRIM"); // pending cleared — later commands unblocked
    runtime.tap(tapIdFor(runtime, "Cuci")); // retry works again
    expect(ble.writes).toEqual(["WASH", "WASH"]);
  });

  test("disconnect clears stale live status — no ghost cycle (demo-off included)", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true, name: "DEMO" });
    runtime.lineIn("ST:WASH|NORMAL|2/5|120|480|1000|142|W63");
    runtime.linkPush({ connected: false });
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Tidak tersambung"); // header back to offline
    expect(texts).not.toContain("Sisa waktu"); // ring gone
    expect(texts).not.toContain("8:00"); // cycle numbers gone
  });

  test("a native-shaped failure event (no connecting field) releases the connecting lock", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connecting: true });
    expect(runtime.link().connecting).toBe(true);
    // Exact native notifyLink(false, name) shape — this used to leave
    // connecting merged-true forever (permanent MENYAMBUNG, no retry).
    runtime.linkPush({ connected: false, name: "" });
    expect(runtime.link().connecting).toBe(false);
    // And a reconnect attempt can proceed through the same path.
    runtime.linkPush({ connecting: true, phase: "scanning" });
    expect(runtime.link().connecting).toBe(true);
    expect(runtime.link().phase).toBe("scanning");
    runtime.linkPush({ connected: true, name: "Polytron Wash" });
    expect(runtime.link().connecting).toBe(false); // success is terminal too
    expect(runtime.link().phase).toBeNull();
  });

  test("dropping the link mid-cycle warns the machine may still run; fresh IDLE clears it", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true, name: "Polytron Wash" });
    runtime.lineIn("ST:WASH|NORMAL|2/5|120|480|1000|142|W63");
    runtime.linkPush({ connected: false, name: "" });
    let texts = sceneTexts(runtime).join("\n");
    // The warning must carry BOTH halves — the risk and the physical remedy
    // (wrap splits the sentence across snack lines — assert the pieces).
    expect(texts).toContain("Mesin MUNGKIN masih");
    expect(texts).toContain("berjalan");
    expect(texts).toContain("tombol");
    expect(texts).toContain("fisik");
    // Reconnect + machine itself reporting IDLE retires the warning.
    runtime.linkPush({ connected: true, name: "Polytron Wash" });
    runtime.lineIn("ST:IDLE|READY|0/0|0/0|0000|180|W-1");
    texts = sceneTexts(runtime).join("\n");
    expect(texts).not.toContain("MUNGKIN");
  });

  test("a STOP that dies with the link is reported unconfirmed — never as stopped", () => {
    const ble = fakeBle();
    const runtime = new WasherRuntime({ ble: ble.seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:WASH|NORMAL|1/5|0|600|1000|142|W63");
    runtime.tap(tapIdFor(runtime, "STOP MESIN"));
    expect(ble.writes).toContain("STOP");
    runtime.linkPush({ connected: false, name: "" });
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("STOP belum terkonfirmasi");
    expect(texts).toContain("cek mesin");
  });

  test("silent telemetry goes stale: frozen-data banner shown, starts gated, STOP stays armed", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W-1");
    expect(runtime.statusStale()).toBe(false);
    const realNow = Date.now;
    const frozen = realNow();
    Date.now = () => frozen + 20_000; // 20 s of radio silence while connected
    try {
      expect(runtime.statusStale()).toBe(true);
      const texts = sceneTexts(runtime).join("\n");
      expect(texts).toContain("Data mesin beku");
      expect(texts).toContain("tidak diperbarui");
      expect(tapIdFor(runtime, "Cuci")).toBe(-1); // new starts blocked…
      expect(tapIdFor(runtime, "STOP MESIN")).toBeGreaterThanOrEqual(0); // …STOP never
      runtime.navigate("controls");
      expect(sceneTexts(runtime).join("\n")).toContain("Data mesin beku");
    } finally {
      Date.now = realNow;
    }
    // Fresh telemetry un-stales immediately.
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W-1");
    expect(runtime.statusStale()).toBe(false);
    expect(sceneTexts(runtime).join("\n")).not.toContain("Data mesin beku");
  });

  test("offline Controls explains that app STOP needs a connection", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:WASH|NORMAL|1/5|0|600|1000|142|W63");
    runtime.navigate("controls");
    runtime.linkPush({ connected: false, name: "" });
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("STOP aplikasi butuh sambungan");
    expect(texts).toContain("tombol fisik");
  });

  test("connecting shows the orbit spinner in the header; connected shows a plain dot", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    // Header-scoped: only circles inside the LinkHeader band count —
    // function icons (spin/droplet glyphs) also draw small circles.
    const dotAt = () => runtime.render().scene.ops.filter((op) => op.op === "circle" && op.r === 5 && op.cy < 90).length;
    const orbitAt = () => runtime.render().scene.ops.filter((op) => op.op === "circle" && op.r > 1 && op.r < 4 && op.cy < 90).length;
    // connecting: spinner orbiting, no static dot
    runtime.linkPush({ connecting: true, phase: "scanning" });
    expect(dotAt()).toBe(0);
    expect(orbitAt()).toBeGreaterThanOrEqual(8);
    // connected idle: static green dot back, orbit gone
    runtime.linkPush({ connected: true, name: "Polytron Wash" });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W-1");
    expect(dotAt()).toBe(1);
    expect(orbitAt()).toBe(0);
    // and the orbit phase actually advances with the clock
    runtime.linkPush({ connected: false, name: "" });
    runtime.linkPush({ connecting: true, phase: "scanning" });
    const realNow = Date.now;
    Date.now = () => 5_000_000;
    const a = runtime.render().scene.ops.filter((op) => op.op === "circle" && op.r === 3 && op.cy < 90).map((op) => op.cy);
    Date.now = () => 5_000_520; // ~4 head-steps later
    const b = runtime.render().scene.ops.filter((op) => op.op === "circle" && op.r === 3 && op.cy < 90).map((op) => op.cy);
    Date.now = realNow;
    expect(a).not.toEqual(b);
  });

  test("an unparseable ST fragment never reaches the activity feed", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:WASH|WASH 20min|11"); // a split-line fragment, as BLE chunks arrive
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Menunggu status…"); // still honestly waiting
    expect(texts).not.toContain("ST:WASH|WASH 20min"); // not feed noise
  });

  test("every screen stays inside its content bounds after the layout fix", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:WASH|NORMAL|2/5|120|480|1000|142|W63");
    for (const l of ["SET WASHMIN 10", "SET PULSES 2.5", "SET SPINMOTOR B", "SET PROG1 WASH:600, DRAIN:30, SPIN:300"]) {
      runtime.lineIn(l);
    }
    for (const route of runtime.routes()) {
      runtime.navigate(route);
      assertSceneWithinBounds(runtime);
    }
  });

  test("320px: the header link label truncates before its right meta — no overlap", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam, designWidth: 320 });
    runtime.linkPush({ connected: true, name: "Polytron Wash Super Long Name" });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W63");
    const row = runtime.render().scene.ops.filter((op) => op.op === "text" && op.y > 60 && op.y < 90);
    const label = row.find((op) => op.text.startsWith("Terhubung"));
    const right = row.find((op) => op.text.startsWith("Data"));
    expect(label).toBeDefined();
    expect(right).toBeDefined();
    // The label truncates against the LinkHeader's right-meta budget.
    expect(label!.x + textWidth(label!.text, 13.5)).toBeLessThanOrEqual(right!.x - 2);
    assertSceneWithinBounds(runtime);
  });

  test("320px: the water card label clears the % value; nothing runs under a pill", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam, designWidth: 320 });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:WASH|NORMAL|1/5|0|600|1000|142|W63");
    runtime.navigate("settings");
    const scene = runtime.render().scene;
    // The wave card: label left, % right — must not overlap at 320.
    const label = scene.ops.find((op) => op.op === "text" && op.text === "Ketinggian air");
    const pct = scene.ops.find((op) => op.op === "text" && op.text === "63%");
    expect(label).toBeDefined();
    expect(pct).toBeDefined();
    expect(label!.x + textWidth(label!.text, 13.5)).toBeLessThanOrEqual(pct!.x - 4);
    // Calibration rows: label + sub truncate before their right pill.
    const kal = scene.ops.find((op) => op.op === "text" && op.text.startsWith("Kalibrasi"));
    const sub = scene.ops.find((op) => op.op === "text" && op.text.startsWith("isi ulang referensi"));
    const pillTap = scene.taps.find((t) => t.h === 44 && kal!.y >= t.y - 6 && kal!.y <= t.y + t.h + 6);
    expect(pillTap).toBeDefined();
    expect(kal!.x + textWidth(kal!.text, 13.5)).toBeLessThanOrEqual(pillTap!.x - 8);
    expect(sub!.x + textWidth(sub!.text, 10.5)).toBeLessThanOrEqual(pillTap!.x - 8);
    expect(kal!.text.endsWith("…")).toBe(true); // clipped, not overlapping
    expect(sub!.text.endsWith("…")).toBe(true);
    assertSceneWithinBounds(runtime);
  });

  test("connected touch targets stay ≥40px tall on every tab", () => {
    const runtime = new WasherRuntime({ ble: fakeBle().seam });
    runtime.linkPush({ connected: true });
    runtime.lineIn("ST:IDLE|READY|0/0|0|0|0000|180|W-1");
    runtime.lineIn("SET WASHMIN 10");
    runtime.lineIn("SET SPINMOTOR B");
    runtime.lineIn("SET PROG0 WASH:300");
    for (const route of runtime.routes()) {
      runtime.navigate(route);
      const taps = runtime.render().scene.taps;
      expect(taps.length).toBeGreaterThan(0);
      for (const tap of taps) {
        expect(tap.h).toBeGreaterThanOrEqual(40); // wet-hands minimum
      }
    }
  });
});

describe("BLE write queue", () => {
  test("a failed write does not poison later writes — STOP still goes out", async () => {
    const attempted: string[] = [];
    let failNext = true;
    const queue = createWriteQueue(
      async (cmd: string) => {
        attempted.push(cmd);
        if (failNext) {
          failNext = false;
          throw new Error("radio gone");
        }
      },
      () => {},
    );
    expect(await queue.enqueue("WASH")).toBe(false);
    expect(await queue.enqueue("STOP")).toBe(true); // chain recovered
    expect(attempted).toEqual(["WASH", "STOP"]);
  });

  test("writes stay serialized in send order", async () => {
    const order: string[] = [];
    let running = false;
    const queue = createWriteQueue(
      (cmd: string) =>
        new Promise<void>((resolve) => {
          expect(running).toBe(false); // never two in flight
          running = true;
          setTimeout(() => {
            running = false;
            order.push(cmd);
            resolve();
          }, 1);
        }),
      () => {},
    );
    await Promise.all([queue.enqueue("A"), queue.enqueue("B"), queue.enqueue("C")]);
    expect(order).toEqual(["A", "B", "C"]);
  });
});

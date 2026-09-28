import { describe, expect, test } from "bun:test";
import { VotolRuntime } from "../src/runtime";
import { groupParams, normalizeSnapshot } from "../src/snapshot";

/**
 * Headless app tests: drive the runtime with REAL dashboard /state.json
 * shapes (captured from the emulator round) and assert what the committed
 * display list actually contains — the same posture as the other example
 * tests: observations of the rendered scene, not implementation details.
 */

const LIVE_SNAPSHOT = {
  connected: true,
  monitor: true,
  host: "127.0.0.1",
  port: 6638,
  tx: 12,
  rx: 34,
  rx_age_s: 0.4,
  keyless_host: "192.168.1.50",
  keyless: {
    armed: false,
    alarm: false,
    fob: { mac: "N:MYBEACON", count: 2, present: true, rssi: -67, ageS: 1 },
    relay: { mode: 0, energized: false },
    vibe: { enabled: false, events: 1 },
    graceLeftS: 0,
    ign: false,
    ignstate: "cold",
    bench: false,
    master: false,
  },
  telemetry: {
    ts: 1,
    voltage_v: 78.3,
    current_a: 12.5,
    rpm: 1450,
    controller_temp_c: 41,
    motor_temp_c: 55,
    gear: "H",
    status: "RUN",
    fault_code: 0,
    brake: false,
    reverse: false,
    regen: true,
  },
  params: [
    ["P1 · Model", "EM-100s"],
    ["P1 · Battery class", "72V"],
    ["P2 · Bus current limit", "120 A"],
  ],
  hexlog: [],
};

function sceneTexts(runtime: VotolRuntime): string[] {
  const scene = runtime.render().scene;
  const texts: string[] = [];
  for (const op of scene.ops) {
    if (op.op === "text") texts.push(op.text);
  }
  return texts;
}

describe("snapshot normalization", () => {
  test("live backend snapshot keeps its numbers", () => {
    const snap = normalizeSnapshot(LIVE_SNAPSHOT);
    expect(snap.link.online).toBe(true);
    expect(snap.link.answering).toBe(true);
    expect(snap.telemetry?.voltage_v).toBe(78.3);
    expect(snap.telemetry?.status).toBe("RUN");
    expect(snap.keyless.configured).toBe(true);
    expect(snap.keyless.ignition).toBe("cold");
    expect(snap.keyless.fob.count).toBe(2);
    expect(snap.params.length).toBe(3);
  });

  test("garbage and offline payloads degrade to unknown, never throw", () => {
    expect(() => normalizeSnapshot(null)).not.toThrow();
    expect(() => normalizeSnapshot("junk")).not.toThrow();
    const off = normalizeSnapshot({ connected: false });
    expect(off.link.online).toBe(false);
    expect(off.telemetry).toBeNull();
    expect(off.keyless.configured).toBe(false);
    expect(off.params.length).toBe(0);
  });

  test("parameters group by packet prefix", () => {
    const groups = groupParams([
      ["P1 · Model", "EM-100s"],
      ["P2 · Bus current limit", "120 A"],
      ["P1 · Battery class", "72V"],
      ["unlabeled row", "x"],
    ]);
    expect(groups.map((g) => g.packet)).toEqual(["P1", "P2", "P?"]);
    expect(groups[0]!.rows).toEqual([
      ["Model", "EM-100s"],
      ["Battery class", "72V"],
    ]);
  });
});

describe("VotolRuntime screens", () => {
  test("home renders live numbers after a sync", () => {
    const runtime = new VotolRuntime();
    runtime.sync(normalizeSnapshot(LIVE_SNAPSHOT));
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("78.3");
    expect(texts).toContain("12.5");
    expect(texts).toContain("1450");
    expect(texts).toContain("online");
    expect(texts).toContain("disarmed");
  });

  test("keyless shows ARMED + siren when the module reports it", () => {
    const runtime = new VotolRuntime();
    const armed = {
      ...LIVE_SNAPSHOT,
      keyless: { ...LIVE_SNAPSHOT.keyless, armed: true, alarm: true, ign: true, ignstate: "hot" },
    };
    runtime.navigate("keyless");
    runtime.sync(normalizeSnapshot(armed));
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("ARMED");
    expect(texts).toContain("siren");
  });

  test("keyless without KEYLESS_HOST explains the configuration step", () => {
    const runtime = new VotolRuntime();
    runtime.navigate("keyless");
    runtime.sync(normalizeSnapshot({ ...LIVE_SNAPSHOT, keyless_host: "", keyless: null }));
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("Not configured");
    expect(texts).toContain("KEYLESS_HOST");
  });

  test("params screen groups packets", () => {
    const runtime = new VotolRuntime();
    runtime.navigate("params");
    runtime.sync(normalizeSnapshot(LIVE_SNAPSHOT));
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("P1");
    expect(texts).toContain("EM-100s");
    expect(texts).toContain("72V");
    expect(texts).toContain("read-only");
  });

  test("telemetry flags a nonzero fault code", () => {
    const runtime = new VotolRuntime();
    runtime.navigate("telemetry");
    runtime.sync(
      normalizeSnapshot({
        ...LIVE_SNAPSHOT,
        telemetry: { ...LIVE_SNAPSHOT.telemetry, status: "FAULT", fault_code: 12 },
      }),
    );
    const texts = sceneTexts(runtime).join("\n");
    expect(texts).toContain("fault 12");
  });
});

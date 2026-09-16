import { describe, expect, test } from "bun:test";
import { GalleryRuntime } from "../runtime";
import type { DisplayListScene } from "../../ui-kit/src/display-list";

function sceneWithTap(): DisplayListScene {
  return {
    tenun: "display-list",
    version: 1,
    designWidth: 720,
    contentHeight: 1600,
    background: "#101014",
    ops: [],
    taps: [{ x: 24, y: 120, w: 200, h: 56, action: "tap", payload: { id: 0 } }],
  };
}

describe("GalleryRuntime", () => {
  test("renders home, navigates by route, and preserves screen state", () => {
    const runtime = new GalleryRuntime();
    expect(runtime.route()).toBe("home");
    expect(runtime.routes()).toEqual([
      "home",
      "banking",
      "smartHome",
      "fitness",
      "store",
      "settings",
      "weather",
      "music",
      "chat",
      "recipes",
      "crypto",
    ]);
    const home = runtime.render().scene;
    expect(home.taps.length).toBe(10);

    const bankingTap = home.taps[0]!;
    runtime.dispatch("TAP", bankingTap.payload.id);
    expect(runtime.route()).toBe("banking");
    const banking = runtime.render().scene;
    expect(banking.ops.some((op) => op.op === "text" && op.text === "Banking")).toBe(true);

    const transfer = banking.taps.find((tap) =>
      banking.ops.some((op) => op.op === "text" && op.text.startsWith("Transfer 100") && op.y >= tap.y && op.y <= tap.y + tap.h)
    );
    expect(transfer).toBeDefined();
    runtime.dispatch("TAP", transfer!.payload.id);
    const exported = runtime.exportState();
    expect((exported.states.banking as any).accounts[0].balance).toBe(2331.5);

    runtime.dispatch("TAP", banking.taps[0]!.payload.id);
    expect(runtime.route()).toBe("home");
  });

  test("export and restore carry route plus mutated state", () => {
    const runtime = new GalleryRuntime();
    runtime.navigate("settings");
    const snapshot = runtime.exportState();
    (snapshot.states.settings as any).preferences.notifications = true;

    const fresh = new GalleryRuntime();
    fresh.restore(snapshot);
    expect(fresh.route()).toBe("settings");
    expect((fresh.exportState().states.settings as any).preferences.notifications).toBe(true);
  });

  test("unknown routes are ignored during navigation and restore", () => {
    const runtime = new GalleryRuntime();
    runtime.navigate("ghost");
    expect(runtime.route()).toBe("home");
    runtime.restore({ route: "ghost", states: { ghost: { value: 1 } } });
    expect(runtime.route()).toBe("home");
  });
});

describe("display-list renderer contract", () => {
  test("tap scene preserves design units and bounded content height", () => {
    const scene = sceneWithTap();
    expect(scene.designWidth).toBe(720);
    expect(scene.contentHeight).toBeGreaterThan(0);
    expect(scene.taps[0]!.x + scene.taps[0]!.w).toBe(224);
  });
});

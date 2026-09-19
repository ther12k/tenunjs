import { describe, expect, test } from "bun:test";
import { ShowcaseRuntime, STATE_SCHEMA } from "../runtime";
import type { ShowcaseSnapshot } from "../runtime";

function tapByText(runtime: ShowcaseRuntime, text: string): number {
  const scene = runtime.render().scene;
  const op = scene.ops.find((candidate) => candidate.op === "text" && candidate.text === text);
  expect(op).toBeDefined();
  const tap = scene.taps.find((candidate) =>
    candidate.x <= (op as { x: number }).x &&
    (op as { x: number }).x <= candidate.x + candidate.w &&
    candidate.y <= (op as { y: number }).y &&
    (op as { y: number }).y <= candidate.y + candidate.h
  );
  expect(tap).toBeDefined();
  return tap!.payload.id;
}

function hotelState(runtime: ShowcaseRuntime): { filterOpen: boolean } {
  return runtime.exportState().appStates.hotel as { filterOpen: boolean };
}

describe("ShowcaseRuntime launcher host", () => {
  test("boots to the launcher with the full independent-app catalog", () => {
    const runtime = new ShowcaseRuntime();
    expect(STATE_SCHEMA).toBe(2);
    expect(runtime.isLauncher()).toBe(true);
    expect(runtime.activeAppId()).toBeNull();
    expect(runtime.route()).toBe("home");
    expect(runtime.routes()).toEqual(["home", "intro", "hotel", "fitness", "course", "navigation"]);
    expect(runtime.apps().map((app) => app.id)).toEqual(["intro", "hotel", "fitness", "course", "navigation"]);
    const scene = runtime.render().scene;
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Beautiful by design")).toBe(true);
    expect(scene.ops.some((op) => op.op === "text" && op.text === "Hotel booking")).toBe(true);
  });

  test("opening an app from the launcher swaps the surface and keeps launcher state", () => {
    const runtime = new ShowcaseRuntime();
    // Home-screen icons: the whole tile (label included) is the tap target.
    runtime.dispatch("TAP", tapByText(runtime, "Hotel booking"));
    expect(runtime.isLauncher()).toBe(false);
    expect(runtime.activeAppId()).toBe("hotel");
    expect(runtime.route()).toBe("hotel");
    expect(runtime.render().scene.ops.some((op) => op.op === "text" && op.text === "Stay somewhere special")).toBe(true);
    const snapshot = runtime.exportState();
    expect(snapshot.surface).toBe("app");
    expect(snapshot.appId).toBe("hotel");
    expect((snapshot.launcherState as { opened: string | null }).opened).toBe("hotel");
  });

  test("closing and reopening an app resumes its session state", () => {
    const runtime = new ShowcaseRuntime();
    runtime.openApp("hotel");
    runtime.dispatch("TAP", tapByText(runtime, "Filters"));
    expect(hotelState(runtime).filterOpen).toBe(true);

    runtime.closeApp();
    expect(runtime.isLauncher()).toBe(true);
    expect(runtime.render().scene.ops.some((op) => op.op === "text" && op.text === "Beautiful by design")).toBe(true);

    runtime.openApp("hotel");
    expect(runtime.isLauncher()).toBe(false);
    expect(hotelState(runtime).filterOpen).toBe(true);
    expect(runtime.render().scene.ops.some((op) => op.op === "text" && op.text === "Filter stays")).toBe(true);
  });

  test("two app sessions stay isolated from each other", () => {
    const runtime = new ShowcaseRuntime();
    runtime.openApp("hotel");
    runtime.dispatch("TAP", tapByText(runtime, "Filters"));
    runtime.openApp("fitness");
    const fitness = runtime.exportState().appStates.fitness as { completedWorkout: boolean; stepsToday: number };
    expect(fitness.completedWorkout).toBe(false);
    expect(fitness.stepsToday).toBe(4820);
    expect(runtime.render().scene.ops.some((op) => op.op === "text" && op.text === "Good morning, Rizky")).toBe(true);
    // The hotel session keeps its own mutated state meanwhile.
    expect(hotelState(runtime).filterOpen).toBe(true);
  });

  test("the generic back tap and navigate('home') both return to the launcher", () => {
    const runtime = new ShowcaseRuntime();
    runtime.openApp("hotel");
    const scene = runtime.render().scene;
    // Host contract: the first region on an app surface is back-to-launcher.
    runtime.dispatch("TAP", scene.taps[0]!.payload.id);
    expect(runtime.isLauncher()).toBe(true);

    runtime.navigate("hotel");
    expect(runtime.activeAppId()).toBe("hotel");
    runtime.navigate("home");
    expect(runtime.isLauncher()).toBe(true);
  });

  test("unknown app ids are ignored on open and navigate", () => {
    const runtime = new ShowcaseRuntime();
    runtime.openApp("ghost" as never);
    expect(runtime.isLauncher()).toBe(true);
    runtime.navigate("ghost");
    expect(runtime.isLauncher()).toBe(true);
    runtime.openApp("hotel");
    runtime.navigate("ghost");
    expect(runtime.activeAppId()).toBe("hotel");
  });

  test("schema-2 export/restore preserves host surface and every app session", () => {
    const runtime = new ShowcaseRuntime();
    runtime.dispatch("TAP", tapByText(runtime, "Hotel booking"));
    runtime.dispatch("TAP", tapByText(runtime, "Filters"));
    runtime.closeApp();
    const snapshot: ShowcaseSnapshot = JSON.parse(JSON.stringify(runtime.exportState()));
    expect(snapshot.stateSchema).toBe(2);

    const restored = new ShowcaseRuntime();
    restored.restore(snapshot);
    expect(restored.isLauncher()).toBe(true);
    expect((restored.exportState().launcherState as { opened: string | null }).opened).toBe("hotel");
    expect(hotelState(restored).filterOpen).toBe(true);
    expect(restored.stateSchema()).toBe(2);

    restored.openApp("hotel");
    expect(restored.render().scene.ops.some((op) => op.op === "text" && op.text === "Filter stays")).toBe(true);
  });

  test("restoring a snapshot taken inside an app reopens that app", () => {
    const runtime = new ShowcaseRuntime();
    runtime.openApp("fitness");
    const snapshot = runtime.exportState();
    const restored = new ShowcaseRuntime();
    restored.restore(snapshot);
    expect(restored.isLauncher()).toBe(false);
    expect(restored.activeAppId()).toBe("fitness");
    expect(restored.render().scene.ops.some((op) => op.op === "text" && op.text === "Good morning, Rizky")).toBe(true);
  });

  test("schema-1 flat snapshots migrate into launcher plus app sessions", () => {
    const restored = new ShowcaseRuntime();
    restored.restore({
      route: "hotel",
      stateSchema: 1,
      states: {
        home: { opened: "hotel", drawerOpen: false },
        hotel: { filterOpen: true, guests: 4 },
      },
    } as never);
    expect(restored.isLauncher()).toBe(false);
    expect(restored.activeAppId()).toBe("hotel");
    expect((restored.exportState().launcherState as { opened: string | null }).opened).toBe("hotel");
    expect(hotelState(restored).filterOpen).toBe(true);

    const home = new ShowcaseRuntime();
    home.restore({ route: "home", stateSchema: 1, states: {} } as never);
    expect(home.isLauncher()).toBe(true);

    const ghost = new ShowcaseRuntime();
    ghost.restore({ route: "ghost", stateSchema: 1, states: { ghost: { value: 1 } } } as never);
    expect(ghost.isLauncher()).toBe(true);
  });
});

describe("ShowcaseRuntime display-list contract", () => {
  test("fixed drawer metadata survives inside an opened app with long content", () => {
    const runtime = new ShowcaseRuntime();
    runtime.openApp("navigation");
    runtime.dispatch("TAP", tapByText(runtime, "Open drawer"));
    const scene = runtime.render().scene;
    const fixedOps = scene.ops.filter((op) => op.fixed);
    expect(fixedOps.length).toBeGreaterThan(0);
    expect(fixedOps.some((op) => op.op === "text" && op.text === "Move through the app")).toBe(true);
    expect(scene.taps.some((tap) => tap.fixed === true)).toBe(true);
    expect(scene.contentHeight).toBeGreaterThan(900);
  });

  test("dispatches stable tap IDs inside an app session", () => {
    const runtime = new ShowcaseRuntime();
    runtime.openApp("intro");
    const scene = runtime.render().scene;
    const next = scene.taps.find((tap) =>
      scene.ops.some((op) => op.op === "text" && op.text === "Next" && op.x >= tap.x && op.x <= tap.x + tap.w && op.y >= tap.y && op.y <= tap.y + tap.h)
    );
    expect(next).toBeDefined();
    runtime.dispatch("TAP", next!.payload.id);
    const intro = runtime.exportState().appStates.intro as { page: number };
    expect(intro.page).toBe(1);
  });
});

describe("snapshot failure semantics", () => {
  test("a future-schema snapshot resets deliberately instead of being guessed at", () => {
    const runtime = new ShowcaseRuntime();
    runtime.openApp("hotel");
    runtime.dispatch("TAP", tapByText(runtime, "Filters"));
    expect(hotelState(runtime).filterOpen).toBe(true);

    runtime.restore({
      stateSchema: 3,
      surface: "app",
      appId: "hotel",
      launcherState: { opened: "hotel", drawerOpen: false },
      appStates: { hotel: { filterOpen: true } },
    });

    expect(runtime.stateSchema()).toBe(2);
    expect(runtime.isLauncher()).toBe(true);
    expect(runtime.activeAppId()).toBeNull();
    expect((runtime.exportState().launcherState as { opened: string | null }).opened).toBeNull();
    expect(runtime.exportState().appStates.hotel).toBeUndefined();
  });

  test("malformed state entries mount fresh instead of restoring garbage", () => {
    const runtime = new ShowcaseRuntime();
    runtime.restore({
      stateSchema: 2,
      surface: "app",
      appId: "hotel",
      launcherState: 42,
      appStates: {
        hotel: "not an object",
        fitness: ["also", "malformed"],
        course: { category: 1 },
      },
    });
    // hotel and fitness mounted fresh despite being named; launcher ignored
    // the scalar and kept a fresh state; course's valid object restored.
    const snapshot = runtime.exportState();
    expect(snapshot.surface).toBe("app");
    expect((snapshot.launcherState as { opened: string | null }).opened).toBeNull();
    expect((snapshot.appStates.hotel as { filterOpen: boolean }).filterOpen).toBe(false);
    expect((snapshot.appStates.fitness as { stepsToday: number }).stepsToday).toBe(4820);
    expect((snapshot.appStates.course as { category: number }).category).toBe(1);
  });

  test("malformed legacy states are ignored the same way", () => {
    const runtime = new ShowcaseRuntime();
    runtime.restore({
      stateSchema: 1,
      route: "hotel",
      states: { home: "garbage", hotel: { destination: 2 }, ghost: {} },
    });
    const snapshot = runtime.exportState();
    expect(snapshot.surface).toBe("app");
    expect((snapshot.appStates.hotel as { destination: number }).destination).toBe(2);
    expect((snapshot.launcherState as { opened: string | null }).opened).toBeNull();
  });

  test("a replaced runtime is isolated from the previous engine's state", () => {
    // The hot-reload path: the shell builds a replacement runtime and
    // restores a serialized snapshot. Nothing the OLD runtime does
    // afterwards may reach the replacement.
    const old = new ShowcaseRuntime();
    old.openApp("hotel");
    const snapshot = JSON.parse(JSON.stringify(old.exportState())) as ShowcaseSnapshot;

    const replacement = new ShowcaseRuntime();
    replacement.restore(snapshot);
    expect((replacement.exportState().appStates.hotel as { destination: number }).destination).toBe(0);

    // Late mutation on the old engine must not leak into the replacement.
    old.dispatch("NAVIGATE", "hotel");
    old.dispatch("TAP", tapByText(old, "Filters"));
    expect((old.exportState().appStates.hotel as { filterOpen: boolean }).filterOpen).toBe(true);
    expect((replacement.exportState().appStates.hotel as { filterOpen: boolean }).filterOpen).toBe(false);
    expect(replacement.isLauncher()).toBe(false);
    expect(replacement.activeAppId()).toBe("hotel");
  });
});

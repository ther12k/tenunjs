/**
 * ApplicationRuntime contract tests (TN-133 slice 2): the execution loop
 * extracted from the gallery example, with every fail-closed edge the
 * public contract promises. Trees are built with the public widgets via
 * the runtime functions (no JSX transform dependency here).
 */
import { describe, expect, test } from "bun:test";
import { defineAction, defineScreen, type ScreenActionContext } from "@tenunjs/core";
import { jsx, jsxs } from "@tenunjs/jsx-runtime";
import {
  ApplicationRuntime,
  ApplicationRuntimeError,
  APPLICATION_STATE_SCHEMA,
  Button,
  Column,
  Text,
} from "../src/index";

const theme = {
  colors: { surface: "#101014", surfaceRaised: "#1C1C24", text: "#F2F2F7", accent: "#7C4DFF" },
  spacing: { sm: 8, md: 16, lg: 24 },
} as never;

interface CounterState {
  count: number;
}

function counterScreen() {
  return defineScreen<CounterState, any>({
    name: "Counter",
    initialState: (): CounterState => ({ count: 0 }),
    actions: {
      increment: defineAction<CounterState, number>({
        run: ({ state, input }) => {
          state.count += input ?? 1;
        },
      }),
    },
    view: ({ state, actions }) =>
      jsxs(Column, {
        padding: "lg",
        gap: "md",
        children: [
          jsx(Text, { variant: "title", children: `count ${state.count}` }),
          jsx(Button, { onPress: () => actions.increment(1), children: "Add one" }),
        ],
      }) as never,
  });
}

function otherScreen() {
  return defineScreen({
    name: "Other",
    initialState: () => ({ value: "untouched" }),
    actions: {
      poke: ({ state }: ScreenActionContext<{ value: string }>) => {
        state.value = "poked";
      },
    },
    view: ({ state }) => jsx(Text, { variant: "body", children: `other ${state.value}` }) as never,
  });
}

function makeRuntime(overrides: Record<string, any> = {}, screens: Record<string, any> = {}) {
  return new ApplicationRuntime({
    screens: { counter: counterScreen(), other: otherScreen(), ...screens },
    initial: "counter",
    theme,
    ...overrides,
  } as never);
}

function firstTapId(runtime: ApplicationRuntime): number {
  const { scene } = runtime.render();
  expect(scene.taps.length).toBeGreaterThan(0);
  return scene.taps[0]!.payload.id;
}

describe("ApplicationRuntime — execution contract", () => {
  test("mounts the initial screen and renders a display-list scene", () => {
    const runtime = makeRuntime();
    expect(runtime.route()).toBe("counter");
    expect(runtime.routes()).toContain("other");
    const { scene } = runtime.render();
    expect(scene.tenun).toBe("display-list");
    expect(scene.version).toBe(1);
    expect(JSON.stringify(scene)).toContain("count 0");
  });

  test("navigate switches route, mounts lazily, and renders the new screen", () => {
    const runtime = makeRuntime();
    runtime.navigate("other");
    expect(runtime.route()).toBe("other");
    expect(JSON.stringify(runtime.render().scene)).toContain("other untouched");
  });

  test("TAP dispatch runs the bound action and mutates state (object payload and raw number)", () => {
    const runtime = makeRuntime();
    const id = firstTapId(runtime);
    runtime.dispatch("TAP", { id });
    expect(JSON.stringify(runtime.render().scene)).toContain("count 1");
    runtime.dispatch("tap", id); // hosts echo lowercase; raw number payload
    expect(JSON.stringify(runtime.render().scene)).toContain("count 2");
  });

  test("exportState snapshots route and all mounted session states", () => {
    const runtime = makeRuntime();
    runtime.dispatch("TAP", { id: firstTapId(runtime) });
    runtime.navigate("other");
    const snapshot = runtime.exportState();
    expect(snapshot.stateSchema).toBe(APPLICATION_STATE_SCHEMA);
    expect(snapshot.route).toBe("other");
    expect((snapshot.states.counter as CounterState).count).toBe(1);
  });

  test("restore round-trips state and route into a fresh runtime", () => {
    const source = makeRuntime();
    source.dispatch("TAP", { id: firstTapId(source) });
    source.navigate("other");
    const snapshot = source.exportState();

    const target = makeRuntime();
    target.restore(snapshot as never);
    expect(target.route()).toBe("other");
    expect(JSON.stringify(target.render().scene)).toContain("other untouched");
    expect((target.exportState().states.counter as CounterState).count).toBe(1);
  });

  test("restore with ignoreUnknownScreens tolerates screens a newer bundle removed", () => {
    const runtime = makeRuntime();
    runtime.restore(
      { route: "gone", states: { gone: { x: 1 }, counter: { count: 7 } }, stateSchema: 1 } as never,
      { ignoreUnknownScreens: true },
    );
    expect(runtime.route()).toBe("counter");
    expect(JSON.stringify(runtime.render().scene)).toContain("count 7");
  });

  test("services reach the action context (navigate-by-service pattern)", () => {
    // Same shape as the gallery composition: the service closure
    // references the runtime, which exists by the time it runs.
    let runtime!: ApplicationRuntime;
    const navScreen = defineScreen({
      name: "Nav",
      initialState: () => ({}),
      actions: {
        go: ({ services }: ScreenActionContext<Record<string, unknown>>) => {
          (services["navigate"] as (route: string) => void)("other");
        },
      },
      view: ({ actions }) => jsx(Button, { onPress: () => actions.go(), children: "go" }) as never,
    });
    runtime = new ApplicationRuntime({
      screens: { navScreen, other: otherScreen() },
      initial: "navScreen",
      theme,
      services: {
        navigate: (route: string) => {
          if (route === "other") runtime.navigate("other");
        },
      },
    } as never);
    runtime.render();
    runtime.dispatch("TAP", { id: 0 });
    expect(runtime.route()).toBe("other");
  });

  test("action contexts receive a real AbortSignal aborted by dispose()", () => {
    let captured: AbortSignal | undefined;
    const runtime = makeRuntime(
      {},
      {
        signalScreen: defineScreen({
          name: "Signal",
          initialState: () => ({}),
          actions: {
            capture: ({ signal }: ScreenActionContext<Record<string, unknown>>) => {
              captured = signal;
            },
          },
          view: ({ actions }) =>
            jsx(Button, { onPress: () => actions.capture(), children: "capture" }) as never,
        }),
      },
    );
    runtime.navigate("signalScreen");
    runtime.render();
    runtime.dispatch("TAP", { id: firstTapId(runtime) });
    expect(captured).toBeInstanceOf(AbortSignal);
    expect(captured!.aborted).toBe(false);
    runtime.dispose();
    expect(captured!.aborted).toBe(true);
  });

  test("boots without AbortController (QuickJS embedder) and still aborts on dispose", () => {
    // Regression for the verify-android-device overlay failure: the
    // Android bundle evaluates under QuickJS, which ships no
    // AbortController (Web API, not ECMAScript) — constructing one at
    // eval time failed the whole bundle boot.
    const holders = globalThis as Record<string, unknown>;
    const savedController = holders["AbortController"];
    const savedSignal = holders["AbortSignal"];
    delete holders["AbortController"];
    delete holders["AbortSignal"];
    let captured: { aborted: boolean; addEventListener?: unknown } | undefined;
    let notified = false;
    try {
      const runtime = makeRuntime(
        {},
        {
          signalScreen: defineScreen({
            name: "Signal",
            initialState: () => ({}),
            actions: {
              capture: ({ signal }: ScreenActionContext<Record<string, unknown>>) => {
                captured = signal as never;
                (signal as never as { addEventListener: (t: string, l: () => void) => void })
                  .addEventListener("abort", () => {
                    notified = true;
                  });
              },
            },
            view: ({ actions }) =>
              jsx(Button, { onPress: () => actions.capture(), children: "capture" }) as never,
          }),
        },
      );
      runtime.navigate("signalScreen");
      runtime.render();
      runtime.dispatch("TAP", { id: firstTapId(runtime) });
      expect(captured).toBeDefined();
      expect(captured!.aborted).toBe(false);
      runtime.dispose();
      expect(captured!.aborted).toBe(true);
      expect(notified).toBe(true);
    } finally {
      if (savedController !== undefined) holders["AbortController"] = savedController;
      if (savedSignal !== undefined) holders["AbortSignal"] = savedSignal;
    }
  });

  test("async action rejections route to onAsyncActionError", async () => {
    const failures: Array<{ screen: string; action: string; error: unknown }> = [];
    const runtime = makeRuntime(
      { onAsyncActionError: (info: { screen: string; action: string; error: unknown }) => failures.push(info) },
      {
        asyncScreen: defineScreen({
          name: "Async",
          initialState: () => ({ n: 0 }),
          actions: {
            boom: defineAction({
              run: async () => {
                throw new Error("boom");
              },
            }),
          },
          view: ({ actions }) => jsx(Button, { onPress: () => actions.boom(undefined), children: "go" }) as never,
        }),
      },
    );
    runtime.navigate("asyncScreen");
    runtime.dispatch("TAP", { id: firstTapId(runtime) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failures.length).toBe(1);
    expect(failures[0]!.action).toBe("boom");
    expect((failures[0]!.error as Error).message).toBe("boom");
  });

  test("render returns the live tap table: appended runs stay dispatchable (wrapper chrome pattern)", () => {
    const runtime = makeRuntime();
    const render = runtime.render();
    const appendedId = render.tapRuns.length;
    render.scene.taps.push({
      x: 0, y: 0, w: render.scene.designWidth, h: 96,
      action: "tap", payload: { id: appendedId },
    });
    render.tapRuns.push(() => runtime.navigate("other"));
    runtime.dispatch("TAP", { id: appendedId });
    expect(runtime.route()).toBe("other");
  });
});

describe("ApplicationRuntime — fail-closed contract", () => {
  test("invalid initial screen is rejected at construction", () => {
    let code = "";
    try {
      new ApplicationRuntime({
        screens: { counter: counterScreen() },
        initial: "missing",
        theme,
      } as never);
    } catch (error) {
      code = (error as ApplicationRuntimeError).code;
    }
    expect(code).toBe("INVALID_INITIAL_SCREEN");
  });

  test("unknown navigate target throws UNKNOWN_SCREEN", () => {
    const runtime = makeRuntime();
    try {
      runtime.navigate("nope");
      throw new Error("expected UNKNOWN_SCREEN");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("UNKNOWN_SCREEN");
    }
  });

  test("unknown dispatch verb throws UNKNOWN_ACTION", () => {
    const runtime = makeRuntime();
    try {
      runtime.dispatch("SMASH", {});
      throw new Error("expected UNKNOWN_ACTION");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("UNKNOWN_ACTION");
    }
  });

  test("malformed or foreign tap payloads throw TAP_TARGET_UNKNOWN", () => {
    const runtime = makeRuntime();
    for (const payload of [{}, { id: "three" }, 99, -1, 1.5]) {
      try {
        runtime.dispatch("TAP", payload);
        throw new Error(`expected TAP_TARGET_UNKNOWN for ${JSON.stringify(payload)}`);
      } catch (error) {
        expect((error as ApplicationRuntimeError).code).toBe("TAP_TARGET_UNKNOWN");
      }
    }
  });

  test("null view() output throws INVALID_VIEW", () => {
    const runtime = makeRuntime(
      {},
      {
        nullScreen: defineScreen({
          name: "Null",
          initialState: () => ({}),
          actions: {},
          view: () => null as never,
        }),
      },
    );
    runtime.navigate("nullScreen");
    try {
      runtime.render();
      throw new Error("expected INVALID_VIEW");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("INVALID_VIEW");
    }
  });

  test("snapshot schema mismatch throws SNAPSHOT_SCHEMA_MISMATCH", () => {
    const runtime = makeRuntime();
    try {
      runtime.restore({ route: "counter", states: {}, stateSchema: 999 } as never);
      throw new Error("expected SNAPSHOT_SCHEMA_MISMATCH");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("SNAPSHOT_SCHEMA_MISMATCH");
    }
  });

  test("strict restore rejects unknown screens and routes", () => {
    const runtime = makeRuntime();
    try {
      runtime.restore({ route: "counter", states: { ghost: {} }, stateSchema: 1 } as never);
      throw new Error("expected UNKNOWN_SCREEN (states)");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("UNKNOWN_SCREEN");
    }
    try {
      runtime.restore({ route: "ghost", states: {}, stateSchema: 1 } as never);
      throw new Error("expected UNKNOWN_SCREEN (route)");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("UNKNOWN_SCREEN");
    }
  });

  test("non-object snapshots throw SNAPSHOT_INVALID", () => {
    const runtime = makeRuntime();
    try {
      runtime.restore(null as never);
      throw new Error("expected SNAPSHOT_INVALID");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("SNAPSHOT_INVALID");
    }
  });

  test("disposed runtime rejects mutating entry points (pure reads stay)", () => {
    const runtime = makeRuntime();
    runtime.dispose();
    expect(runtime.disposed).toBe(true);
    expect(runtime.route()).toBe("counter"); // identity read survives
    for (const entry of [
      () => runtime.navigate("other"),
      () => runtime.render(),
      () => runtime.dispatch("TAP", { id: 0 }),
      () => runtime.exportState(),
      () => runtime.restore({} as never),
    ]) {
      let code = "";
      try {
        entry();
      } catch (error) {
        code = (error as ApplicationRuntimeError).code;
      }
      expect(code).toBe("RUNTIME_DISPOSED");
    }
  });
});

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
    // Restore invalidated the pre-restore scene's tap table (fail-closed
    // until the next render establishes the new scene's).
    try {
      target.dispatch("TAP", { id: 0 });
      throw new Error("expected TAP_TARGET_UNKNOWN after restore");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("TAP_TARGET_UNKNOWN");
    }
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

  test("async action rejections route to onAsyncActionError and fire invalidation", async () => {
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
    const stale: number[] = [];
    runtime.onStateInvalidation(() => stale.push(1));
    runtime.navigate("asyncScreen");
    runtime.dispatch("TAP", { id: firstTapId(runtime) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failures.length).toBe(1);
    expect(failures[0]!.action).toBe("boom");
    expect((failures[0]!.error as Error).message).toBe("boom");
    expect(stale.length).toBe(1);
  });

  test("async action fulfillment fires invalidation, then render shows it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = makeRuntime(
      {},
      {
        asyncScreen: defineScreen({
          name: "Async",
          initialState: () => ({ n: 0 }),
          actions: {
            slow: defineAction({
              run: async ({ state }) => {
                await gate;
                state.n = 7;
              },
            }),
          },
          view: ({ state, actions }) =>
            jsxs(Column, {
              gap: "md",
              children: [
                jsx(Text, { variant: "body", children: `n ${state.n}` }),
                jsx(Button, { onPress: () => actions.slow(undefined), children: "go" }),
              ],
            }) as never,
        }),
      },
    );
    runtime.navigate("asyncScreen");
    runtime.render();
    const stale: number[] = [];
    const unsubscribe = runtime.onStateInvalidation(() => stale.push(1));
    runtime.dispatch("TAP", { id: firstTapId(runtime) });
    expect(stale.length).toBe(0); // not settled yet
    expect(JSON.stringify(runtime.render().scene)).toContain("n 0");
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stale.length).toBe(1);
    expect(JSON.stringify(runtime.render().scene)).toContain("n 7");
    unsubscribe();
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

  test("snapshots without a state schema throw SNAPSHOT_INVALID", () => {
    const runtime = makeRuntime();
    for (const snapshot of [
      { route: "counter", states: {} },
      { route: "counter" },
    ]) {
      try {
        runtime.restore(snapshot as never);
        throw new Error(`expected SNAPSHOT_INVALID for ${JSON.stringify(snapshot)}`);
      } catch (error) {
        expect((error as ApplicationRuntimeError).code).toBe("SNAPSHOT_INVALID");
      }
    }
  });

  test("restore is atomic: a rejected snapshot leaves route and sessions untouched", () => {
    const runtime = makeRuntime();
    runtime.dispatch("TAP", { id: firstTapId(runtime) }); // count 1
    // A VALID state precedes the ghost key: validation must reject the
    // whole snapshot BEFORE any session is replaced with count 99.
    try {
      runtime.restore({
        route: "counter",
        states: { counter: { count: 99 }, ghost: {} },
        stateSchema: 1,
      } as never);
      throw new Error("expected UNKNOWN_SCREEN");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("UNKNOWN_SCREEN");
    }
    expect(runtime.route()).toBe("counter");
    expect((runtime.exportState().states.counter as CounterState).count).toBe(1);
    // Same for an unknown route: nothing from the snapshot is applied.
    try {
      runtime.restore({ route: "ghost", states: { counter: { count: 50 } }, stateSchema: 1 } as never);
      throw new Error("expected UNKNOWN_SCREEN (route)");
    } catch (error) {
      expect((error as ApplicationRuntimeError).code).toBe("UNKNOWN_SCREEN");
    }
    expect((runtime.exportState().states.counter as CounterState).count).toBe(1);
    // A rejected restore changed NOTHING: the old committed scene's tap
    // table still dispatches coherently (count 1 -> 2 through it).
    runtime.dispatch("TAP", { id: 0 });
    expect((runtime.exportState().states.counter as CounterState).count).toBe(2);
    // A SUCCESSFUL restore swaps the sessions and invalidates the old
    // table until the next render establishes the new scene's.
    runtime.restore({ route: "counter", states: { counter: { count: 40 } }, stateSchema: 1 } as never);
    let code = "";
    try {
      runtime.dispatch("TAP", { id: 0 });
    } catch (error) {
      code = (error as ApplicationRuntimeError).code;
    }
    expect(code).toBe("TAP_TARGET_UNKNOWN");
    runtime.render(); // repopulates the table
    runtime.dispatch("TAP", { id: firstTapId(runtime) });
    expect((runtime.exportState().states.counter as CounterState).count).toBe(41);
  });

  test("navigate invalidates the previous scene's tap table", () => {
    const runtime = makeRuntime();
    runtime.render(); // counter scene committed with 1 tap
    runtime.navigate("other");
    let code = "";
    try {
      runtime.dispatch("TAP", { id: 0 });
    } catch (error) {
      code = (error as ApplicationRuntimeError).code;
    }
    expect(code).toBe("TAP_TARGET_UNKNOWN"); // "other" renders no taps
    runtime.navigate("counter");
    runtime.render();
    runtime.dispatch("TAP", { id: firstTapId(runtime) });
    expect((runtime.exportState().states.counter as CounterState).count).toBe(1);
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

describe("ApplicationRuntime — host→runtime push channel (TN-142)", () => {
  interface LiveState {
    snapshot: string | null;
  }

  function liveScreen() {
    return defineScreen<LiveState, any>({
      name: "Live",
      initialState: (): LiveState => ({ snapshot: null }),
      actions: {
        sync: defineAction<LiveState, string>({
          run: ({ input, state }) => {
            state.snapshot = input ?? "empty";
          },
        }),
      },
      view: ({ state }) =>
        jsx(Text, { variant: "body", children: `live ${state.snapshot ?? "unknown"}` }) as never,
    });
  }

  function linkScreen() {
    return defineScreen<{ link: string; sync: string | null }, any>({
      name: "Link",
      initialState: () => ({ link: "offline", sync: null }),
      actions: {
        link: defineAction<{ link: string }, string>({
          run: ({ input, state }) => {
            state.link = input ?? "offline";
          },
        }),
        sync: defineAction<{ sync: string | null }, string>({
          run: ({ input, state }) => {
            state.sync = input ?? null;
          },
        }),
      },
      view: ({ state }) =>
        jsx(Text, { variant: "body", children: `${state.link} ${state.sync ?? "-"}` }) as never,
    });
  }

  function resultScreen() {
    return defineScreen<{ verdict: string }, any>({
      name: "Result",
      initialState: () => ({ verdict: "none" }),
      actions: {
        result: defineAction<{ verdict: string }, string>({
          run: ({ input, state }) => {
            state.verdict = input ?? "none";
          },
        }),
      },
      view: ({ state }) => jsx(Text, { variant: "body", children: state.verdict }) as never,
    });
  }

  function pushRuntime() {
    return new ApplicationRuntime({
      screens: { counter: counterScreen(), live: liveScreen(), link: linkScreen(), result: resultScreen() },
      initial: "counter",
      theme,
    } as never);
  }

  test("push delivers to the active screen's channel and invalidates once", () => {
    const runtime = pushRuntime();
    runtime.navigate("live");
    runtime.render();

    let repaints = 0;
    runtime.onStateInvalidation(() => {
      repaints += 1;
    });

    runtime.push("sync", "ARMED FON 78.5V");
    expect(repaints).toBe(1);

    const text = JSON.stringify(runtime.render().scene);
    expect(text).toContain("ARMED FON 78.5V");
  });

  test("push drops (no throw, no invalidation) when the active screen lacks the channel", () => {
    const runtime = pushRuntime();
    runtime.navigate("counter");
    runtime.render();

    let repaints = 0;
    runtime.onStateInvalidation(() => {
      repaints += 1;
    });

    runtime.push("sync", "nobody listens here");
    expect(repaints).toBe(0);
    expect(() => runtime.push("sync", "again")).not.toThrow();
  });

  test("pushState caches latest-wins and replays on navigate — never a blank hero", () => {
    const runtime = pushRuntime();
    // Host pushes BEFORE the screen is ever mounted (the podSync property).
    runtime.pushState("sync", "stale payload");
    runtime.pushState("sync", "latest payload");
    runtime.pushState("link", "LINKED");

    runtime.navigate("link");
    const text = JSON.stringify(runtime.render().scene);
    expect(text).toContain("latest payload"); // latest-wins, not the stale one
    expect(text).toContain("LINKED"); // every implemented channel replays
  });

  test("navigate replays coalesce invalidation to one repaint", () => {
    const runtime = pushRuntime();
    runtime.pushState("sync", "a");
    runtime.pushState("link", "b");

    let repaints = 0;
    runtime.onStateInvalidation(() => {
      repaints += 1;
    });
    runtime.navigate("link");
    expect(repaints).toBe(1);
  });

  test("pushState to the active screen applies immediately and updates the cache", () => {
    const runtime = pushRuntime();
    runtime.navigate("live");
    runtime.render();

    runtime.pushState("sync", "first");
    expect(JSON.stringify(runtime.render().scene)).toContain("first");

    runtime.pushState("sync", "second");
    expect(JSON.stringify(runtime.render().scene)).toContain("second");

    // the cache carries the latest for a later re-mount
    runtime.navigate("counter");
    runtime.navigate("live");
    expect(JSON.stringify(runtime.render().scene)).toContain("second");
  });

  test("transient pushes are never replayed on navigate", () => {
    const runtime = pushRuntime();
    runtime.navigate("result"); // mount the session so push() can deliver
    runtime.render();
    runtime.push("result", "OK arm");
    expect(JSON.stringify(runtime.render().scene)).toContain("OK arm");

    runtime.navigate("counter");
    runtime.navigate("result");
    // state persists via the session, but a NEW transient push arriving
    // while another screen is active is dropped, not queued:
    runtime.navigate("counter");
    runtime.push("result", "missed");
    runtime.navigate("result");
    expect(JSON.stringify(runtime.render().scene)).not.toContain("missed");
  });

  test("pushTo lands on a non-active mounted session and survives navigation", () => {
    const runtime = pushRuntime();
    runtime.navigate("result"); // mount once
    runtime.navigate("counter"); // result NOT active

    runtime.pushTo("result", "result", "✓ disarm");
    runtime.navigate("result");
    expect(JSON.stringify(runtime.render().scene)).toContain("✓ disarm");
  });

  test("pushTo drops silently for a screen that was never mounted", () => {
    const runtime = pushRuntime();
    expect(() => runtime.pushTo("result", "result", "no session")).not.toThrow();
    runtime.navigate("result");
    expect(JSON.stringify(runtime.render().scene)).toContain("none"); // initialState, not the dropped push
  });

  test("an async action delivered by push invalidates on settlement", async () => {
    const runtime = new ApplicationRuntime({
      screens: {
        counter: counterScreen(),
        slow: defineScreen<{ value: string }, any>({
          name: "Slow",
          initialState: () => ({ value: "idle" }),
          actions: {
            arrive: defineAction<{ value: string }, string>({
              run: ({ input, state }) =>
                new Promise<void>((resolve) => {
                  setTimeout(() => {
                    state.value = input ?? "done";
                    resolve();
                  }, 0);
                }) as never,
            }),
          },
          view: ({ state }) => jsx(Text, { variant: "body", children: state.value }) as never,
        }),
      },
      initial: "counter",
      theme,
    } as never);
    runtime.navigate("slow");
    runtime.render();

    let repaints = 0;
    runtime.onStateInvalidation(() => {
      repaints += 1;
    });

    runtime.push("arrive", "arrived");
    expect(repaints).toBe(1); // the delivered push itself (the run call)

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(repaints).toBe(2); // the thenable settlement fired its own invalidation
    expect(JSON.stringify(runtime.render().scene)).toContain("arrived");
  });

  test("push entry points throw RUNTIME_DISPOSED after dispose", () => {
    const runtime = pushRuntime();
    runtime.dispose();
    for (const entry of [
      () => runtime.push("sync", "x"),
      () => runtime.pushState("sync", "x"),
      () => runtime.pushTo("live", "sync", "x"),
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

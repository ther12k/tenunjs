/**
 * Host-handoff contract tests (TN-133 slice 2): the commit/dispatch
 * adapter the Android bridge consumes — semantics preserved from the
 * legacy example-private device-entry adapter, now public and
 * structural over any HandoffApplication.
 */
import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import { jsx, jsxs } from "@tenunjs/jsx-runtime";
import {
  ApplicationRuntime,
  Button,
  Column,
  installHostHandoff,
  Text,
  TextField,
} from "../src/index";

const theme = {
  colors: { surface: "#101014", surfaceRaised: "#1C1C24", text: "#F2F2F7", accent: "#7C4DFF" },
  spacing: { sm: 8, md: 16, lg: 24 },
} as never;

function counterApp() {
  return new ApplicationRuntime({
    screens: {
      counter: defineScreen({
        name: "Counter",
        initialState: () => ({ count: 0 }),
        actions: {
          increment: defineActionLike(({ state }: { state: { count: number } }) => {
            state.count += 1;
          }),
        },
        view: ({ state, actions }) =>
          jsxs(Column, {
            padding: "lg",
            gap: "md",
            children: [
              jsx(Text, { variant: "title", children: `count ${state.count}` }),
              jsx(Button, { onPress: () => actions.increment(), children: "Add" }),
            ],
          }) as never,
      }) as never,
    },
    initial: "counter",
    theme,
  } as never);
}

// Simple handler form (function) rather than defineAction, to cover the
// other mount branch of the runtime under the handoff too.
function defineActionLike(run: (ctx: { state: { count: number } }) => void) {
  return run;
}

function tapIdOf(sceneJson: string): number {
  const scene = JSON.parse(sceneJson);
  expect(scene.taps.length).toBeGreaterThan(0);
  return scene.taps[0].payload.id;
}

describe("installHostHandoff — host protocol", () => {
  test("install commits the initial scene (sink and default storage)", () => {
    const committed: string[] = [];
    const handoff = installHostHandoff({ app: counterApp(), commit: (json: string) => committed.push(json) });
    expect(committed.length).toBe(1);
    expect(JSON.parse(committed[0]!).tenun).toBe("display-list");

    const headless = installHostHandoff({ app: counterApp() });
    expect(headless.lastScene()).toBeTruthy();
    expect(JSON.parse(headless.lastScene()!).tenun).toBe("display-list");
  });

  test("TAP runs the action, commits the new scene, and returns the route", () => {
    const committed: string[] = [];
    const handoff = installHostHandoff({ app: counterApp(), commit: (j: string) => committed.push(j) });
    const id = tapIdOf(committed[0]!);

    const response = JSON.parse(handoff.dispatch("tap", JSON.stringify({ id })));
    expect(response.route).toBe("counter");
    expect(committed.length).toBe(2);
    expect(committed[1]!).toContain("count 1");
  });

  test("LONG-PRESS runs the run table and commits — same host-visible semantics as TAP (TN-148)", () => {
    const committed: string[] = [];
    const handoff = installHostHandoff({ app: counterApp(), commit: (j: string) => committed.push(j) });
    const id = tapIdOf(committed[0]!);

    const response = JSON.parse(handoff.dispatch("long-press", JSON.stringify({ id })));
    expect(response.route).toBe("counter");
    expect(committed.length).toBe(2);
    expect(committed[1]!).toContain("count 1");
  });

  test("__TENUN_EXPORT returns the snapshot JSON; __TENUN_STATE_SCHEMA the schema", () => {
    const handoff = installHostHandoff({ app: counterApp() });
    const schema = JSON.parse(handoff.dispatch("__TENUN_STATE_SCHEMA", ""));
    expect(schema.stateSchema).toBe(1);
    const snapshot = JSON.parse(handoff.dispatch("__tenun_export", "{}"));
    expect(snapshot.route).toBe("counter");
    expect(snapshot.states.counter.count).toBe(0);
  });

  test("TENUN_RESTORE restores the snapshot and commits", () => {
    const committed: string[] = [];
    const source = counterApp();
    const sourceHandoff = installHostHandoff({ app: source, commit: (j: string) => committed.push(j) });
    source.dispatch("TAP", { id: tapIdOf(sourceHandoff.lastScene() ?? committed[0]!) });
    const snapshotJson = sourceHandoff.dispatch("__TENUN_EXPORT", "");

    const target = installHostHandoff({ app: counterApp(), commit: (j: string) => committed.push(j) });
    const before = committed.length;
    const response = JSON.parse(target.dispatch("TENUN_RESTORE", snapshotJson));
    expect(response.route).toBe("counter");
    expect(committed.length).toBe(before + 1);
  });

  test("malformed payload JSON degrades to {} — and surfaces as a contract error, not a parse crash", () => {
    const handoff = installHostHandoff({ app: counterApp() });
    let message = "";
    try {
      handoff.dispatch("tap", "{not json");
      throw new Error("expected TAP_TARGET_UNKNOWN");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("TENUN_APP_ERROR");
  });

  test("structural: an application wrapper with chrome satisfies the contract", () => {
    // Gallery-shaped wrapper: appends a back-affordance tap to every
    // render. The handoff must drive it unchanged.
    const base = counterApp();
    const committed: string[] = [];
    const wrapped = {
      render: () => {
        const out = base.render();
        out.scene.taps.push({
          x: 0, y: 0, w: out.scene.designWidth, h: 96,
          action: "tap", payload: { id: out.tapRuns.length },
        });
        out.tapRuns.push(() => undefined);
        return out;
      },
      dispatch: (action: string, payload?: unknown) => base.dispatch(action, payload),
      exportState: () => base.exportState(),
      stateSchema: () => base.stateSchema(),
      route: () => base.route(),
    };
    const handoff = installHostHandoff({ app: wrapped, commit: (j: string) => committed.push(j) });
    const scene = JSON.parse(committed[0]!);
    expect(scene.taps.length).toBe(2); // button + wrapper chrome
    const backId = scene.taps[1].payload.id;
    expect(() => handoff.dispatch("tap", JSON.stringify({ id: backId }))).not.toThrow();
  });

  test("rejected numeric edit republishes authority and restores wrapper chrome tap runs", () => {
    let chromeTaps = 0;
    const base = new ApplicationRuntime({
      screens: {
        form: defineScreen({
          name: "Form",
          initialState: () => ({ num: "12" }),
          actions: {
            setNum: ({ state, input }: { state: { num: string }; input: string }) => { state.num = input; },
          },
          view: ({ state, actions }) =>
            Column({
              children: [
                TextField({ id: "num", keyboardType: "number", value: state.num, onChanged: actions.setNum }),
              ],
            }) as never,
        }),
      },
      initial: "form",
      theme,
    } as never);
    const wrapped = {
      render: () => {
        const out = base.render();
        out.scene.taps.push({
          x: 0, y: 0, w: out.scene.designWidth, h: 48,
          action: "tap", payload: { id: out.tapRuns.length },
        });
        out.tapRuns.push(() => { chromeTaps++; });
        return out;
      },
      dispatch: (action: string, payload?: unknown) => base.dispatch(action, payload),
      exportState: () => base.exportState(),
      stateSchema: () => base.stateSchema(),
      route: () => base.route(),
      onStateInvalidation: (listener: () => void) => base.onStateInvalidation(listener),
    };
    const handoff = installHostHandoff({ app: wrapped });
    // Focus the text field
    let scene = JSON.parse(handoff.lastScene()!);
    handoff.dispatch("tap", JSON.stringify(scene.taps[0].payload));
    scene = JSON.parse(handoff.lastScene()!);
    const field = scene.ops.find((op: { op: string }) => op.op === "text-input");
    const chrome = scene.taps.at(-1).payload;

    expect(() => {
      handoff.dispatch("TEXT_EDIT", JSON.stringify({
        id: field.id, sessionId: field.sessionId, baseRevision: field.revision,
        text: "12x", selection: { base: 3, extent: 3 }, composing: null,
      }));
    }).toThrow("INVALID_TEXT_CONTENT");

    // The wrapper chrome tap remains valid and callable after the rejected edit
    expect(() => handoff.dispatch("tap", JSON.stringify(chrome))).not.toThrow();
    expect(chromeTaps).toBe(1);
  });

  test("async action settlement commits a fresh scene out-of-band; dispose stops it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = new ApplicationRuntime({
      screens: {
        counter: defineScreen({
          name: "Counter",
          initialState: () => ({ count: 0 }),
          actions: {
            increment: async ({ state }: { state: { count: number } }) => {
              await gate;
              state.count = 5;
            },
          },
          view: ({ state, actions }) =>
            jsxs(Column, {
              padding: "lg",
              gap: "md",
              children: [
                jsx(Text, { variant: "title", children: `count ${state.count}` }),
                jsx(Button, { onPress: () => actions.increment(), children: "Add" }),
              ],
            }) as never,
        }) as never,
      },
      initial: "counter",
      theme,
    } as never);
    const committed: string[] = [];
    const handoff = installHostHandoff({ app, commit: (j: string) => committed.push(j) });
    const id = tapIdOf(committed[0]!);

    handoff.dispatch("tap", JSON.stringify({ id })); // sync commit: still count 0
    expect(committed.length).toBe(2);
    expect(committed[1]!).toContain("count 0");

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(committed.length).toBe(3); // settlement commit
    expect(committed[2]!).toContain("count 5");

    handoff.dispose();
    handoff.dispose(); // idempotent
    const before = committed.length;
    handoff.dispatch("__TENUN_STATE_SCHEMA", "");
    expect(committed.length).toBe(before); // no further out-of-band commits
  });
});

describe("plan B2 — BACK verb negotiation", () => {
  function wrapperFor(app: ReturnType<typeof counterApp>, commit: (json: string) => void, hideBack = false) {
    return {
      route: () => app.route(),
      render: () => app.render(),
      exportState: () => app.exportState(),
      stateSchema: () => app.stateSchema(),
      dispatch: (action: string, payload?: unknown) => app.dispatch(action, payload),
      onStateInvalidation: (listener: () => void) => app.onStateInvalidation(listener),
      commit,
      ...(hideBack ? {} : { goBack: () => app.goBack() }),
    };
  }

  test("an adopting bundle answers handled true/false and one press pops once", () => {
    const other = defineScreen({
      name: "Other", initialState: () => ({}), actions: {},
      view: () => jsx(Text, { children: "Other screen" }) as never,
    });
    const counter = defineScreen({
      name: "Counter", initialState: () => ({ count: 0 }), actions: {},
      view: () => jsx(Text, { children: "Counter screen" }) as never,
    });
    const app = new ApplicationRuntime({
      screens: { counter, other }, initial: "counter", theme,
      viewport: { width: 320, height: 480 },
    } as never);
    const adopt = installHostHandoff({ app: wrapperFor(app, () => undefined) });
    // Same-name navigation records no origin: Back is not handled.
    app.navigate("counter");
    const reply1 = JSON.parse(adopt.dispatch("BACK", "{}"));
    expect(reply1.handled).toBe(false);
    // One route change, one origin: the first press pops it, the second is not handled.
    app.navigate("other");
    const reply2 = JSON.parse(adopt.dispatch("BACK", "{}"));
    expect(reply2.handled).toBe(true);
    expect(JSON.parse(adopt.dispatch("BACK", "{}")).handled).toBe(false);
  });

  test("a HANDLED back commits even for wrappers without an invalidation subscription", () => {
    const other = defineScreen({
      name: "Other", initialState: () => ({}), actions: {},
      view: () => jsx(Text, { children: "Other screen" }) as never,
    });
    const counter = defineScreen({
      name: "Counter", initialState: () => ({ count: 0 }), actions: {},
      view: () => jsx(Text, { children: "Counter screen" }) as never,
    });
    const app = new ApplicationRuntime({
      screens: { counter, other }, initial: "counter", theme,
      viewport: { width: 320, height: 480 },
    } as never);
    // No onStateInvalidation on the wrapper: BACK must still commit the
    // popped route or the reply would claim success over a stale scene.
    const adopt = installHostHandoff({ app: wrapperFor(app, () => undefined) });
    const before = adopt.lastScene();
    app.navigate("other");
    const reply = JSON.parse(adopt.dispatch("BACK", "{}"));
    expect(reply.handled).toBe(true);
    const committed = JSON.parse(adopt.lastScene()!);
    expect(committed.ops.some((op: { op?: string; text?: string }) => op.text === "Counter screen")).toBe(true);
    expect(before).not.toBeNull();
  });

  test("a bundle without goBack surfaces UNKNOWN_ACTION (NULL across JNI = not handled)", () => {
    const app = counterApp();
    const adopt = installHostHandoff({ app: wrapperFor(app, () => undefined, true) });
    expect(() => adopt.dispatch("BACK", "{}")).toThrow("unknown dispatch verb");
  });
});

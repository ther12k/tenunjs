import { describe, expect, test } from "bun:test";
import { defineScreen, type ScreenActionContext } from "@tenunjs/core";
import {
  ApplicationRuntime, ApplicationRuntimeError, Button, Column, Container,
  Expanded, GestureDetector, installHostHandoff, LayoutError, Text,
  type ApplicationRuntimeOptions, type LayoutViewport,
} from "../src/index";

type SurfaceOptions = Pick<ApplicationRuntimeOptions, "viewport" | "designWidth">;
const theme = { colors: { surface: "#101014", text: "#FFFFFF", accent: "#3366FF" } };

function options(surface: SurfaceOptions = {}, onMount: () => void = () => undefined): ApplicationRuntimeOptions {
  const counter = defineScreen({
    name: "Counter",
    initialState: () => { onMount(); return { count: 0 }; },
    actions: {
      increment: ({ state }: ScreenActionContext<{ count: number }>) => { state.count++; },
    },
    view: ({ state, actions }) => Column({ children: [
      Text({ children: `count ${state.count}` }),
      Button({ children: "Add", onPress: () => actions.increment() }),
    ] }),
  });
  const other = defineScreen({
    name: "Other",
    initialState: () => { onMount(); return { label: "kept" }; },
    actions: {},
    view: ({ state }) => Text({ children: state.label }),
  });
  return { screens: { counter, other }, initial: "counter", theme, ...surface };
}

function expectLayoutError(run: () => unknown): void {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(LayoutError);
    if (!(error instanceof LayoutError)) throw error;
    expect(error.code).toBe("INVALID_VIEWPORT");
    return;
  }
  throw new Error("Expected INVALID_VIEWPORT");
}

function expectRuntimeError(run: () => unknown, code: ApplicationRuntimeError["code"]): void {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(ApplicationRuntimeError);
    if (!(error instanceof ApplicationRuntimeError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("TN-157 application viewport", () => {
  test("copies finite initial bounds while retaining the legacy width-only mode", () => {
    const viewport = { width: 320, height: 480 };
    const runtime = new ApplicationRuntime(options({ viewport }));
    viewport.width = 999;
    viewport.height = 999;
    expect(runtime.render().scene.designWidth).toBe(320);
    expect(runtime.render().scene.contentHeight).toBe(480);

    const legacy = new ApplicationRuntime(options());
    expect(legacy.render().scene.designWidth).toBe(720);
    const narrow = new ApplicationRuntime(options({ designWidth: 320 }));
    expect(narrow.render().scene.designWidth).toBe(320);
    expect(narrow.render().scene.contentHeight).toBeLessThan(480);
  });

  test("rejects ambiguous or malformed initial bounds before mounting a screen", () => {
    let mounts = 0;
    const onMount = () => { mounts++; };
    expectLayoutError(() => new ApplicationRuntime(options({
      designWidth: 320, viewport: { width: 320, height: 480 },
    }, onMount)));
    expectLayoutError(() => new ApplicationRuntime(options({
      viewport: { width: 320, height: Infinity },
    }, onMount)));
    expect(mounts).toBe(0);
  });

  test("a changed viewport invalidates old hit IDs once and a render rebuilds them", () => {
    const runtime = new ApplicationRuntime(options({ viewport: { width: 320, height: 480 } }));
    const id = runtime.render().scene.taps[0]!.payload.id;
    let invalidations = 0;
    runtime.onStateInvalidation(() => {
      invalidations++;
      expectRuntimeError(() => runtime.dispatch("TAP", { id }), "TAP_TARGET_UNKNOWN");
    });
    const next = { width: 480, height: 320 };
    runtime.setViewport(next);
    next.width = 999;
    next.height = 999;
    expect(invalidations).toBe(1);
    const resized = runtime.render().scene;
    expect(resized.designWidth).toBe(480);
    expect(resized.contentHeight).toBe(320);
    runtime.dispatch("TAP", { id: resized.taps[0]!.payload.id });
    expect(JSON.stringify(runtime.exportState())).toContain('"count":1');
  });

  test("identical dimensions preserve the live tap table without invalidation", () => {
    const runtime = new ApplicationRuntime(options({ viewport: { width: 320, height: 480 } }));
    const id = runtime.render().scene.taps[0]!.payload.id;
    let invalidations = 0;
    runtime.onStateInvalidation(() => { invalidations++; });
    runtime.setViewport({ width: 320, height: 480 });
    expect(invalidations).toBe(0);
    runtime.dispatch("TAP", { id });
    expect(JSON.stringify(runtime.exportState())).toContain('"count":1');
  });

  test("invalid updates retain the viewport, controller state and live tap table", () => {
    const runtime = new ApplicationRuntime(options({ viewport: { width: 320, height: 480 } }));
    const before = runtime.render().scene;
    const snapshot = JSON.stringify(runtime.exportState());
    let invalidations = 0;
    runtime.onStateInvalidation(() => { invalidations++; });
    // Simulates malformed input from a surface adapter after static typing.
    for (const viewport of [{ width: 0, height: 480 }, { width: 320, height: NaN }, null]) {
      expectLayoutError(() => runtime.setViewport(viewport as LayoutViewport));
    }
    expect(invalidations).toBe(0);
    expect(JSON.stringify(runtime.exportState())).toBe(snapshot);
    runtime.dispatch("TAP", { id: before.taps[0]!.payload.id });
    const after = runtime.render().scene;
    expect(after.designWidth).toBe(320);
    expect(after.contentHeight).toBe(480);
    expect(JSON.stringify(runtime.exportState())).toContain('"count":1');
  });

  test("resize preserves mounted routes/state and snapshots never replace surface bounds", () => {
    let mounts = 0;
    const source = new ApplicationRuntime(options({ viewport: { width: 320, height: 480 } }, () => { mounts++; }));
    source.dispatch("TAP", { id: source.render().scene.taps[0]!.payload.id });
    source.navigate("other");
    const before = JSON.stringify(source.exportState());
    source.setViewport({ width: 600, height: 700 });
    expect(source.route()).toBe("other");
    expect(JSON.stringify(source.exportState())).toBe(before);
    expect(mounts).toBe(2);
    expect(Object.keys(source.exportState()).sort()).toEqual(["route", "stateSchema", "states"]);

    const target = new ApplicationRuntime(options({ viewport: { width: 400, height: 800 } }));
    target.restore(source.exportState());
    expect(target.route()).toBe("other");
    expect(JSON.stringify(target.exportState())).toBe(before);
    target.navigate("counter");
    expect(target.render().scene.designWidth).toBe(400);
    expect(target.render().scene.contentHeight).toBe(800);
    expect(JSON.stringify(target.render().scene)).toContain("count 1");
  });

  test("an existing handoff commits resized geometry; disposal detaches that subscriber", () => {
    const runtime = new ApplicationRuntime(options({ designWidth: 320 }));
    const commits: string[] = [];
    const handoff = installHostHandoff({ app: runtime, commit: (json) => commits.push(json) });
    runtime.setViewport({ width: 480, height: 320 });
    expect(commits).toHaveLength(2);
    expect(JSON.parse(commits[1]!)).toMatchObject({ designWidth: 480, contentHeight: 320 });
    handoff.dispatch("TAP", JSON.stringify({ id: 0 }));
    expect(commits).toHaveLength(3);
    expect(commits[2]).toContain("count 1");
    handoff.dispose();
    runtime.setViewport({ width: 500, height: 400 });
    expect(commits).toHaveLength(3);
  });

  test("disposed runtime rejects viewport updates without notifying subscribers", () => {
    const runtime = new ApplicationRuntime(options({ viewport: { width: 320, height: 480 } }));
    let invalidations = 0;
    runtime.onStateInvalidation(() => { invalidations++; });
    runtime.dispose();
    expectRuntimeError(() => runtime.setViewport({ width: 480, height: 320 }), "RUNTIME_DISPOSED");
    expect(invalidations).toBe(0);
  });

  test("bounded viewport height reaches an Expanded body and its hit region", () => {
    const screen = defineScreen({
      name: "Bounded",
      initialState: () => ({}),
      actions: {},
      view: () => Column({ align: "stretch", children: [
        Container({ height: 40, color: "#111111" }),
        Expanded({ child: GestureDetector({ onTap: () => undefined,
          child: Container({ color: "#ABCDEF" }),
        }) }),
      ] }),
    });
    const runtime = new ApplicationRuntime({ screens: { screen }, initial: "screen", theme,
      viewport: { width: 300, height: 400 } });
    expect(runtime.render().scene.taps[0]).toMatchObject({ x: 0, y: 40, w: 300, h: 360 });
    runtime.setViewport({ width: 500, height: 240 });
    expect(runtime.render().scene.taps[0]).toMatchObject({ x: 0, y: 40, w: 500, h: 200 });
  });
});

describe("host VIEWPORT dispatch (TN-158)", () => {
  test("a VIEWPORT dispatch through the handoff re-lays out and commits the resized scene", () => {
    const runtime = new ApplicationRuntime(options({ viewport: { width: 320, height: 480 } }));
    const commits: string[] = [];
    const handoff = installHostHandoff({ app: runtime, commit: (json) => commits.push(json) });
    expect(commits).toHaveLength(1);

    const result = JSON.parse(handoff.dispatch("VIEWPORT", JSON.stringify({ width: 480, height: 640 })));
    expect(result).toEqual({ route: "counter" });
    expect(commits).toHaveLength(2);
    expect(JSON.parse(commits[1]!)).toMatchObject({ designWidth: 480, contentHeight: 640 });

    // The negotiation is repeatable: a further host resize re-lays out again.
    handoff.dispatch("viewport", JSON.stringify({ width: 200, height: 100 }));
    expect(JSON.parse(commits[2]!)).toMatchObject({ designWidth: 200, contentHeight: 100 });
  });

  test("an identical VIEWPORT dispatch is a no-op — no extra commit", () => {
    const runtime = new ApplicationRuntime(options({ viewport: { width: 320, height: 480 } }));
    const commits: string[] = [];
    const handoff = installHostHandoff({ app: runtime, commit: (json) => commits.push(json) });
    handoff.dispatch("VIEWPORT", JSON.stringify({ width: 320, height: 480 }));
    expect(commits).toHaveLength(1);
  });

  test("a bundle without setViewport fails visibly with UNKNOWN_ACTION — the host's negotiation signal", () => {
    const runtime = new ApplicationRuntime(options({ viewport: { width: 320, height: 480 } }));
    const wrapped = {
      render: () => runtime.render(),
      dispatch: (action: string, payload?: unknown) => runtime.dispatch(action, payload),
      exportState: () => runtime.exportState(),
      stateSchema: () => runtime.stateSchema(),
      route: () => runtime.route(),
      onStateInvalidation: (l: () => void) => runtime.onStateInvalidation(l),
      // setViewport deliberately omitted: chrome-owning wrappers that have
      // not adopted host bounds yet.
    };
    const handoff = installHostHandoff({ app: wrapped, commit: () => undefined });
    expectRuntimeError(
      () => handoff.dispatch("VIEWPORT", JSON.stringify({ width: 480, height: 640 })),
      "UNKNOWN_ACTION",
    );
  });

  test("a malformed VIEWPORT payload fails as INVALID_VIEWPORT, never a silent ignore", () => {
    const runtime = new ApplicationRuntime(options({ viewport: { width: 320, height: 480 } }));
    const handoff = installHostHandoff({ app: runtime, commit: () => undefined });
    expect(() => handoff.dispatch("VIEWPORT", '{"width": "wide"}')).toThrow(LayoutError);
    expect(() => handoff.dispatch("VIEWPORT", "not json at all")).toThrow(LayoutError);
  });
});

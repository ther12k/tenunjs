/**
 * TNP-006 regression tests — one commit per host dispatch.
 *
 * Before the fix, a host dispatch that invalidated state out-of-band
 * committed TWICE through a subscribed handoff: once immediately from
 * the invalidation subscription (Back's reactivation notifyStale, a
 * pushState inside a TAP action, a navigation's channel replay), then
 * again from the dispatch-path commit. The standard two-screen Back
 * press rendered and committed the same scene twice; a replay-heavy
 * Back committed three times. These tests pin render/commit COUNTS,
 * not just scene content — the counting wrapper is the evidence
 * instrument, and it doubles as proof the structural HandoffApplication
 * shape still drives the policy.
 *
 * The policy: inside a handoff dispatch, invalidations COALESCE into the
 * dispatch-end flush (an explicit dispatch-path commit satisfies it);
 * outside a dispatch, invalidations commit immediately (async action
 * settlement, direct runtime-API callers). Hosts without a subscribed
 * handoff keep the commit-after-dispatch behavior untouched.
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
  TRANSITION_DEFAULT_DURATION_MS,
  type HandoffApplication,
} from "../src/index";

const theme = {
  colors: { surface: "#101014", surfaceRaised: "#1C1C24", text: "#F2F2F7", accent: "#7C4DFF" },
  spacing: { sm: 8, md: 16, lg: 24 },
} as never;

/** Render/commit counters over a structural wrapper (the TNP-006 instrument). */
interface Counting {
  app: ApplicationRuntime;
  handoff: ReturnType<typeof installHostHandoff>;
  commits: string[];
  renders(): number;
}

/** A HandoffApplication that counts renders and delegates everything else. */
function counted(app: ApplicationRuntime, commits: string[]): HandoffApplication & { renderCount(): number } {
  let renders = 0;
  return {
    route: () => app.route(),
    render: () => {
      renders += 1;
      return app.render();
    },
    dispatch: (action, payload) => app.dispatch(action, payload),
    exportState: () => app.exportState(),
    stateSchema: () => app.stateSchema(),
    setViewport: (viewport) => app.setViewport(viewport),
    goBack: () => app.goBack(),
    endTransitionBurst: () => app.endTransitionBurst(),
    onStateInvalidation: (listener) => app.onStateInvalidation(listener),
    renderCount: () => renders,
  };
}

function sceneTexts(sceneJson: string): string[] {
  const scene = JSON.parse(sceneJson) as { ops: { text?: string }[] };
  return scene.ops.filter((op) => typeof op.text === "string").map((op) => op.text as string);
}

function firstTapId(sceneJson: string): number {
  const scene = JSON.parse(sceneJson) as { taps: { payload: { id: number } }[] };
  expect(scene.taps.length).toBeGreaterThan(0);
  return scene.taps[0]!.payload.id;
}

/** Two screens wired so a TAP on Home navigates to Away (the standard journey). */
function twoScreenApp(): Counting {
  let app!: ApplicationRuntime;
  app = new ApplicationRuntime({
    screens: {
      home: defineScreen({
        name: "Home", initialState: () => ({}),
        actions: {
          enter: ({ services }: { services: unknown }) => {
            (services as { navigate(name: string): void }).navigate("away");
          },
        },
        view: ({ actions }: { actions: { enter(): void } }) =>
          jsx(Column, { children: [jsx(Text, { children: "Home screen" }), jsx(Button, { onPress: () => actions.enter(), children: "Enter" })] }) as never,
      }) as never,
      away: defineScreen({
        name: "Away", initialState: () => ({}), actions: {},
        view: () => jsx(Text, { children: "Away screen" }) as never,
      }) as never,
    },
    initial: "home",
    theme,
    viewport: { width: 320, height: 480 },
    services: { navigate: (name: string) => app.navigate(name) },
  } as never);
  const commits: string[] = [];
  const wrapper = counted(app, commits);
  const handoff = installHostHandoff({ app: wrapper, commit: (json) => commits.push(json) });
  return { app, handoff, commits, renders: wrapper.renderCount };
}

describe("TNP-006 — one commit per host dispatch", () => {
  test("the standard two-screen Back dispatch renders and commits ONCE", () => {
    const f = twoScreenApp();
    expect(f.commits.length).toBe(1); // install
    const enterId = firstTapId(f.commits[0]!);
    f.handoff.dispatch("TAP", JSON.stringify({ id: enterId }));
    expect(f.commits.length).toBe(2); // the TAP commit, painting Away
    expect(sceneTexts(f.commits[1]!)).toContain("Away screen");

    const commitsBefore = f.commits.length;
    const reply = JSON.parse(f.handoff.dispatch("BACK", "{}")) as { handled: boolean };
    expect(reply.handled).toBe(true);
    // THE defect: Back's reactivation notifyStale committed once out of the
    // invalidation subscription and the handled-commit committed again.
    expect(f.commits.length - commitsBefore).toBe(1);
    const afterBack = f.commits[f.commits.length - 1]!;
    expect(sceneTexts(afterBack)).toContain("Home screen");
    expect((JSON.parse(afterBack) as { transition?: unknown }).transition).toBeUndefined();
  });

  test("a Back whose reactivation replays a cached channel still commits ONCE", () => {
    let app!: ApplicationRuntime;
    app = new ApplicationRuntime({
      screens: {
        home: defineScreen({
          name: "Home", initialState: () => ({ live: "stale" }),
          actions: {
            live: ({ state, input }: { state: { live: string }; input: unknown }) => {
              state.live = String(input);
            },
            enter: ({ services }: { services: unknown }) => {
              (services as { navigate(name: string): void }).navigate("away");
            },
          },
          view: ({ state, actions }: { state: { live: string }; actions: { enter(): void } }) =>
            jsx(Column, { children: [jsx(Text, { children: "Home screen" }), jsx(Text, { children: `live ${state.live}` }), jsx(Button, { onPress: () => actions.enter(), children: "Enter" })] }) as never,
        }) as never,
        away: defineScreen({
          name: "Away", initialState: () => ({ live: "stale" }),
          actions: {
            live: ({ state, input }: { state: { live: string }; input: unknown }) => {
              state.live = String(input);
            },
          },
          view: ({ state }: { state: { live: string } }) =>
            jsx(Text, { children: `live ${state.live}` }) as never,
        }) as never,
      },
      initial: "home",
      theme,
      viewport: { width: 320, height: 480 },
      services: { navigate: (name: string) => app.navigate(name) },
    } as never);
    const commits: string[] = [];
    const wrapper = counted(app, commits);
    const handoff = installHostHandoff({ app: wrapper, commit: (json) => commits.push(json) });

    app.pushState("live", 42); // cached channel, delivered to home out-of-band
    const afterPush = commits.length;
    expect(afterPush).toBe(2); // install + immediate out-of-band delivery

    const enterId = firstTapId(commits[commits.length - 1]!);
    handoff.dispatch("TAP", JSON.stringify({ id: enterId }));
    // Navigation replays the channel to Away; that invalidation coalesces
    // into the TAP commit instead of committing a second scene of the burst.
    expect(commits.length).toBe(afterPush + 1);
    expect(sceneTexts(commits[commits.length - 1]!)).toContain("live 42");

    const before = commits.length;
    const reply = JSON.parse(handoff.dispatch("BACK", "{}")) as { handled: boolean };
    expect(reply.handled).toBe(true);
    // Back replays the channel to Home (delivered), then goBack's own
    // notifyStale, then the handled-commit — coalesced into ONE commit.
    expect(commits.length - before).toBe(1);
    expect(sceneTexts(commits[commits.length - 1]!)).toContain("live 42");
    expect(sceneTexts(commits[commits.length - 1]!)).toContain("Home screen");
  });

  test("synchronous state updates inside one TAP coalesce into its commit", () => {
    let app!: ApplicationRuntime;
    app = new ApplicationRuntime({
      screens: {
        counter: defineScreen({
          name: "Counter", initialState: () => ({ count: 0 }),
          actions: {
            bumpTwice: ({ state, services }: { state: { count: number }; services: unknown }) => {
              state.count += 1;
              (services as { push(): void }).push();
              state.count += 1;
              (services as { push(): void }).push();
            },
            tick: () => undefined, // the push channel's sink on this screen
          },
          view: ({ state, actions }: { state: { count: number }; actions: { bumpTwice(): void } }) =>
            jsx(Column, { children: [jsx(Text, { children: `count ${state.count}` }), jsx(Button, { onPress: () => actions.bumpTwice(), children: "Bump" })] }) as never,
        }) as never,
      },
      initial: "counter",
      theme,
      viewport: { width: 320, height: 480 },
      services: { push: () => app.pushState("tick", undefined) },
    } as never);
    const commits: string[] = [];
    const wrapper = counted(app, commits);
    const handoff = installHostHandoff({ app: wrapper, commit: (json) => commits.push(json) });
    const id = firstTapId(commits[0]!);

    handoff.dispatch("TAP", JSON.stringify({ id }));
    // Each pushState used to commit immediately (2 invalidation commits) and
    // the post-TAP commit made three. One dispatch, one commit, final state.
    expect(commits.length).toBe(2);
    expect(sceneTexts(commits[1]!)).toContain("count 2");
  });

  test("a dispatch without an explicit commit path still flushes exactly once (VIEWPORT)", () => {
    const app = new ApplicationRuntime({
      screens: {
        page: defineScreen({
          name: "Page", initialState: () => ({}), actions: {},
          view: () => jsx(Text, { children: "Page" }) as never,
        }) as never,
      },
      initial: "page",
      theme,
      viewport: { width: 320, height: 480 },
    } as never);
    const commits: string[] = [];
    const wrapper = counted(app, commits);
    const handoff = installHostHandoff({ app: wrapper, commit: (json) => commits.push(json) });

    handoff.dispatch("VIEWPORT", JSON.stringify({ width: 200, height: 300 }));
    expect(commits.length).toBe(2); // the dispatch-end flush, not two commits
  });

  test("BACK with an empty stack commits nothing (host applies its default)", () => {
    const f = twoScreenApp();
    const before = f.commits.length;
    const reply = JSON.parse(f.handoff.dispatch("BACK", "{}")) as { handled: boolean };
    expect(reply.handled).toBe(false);
    expect(f.commits.length).toBe(before);
  });

  test("out-of-band invalidation OUTSIDE a dispatch still commits immediately", async () => {
    const app = new ApplicationRuntime({
      screens: {
        counter: defineScreen({
          name: "Counter", initialState: () => ({ count: 0 }),
          actions: {
            loadAsync: async ({ state }: { state: { count: number } }) => {
              state.count = 5;
            },
          },
          view: ({ state, actions }: { state: { count: number }; actions: { loadAsync(): void } }) =>
            jsx(Column, { children: [jsx(Text, { children: `count ${state.count}` }), jsx(Button, { onPress: () => actions.loadAsync(), children: "Load" })] }) as never,
        }) as never,
      },
      initial: "counter",
      theme,
      viewport: { width: 320, height: 480 },
    } as never);
    const commits: string[] = [];
    const wrapper = counted(app, commits);
    const handoff = installHostHandoff({ app: wrapper, commit: (json) => commits.push(json) });
    const id = firstTapId(commits[0]!);

    handoff.dispatch("TAP", JSON.stringify({ id }));
    expect(commits.length).toBe(2); // sync TAP commit; settlement has not run
    await Promise.resolve(); // drain the settlement microtask
    await Promise.resolve();
    expect(commits.length).toBe(3); // the out-of-band settlement commit
    expect(sceneTexts(commits[2]!)).toContain("count 5");
  });

  test("a direct runtime-API caller (no dispatch) still gets an immediate invalidation commit", () => {
    const f = twoScreenApp();
    const enterId = firstTapId(f.commits[0]!);
    f.handoff.dispatch("TAP", JSON.stringify({ id: enterId }));
    expect(f.commits.length).toBe(2);

    const before = f.commits.length;
    expect(f.app.goBack()).toBe(true); // NOT via the handoff — direct API
    expect(f.commits.length - before).toBe(1); // the subscription commits now
    expect(sceneTexts(f.commits[f.commits.length - 1]!)).toContain("Home screen");
  });

  test("a transition-bearing navigation stamps its single commit (TN-169 preserved)", () => {
    let app!: ApplicationRuntime;
    app = new ApplicationRuntime({
      screens: {
        home: defineScreen({
          name: "Home", initialState: () => ({}),
          actions: {
            go: ({ services }: { services: unknown }) => {
              (services as { navigateAway(): void }).navigateAway();
            },
          },
          view: ({ actions }: { actions: { go(): void } }) =>
            jsx(Button, { onPress: () => actions.go(), children: "Go" }) as never,
        }) as never,
        away: defineScreen({
          name: "Away", initialState: () => ({}), actions: {},
          view: () => jsx(Text, { children: "Away screen" }) as never,
        }) as never,
      },
      initial: "home",
      theme,
      viewport: { width: 320, height: 480 },
      services: {
        navigateAway: () => app.navigate("away", { transition: { kind: "slide" } }),
      },
    } as never);
    const commits: string[] = [];
    const wrapper = counted(app, commits);
    const handoff = installHostHandoff({ app: wrapper, commit: (json) => commits.push(json) });
    const id = firstTapId(commits[0]!);

    handoff.dispatch("TAP", JSON.stringify({ id }));
    expect(commits.length).toBe(2); // one commit for the whole navigation burst
    const scene = JSON.parse(commits[1]!) as { transition?: unknown };
    expect(scene.transition).toEqual({
      kind: "slide", direction: "forward", durationMs: TRANSITION_DEFAULT_DURATION_MS,
    });
    // And the next dispatch ends the burst (a fresh render carries no stamp).
    handoff.dispatch("__TENUN_EXPORT", "{}");
    expect(app.render().scene.transition).toBeUndefined();
  });
});

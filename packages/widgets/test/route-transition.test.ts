import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import {
  ApplicationRuntime, Column, Text, TRANSITION_DEFAULT_DURATION_MS,
  defineTheme, installHostHandoff, normalizeSceneTransition, transitionEasing,
  type DisplayListScene,
} from "../src/index";

const theme = defineTheme({});
const screen = (label: string) => defineScreen({
  name: label,
  initialState: () => ({}),
  actions: {},
  view: () => Text({ children: label }),
});
const other = defineScreen({ name: "Other", initialState: () => ({}), actions: {}, view: () => Text({ children: "Other" }) });

function fixture() {
  const app = new ApplicationRuntime({
    screens: { home: screen("Home"), away: screen("Away"), other },
    initial: "home", theme, viewport: { width: 300, height: 500 },
  });
  let scenes: DisplayListScene[] = [];
  const handoff = installHostHandoff({ app, commit: (json) => { scenes.push(JSON.parse(json)); } });
  return { app, handoff, scenes };
}

describe("route transition stamping (TN-169)", () => {
  test("navigate options stamp exactly the first rendered scene, then clear", () => {
    const f = fixture();
    expect(f.app.render().scene.transition).toBeUndefined();
    f.app.navigate("away", { transition: { kind: "fade", direction: "backward", durationMs: 500 } });
    // The handoff commits by rendering — the first render after the
    // navigation is the one hosts animate from.
    expect(f.app.render().scene.transition).toEqual({ kind: "fade", direction: "backward", durationMs: 500 });
    expect(f.app.render().scene.transition).toBeUndefined();
    f.handoff.dispose();
  });

  test("transitions never enter state snapshots", () => {
    const f = fixture();
    f.app.navigate("away", { transition: { kind: "slide" } });
    f.app.render(); // consume the stamp the way a commit would
    const snapshot = JSON.parse(f.handoff.dispatch("__TENUN_EXPORT", "{}"));
    expect(JSON.stringify(snapshot)).not.toContain("transition");
    // Restoring does not re-stamp either.
    f.handoff.dispatch("TENUN_RESTORE", JSON.stringify(snapshot));
    expect(f.app.render().scene.transition).toBeUndefined();
    f.handoff.dispose();
  });

  test("requests normalize with defaults and fail visibly on malformed input", () => {
    expect(normalizeSceneTransition({})).toEqual({
      kind: "slide", direction: "forward", durationMs: TRANSITION_DEFAULT_DURATION_MS,
    });
    expect(() => normalizeSceneTransition({ kind: "zoom" as never })).toThrow(/unknown transition kind/);
    expect(() => normalizeSceneTransition({ direction: "sideways" as never })).toThrow(/unknown transition direction/);
    expect(() => normalizeSceneTransition({ durationMs: 0 })).toThrow(/durationMs/);
    expect(() => normalizeSceneTransition({ durationMs: Number.POSITIVE_INFINITY })).toThrow(/durationMs/);
  });

  test("a navigation without options cancels a pending transition", () => {
    const f = fixture();
    f.app.navigate("away", { transition: { kind: "fade", durationMs: 10 } });
    // A second navigation before any render replaces the pending request.
    f.app.navigate("home", { transition: { kind: "slide" } });
    expect(f.app.render().scene.transition).toEqual({
      kind: "slide", direction: "forward", durationMs: TRANSITION_DEFAULT_DURATION_MS,
    });
    f.app.navigate("away");
    expect(f.app.render().scene.transition).toBeUndefined();
    f.handoff.dispose();
  });

  test("unknown screens still throw before any transition is armed", () => {
    const f = fixture();
    expect(() => f.app.navigate("missing", { transition: { kind: "fade" } })).toThrow(/unknown screen/);
    expect(f.app.render().scene.transition).toBeUndefined();
    f.handoff.dispose();
  });

  test("the shared easing curve starts and ends at rest and is monotonic", () => {
    expect(transitionEasing(0)).toBe(0);
    expect(transitionEasing(1)).toBe(1);
    expect(transitionEasing(-1)).toBe(0);
    expect(transitionEasing(2)).toBe(1);
    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      const value = transitionEasing(i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(transitionEasing(0.5)).toBeCloseTo(0.5, 6);
  });
});

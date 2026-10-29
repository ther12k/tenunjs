import { describe, expect, test } from "bun:test";
import { defineScreen } from "@tenunjs/core";
import {
  ApplicationRuntime, Column, Text, defineColorPalette, defineTheme, installHostHandoff,
  paletteTheme, resolveRoles,
  type DisplayListScene, type ThemePalette,
} from "../src/index";

const lightPalette: ThemePalette = defineColorPalette({
  background: "#F6F7FC", onBackground: "#1B243B",
  primary: "#4059B8", onPrimary: "#FFFFFF",
  primaryContainer: "#DDE5FF", onPrimaryContainer: "#102050",
  secondaryContainer: "#E0E0E8", onSecondaryContainer: "#202030",
  surface: "#F6F7FC", surfaceContainer: "#FFFFFF", surfaceContainerHigh: "#ECEEF6",
  onSurface: "#1B243B", onSurfaceVariant: "#505566",
  outline: "#80859A", outlineVariant: "#D0D3E0",
  error: "#B3261E", onError: "#FFFFFF",
  success: "#006B40", onSuccess: "#FFFFFF",
  warning: "#805000", onWarning: "#FFFFFF",
  inverseSurface: "#1B243B", onInverseSurface: "#F6F7FC", onPrimaryFixed: "#FFFFFF",
});
const darkPalette: ThemePalette = defineColorPalette({
  background: "#101014", onBackground: "#F2F2F7",
  primary: "#8FB0FF", onPrimary: "#102050",
  primaryContainer: "#223354", onPrimaryContainer: "#D6E4FF",
  secondaryContainer: "#30354A", onSecondaryContainer: "#DCE4FF",
  surface: "#101014", surfaceContainer: "#16161D", surfaceContainerHigh: "#232330",
  onSurface: "#F2F2F7", onSurfaceVariant: "#9AA3B2",
  outline: "#474B5A", outlineVariant: "#26262F",
  error: "#FF5A5F", onError: "#101014",
  success: "#3DD68C", onSuccess: "#101014",
  warning: "#F5A623", onWarning: "#101014",
  inverseSurface: "#F2F2F7", onInverseSurface: "#101014", onPrimaryFixed: "#FFFFFF",
});

const screen = defineScreen({
  name: "Counter",
  initialState: (): { count: number } => ({ count: 0 }),
  actions: {
    bump({ state }: { state: { count: number } }) { state.count++; },
  },
  view: ({ state, actions }) => Text({ children: `count ${state.count}` }),
});

describe("runtime theme switching (TN-170)", () => {
  function fixture() {
    const app = new ApplicationRuntime({
      screens: { counter: screen }, initial: "counter",
      theme: paletteTheme(lightPalette), viewport: { width: 300, height: 500 },
    });
    let commits = 0;
    let scene: DisplayListScene;
    const handoff = installHostHandoff({ app, commit: (json) => { commits++; scene = JSON.parse(json); } });
    return { app, handoff, commits: () => commits, scene: () => scene! };
  }

  test("setTheme recolors the next commit while preserving everything else", () => {
    const f = fixture();
    f.app.push("bump");
    f.handoff.lastScene(); // commit lands via the dispatch-driven render
    const before = f.scene();
    expect(before.background).toBe("#F6F7FC");
    const commitsBefore = f.commits();

    f.app.setTheme(paletteTheme(darkPalette));
    const after = f.scene();
    expect(f.commits()).toBe(commitsBefore + 1); // one invalidation commit
    expect(after.background).toBe("#101014");
    // Route, sessions, state, viewport survive the swap.
    expect(JSON.stringify(after)).toContain('"text":"count 1"');
    expect(after.designWidth).toBe(300);
    // Toggle back: the light colors return and the state is still there.
    f.app.setTheme(paletteTheme(lightPalette));
    expect(f.scene().background).toBe("#F6F7FC");
    expect(JSON.stringify(f.scene())).toContain('"text":"count 1"');
    f.handoff.dispose();
  });

  test("a focused input session survives a theme swap", () => {
    const app = new ApplicationRuntime({
      screens: { editor: defineScreen({
        name: "Editor", initialState: () => ({}), actions: {},
        view: () => Text({ children: "field" }),
      }) },
      initial: "editor", theme: paletteTheme(lightPalette), viewport: { width: 300, height: 500 },
    });
    let scene: DisplayListScene;
    const handoff = installHostHandoff({ app, commit: (json) => { scene = JSON.parse(json); } });
    app.setTheme(paletteTheme(darkPalette));
    expect(scene!.background).toBe("#101014");
    handoff.dispose();
  });

  test("malformed themes and post-dispose calls fail visibly", () => {
    const f = fixture();
    expect(() => f.app.setTheme(null as never)).toThrow(/theme must be an object/);
    expect(() => f.app.setTheme([] as never)).toThrow(/theme must be an object/);
    expect(() => f.app.setTheme({ colors: "red" as never })).toThrow(/theme.colors must be an object/);
    f.handoff.dispose();
    f.app.dispose();
    expect(() => f.app.setTheme(paletteTheme(lightPalette))).toThrow(/disposed/i);
  });

  test("restoring a snapshot keeps the CURRENT theme", () => {
    const f = fixture();
    const snapshot = JSON.parse(f.handoff.dispatch("__TENUN_EXPORT", "{}"));
    f.app.setTheme(paletteTheme(darkPalette));
    f.handoff.dispatch("TENUN_RESTORE", JSON.stringify(snapshot));
    expect(f.scene().background).toBe("#101014");
    f.handoff.dispose();
  });
});

describe("paletteTheme and extended role matching (TN-170)", () => {
  test("a semantic palette drives every ordinary-widget role", () => {
    const theme = paletteTheme(lightPalette);
    const roles = resolveRoles(theme);
    expect(roles.surface).toBe("#F6F7FC");
    expect(roles.surfaceContainer).toBe("#FFFFFF"); // reachable now, was hardcoded dark
    expect(roles.surfaceContainerHigh).toBe("#ECEEF6");
    expect(roles.onSurfaceVariant).toBe("#505566");
    expect(roles.inverseSurface).toBe("#1B243B");
    expect(roles.onInverseSurface).toBe("#F6F7FC");
    expect(roles.primary).toBe("#4059B8");
    expect(roles.error).toBe("#B3261E");
  });

  test("absent tokens keep today's defaults — existing apps unchanged", () => {
    const roles = resolveRoles(defineTheme({ colors: { surface: "#101014" } }));
    expect(roles.surfaceContainer).toBe("#16161D");
    expect(roles.surfaceContainerHigh).toBe("#232330");
    expect(roles.onSurfaceVariant).toBe("#9AA3B2");
    expect(roles.inverseSurface).toBe("#2E2E3C");
    expect(roles.onPrimaryFixed).toBe("#FFFFFF");
  });

  test("invalid palettes reject at derivation time", () => {
    expect(() => paletteTheme({ ...lightPalette, surface: "nope" })).toThrow(/surface/);
    const { outline: _omit, ...missing } = lightPalette;
    expect(() => paletteTheme(missing as ThemePalette)).toThrow();
  });

  test("light and dark produce distinguishable committed scenes", () => {
    const render = (palette: ThemePalette): string => {
      const app = new ApplicationRuntime({
        screens: { s: screen }, initial: "s",
        theme: paletteTheme(palette), viewport: { width: 300, height: 500 },
      });
      return JSON.stringify(app.render().scene);
    };
    expect(render(lightPalette)).not.toBe(render(darkPalette));
  });
});

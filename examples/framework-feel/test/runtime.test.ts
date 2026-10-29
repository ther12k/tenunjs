import { describe, expect, test } from "bun:test";
import { installHostHandoff, type DisplayListScene, type RectOp, type SerializedTap } from "@tenunjs/widgets";
import { createFrameworkFeelRuntime } from "../src/runtime";

type TextInputOp = Extract<DisplayListScene["ops"][number], { op: "text-input" }>;

function titleField(scene: DisplayListScene): TextInputOp {
  const field = scene.ops.find((op): op is TextInputOp => op.op === "text-input" && op.id === "plan-title");
  if (!field) throw new Error("Missing plan-title editor");
  return field;
}

function tapForTitle(scene: DisplayListScene): SerializedTap {
  const field = titleField(scene);
  const x = field.x + field.w / 2;
  const y = field.y + field.h / 2;
  const tap = [...scene.taps].reverse().find((region) => region.action === "tap" &&
    x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h);
  if (!tap) throw new Error("Missing tap for the plan-title editor");
  return tap;
}

function tapForText(scene: DisplayListScene, text: string): SerializedTap {
  const label = scene.ops.find((op) => op.op === "text" && op.text === text);
  if (!label || label.op !== "text") throw new Error(`Missing label: ${text}`);
  const tap = scene.taps.find((region) => label.x >= region.x && label.x <= region.x + region.w &&
    label.y >= region.y && label.y <= region.y + region.h);
  if (!tap) throw new Error(`Missing tap for: ${text}`);
  return tap;
}

function cardForText(scene: DisplayListScene, text: string): RectOp {
  const label = scene.ops.find((op) => op.op === "text" && op.text === text);
  if (!label || label.op !== "text") throw new Error(`Missing label: ${text}`);
  const cards = scene.ops.filter((op): op is RectOp => op.op === "rect" &&
    label.x >= op.x && label.x <= op.x + op.w && label.y >= op.y && label.y <= op.y + op.h);
  cards.sort((left, right) => left.w * left.h - right.w * right.h);
  if (!cards[0]) throw new Error(`Missing card for: ${text}`);
  return cards[0];
}

describe("Day Plan bounded runtime foundation", () => {
  test("nested flex layout responds to explicit viewport changes and preserves controller state", () => {
    const app = createFrameworkFeelRuntime();
    const initial = app.render().scene;
    app.dispatch("TAP", tapForText(initial, "Complete task").payload);
    const sizes = [{ width: 720, height: 1000 }, { width: 480, height: 840 }, { width: 1000, height: 720 }];

    for (const viewport of sizes) {
      app.setViewport(viewport);
      const scene = app.render().scene;
      expect(scene.designWidth).toBe(viewport.width);
      expect(scene.contentHeight).toBe(viewport.height);
      expect(JSON.stringify(scene)).toContain('"text":"1 / 3"');
      const complete = tapForText(scene, "Complete task");
      const progress = tapForText(scene, "View progress");
      expect(complete.y + complete.h).toBeCloseTo(viewport.height - 24);
      expect(progress.y + progress.h).toBeCloseTo(viewport.height - 24);
      expect(complete.x).toBe(24);
      expect(progress.x + progress.w).toBeCloseTo(viewport.width - 24);
      expect(progress.x - complete.x - complete.w).toBeCloseTo(16);

      const completed = cardForText(scene, "Completed");
      expect(completed.x).toBe(24);
      expect(completed.w).toBeCloseTo(viewport.width - 48);
      const editor = titleField(scene);
      expect(editor.x).toBe(completed.x + 16);
      expect(editor.w).toBeCloseTo(completed.w - 32);
      const body = cardForText(scene, "Today's checklist");
      expect(body.y).toBeGreaterThan(completed.y + completed.h);
      expect(body.y + body.h).toBeCloseTo(complete.y - 16);
    }
    app.dispose();
  });

  test("ordinary button actions navigate, update custom drawing, and retain both screen sessions", () => {
    const app = createFrameworkFeelRuntime();
    const handoff = installHostHandoff({ app });
    const scene = (): DisplayListScene => JSON.parse(handoff.lastScene()!);
    const press = (label: string): void => {
      handoff.dispatch("tap", JSON.stringify(tapForText(scene(), label).payload));
    };

    press("Complete task");
    press("View progress");
    expect(app.route()).toBe("progress");
    expect(scene().ops.find((op) => op.op === "ring")).toMatchObject({ progress: 1 / 3 });
    expect(JSON.stringify(scene())).toContain('"text":"1 of 3 complete"');
    press("Show details");
    press("Back to today");
    expect(app.route()).toBe("today");
    press("Complete task");
    press("View progress");
    expect(scene().ops.find((op) => op.op === "ring")).toMatchObject({ progress: 2 / 3 });
    expect(JSON.stringify(scene())).toContain('"text":"Hide details"');
    expect(app.exportState().states).toEqual({
      today: { completed: 2, planTitle: "Release day" },
      progress: { completed: 2, planTitle: "Release day", detailsVisible: true },
    });

    handoff.dispose();
    app.dispose();
  });

  test("an explicit viewport update commits a complete resized screen through the same handoff", () => {
    const app = createFrameworkFeelRuntime();
    const commits: DisplayListScene[] = [];
    const handoff = installHostHandoff({ app, commit: (json) => commits.push(JSON.parse(json)) });
    app.setViewport({ width: 480, height: 840 });
    expect(commits).toHaveLength(2);
    expect(commits[1]).toMatchObject({ tenun: "display-list", version: 1, designWidth: 480, contentHeight: 840 });
    expect(tapForText(commits[1]!, "View progress").y).toBeLessThan(840);
    handoff.dispose();
    app.dispose();
  });
});

describe("Day Plan widget editing", () => {
  test("older snapshots default the missing title until an ordinary edit supplies it", () => {
    const app = createFrameworkFeelRuntime();
    const handoff = installHostHandoff({ app });
    const scene = (): DisplayListScene => JSON.parse(handoff.lastScene()!);
    const press = (label: string): void => {
      handoff.dispatch("TAP", JSON.stringify(tapForText(scene(), label).payload));
    };

    handoff.dispatch("TENUN_RESTORE", JSON.stringify({
      stateSchema: 1,
      route: "progress",
      states: { today: { completed: 1 }, progress: { completed: 1, detailsVisible: true } },
    }));
    expect(scene().ops.some((op) => op.op === "text" && op.text === "Release day")).toBe(true);
    expect(app.exportState().states.progress).toEqual({ completed: 1, detailsVisible: true });
    press("Back to today");
    expect(titleField(scene()).text).toBe("Release day");
    expect(app.exportState().states.today).toEqual({ completed: 1 });
    press("View progress");
    expect(app.exportState().states.progress).toEqual({ completed: 1, planTitle: "Release day", detailsVisible: true });
    press("Back to today");

    handoff.dispatch("TAP", JSON.stringify(tapForTitle(scene()).payload));
    const field = titleField(scene());
    const title = "Ship 🎉";
    handoff.dispatch("TEXT_EDIT", JSON.stringify({
      id: field.id,
      sessionId: field.sessionId,
      baseRevision: field.revision,
      text: title,
      selection: { base: title.length, extent: title.length },
      composing: null,
    }));
    expect(app.exportState().states.today).toEqual({ completed: 1, planTitle: title });
    press("View progress");
    expect(app.exportState().states.progress).toEqual({ completed: 1, planTitle: title, detailsVisible: true });
    press("Back to today");
    expect(titleField(scene()).text).toBe(title);

    handoff.dispose();
    app.dispose();
  });

  test("composed Unicode title edits survive viewport changes and the two-screen journey", () => {
    const app = createFrameworkFeelRuntime();
    const handoff = installHostHandoff({ app });
    const scene = (): DisplayListScene => JSON.parse(handoff.lastScene()!);
    const press = (label: string): void => {
      handoff.dispatch("TAP", JSON.stringify(tapForText(scene(), label).payload));
    };

    expect(titleField(scene())).toMatchObject({ text: "Release day", focused: false });
    handoff.dispatch("TAP", JSON.stringify(tapForTitle(scene()).payload));
    expect(titleField(scene()).focused).toBe(true);
    expect(titleField(scene()).sessionId).toBeGreaterThan(0);

    const edit = (text: string, composing: { start: number; end: number } | null): void => {
      const field = titleField(scene());
      handoff.dispatch("TEXT_EDIT", JSON.stringify({
        id: field.id,
        sessionId: field.sessionId,
        baseRevision: field.revision,
        text,
        selection: { base: text.length, extent: text.length },
        composing,
      }));
      expect(titleField(scene()).text).toBe(text);
      expect(app.exportState().states.today).toMatchObject({ planTitle: text });
    };

    edit("か", { start: 0, end: 1 });
    edit("かな", { start: 0, end: 2 });
    const title = "かな 🎉 Cafe\u0301";
    edit(title, null);

    handoff.dispatch("VIEWPORT", JSON.stringify({ width: 360, height: 640 }));
    expect(scene()).toMatchObject({ designWidth: 360, contentHeight: 640 });
    expect(titleField(scene())).toMatchObject({ text: title, x: 40, w: 280 });
    const fieldBeforeNavigation = titleField(scene());
    const staleEdit = JSON.stringify({
      id: fieldBeforeNavigation.id,
      sessionId: fieldBeforeNavigation.sessionId,
      baseRevision: fieldBeforeNavigation.revision,
      text: "A late callback",
      selection: { base: 15, extent: 15 },
      composing: null,
    });

    press("Complete task");
    press("View progress");
    expect(app.route()).toBe("progress");
    expect(scene().ops.some((op) => op.op === "text" && op.text === title)).toBe(true);
    expect(scene().ops.some((op) => op.op === "text-input")).toBe(false);
    expect(app.exportState().states.progress).toMatchObject({ completed: 1, planTitle: title });

    const lastGood = handoff.lastScene();
    expect(() => handoff.dispatch("TEXT_EDIT", staleEdit)).toThrow();
    expect(handoff.lastScene()).toBe(lastGood);
    press("Show details");
    press("Back to today");
    expect(titleField(scene())).toMatchObject({ text: title, focused: false });
    expect(app.exportState().states).toEqual({
      today: { completed: 1, planTitle: title },
      progress: { completed: 1, planTitle: title, detailsVisible: true },
    });

    // Empty is an intentional edit, not the missing-field compatibility case.
    handoff.dispatch("TAP", JSON.stringify(tapForTitle(scene()).payload));
    edit("", null);

    handoff.dispose();
    app.dispose();
  });
});

describe("Day Plan host viewport delivery (TN-158)", () => {
  // Topmost-wins tap lookup (the host rule): later-registered regions such
  // as buttons paint over container regions that also contain the label.
  function topmostTapForText(scene: DisplayListScene, text: string): SerializedTap {
    const label = scene.ops.find((op) => op.op === "text" && op.text === text);
    if (!label || label.op !== "text") throw new Error(`Missing label: ${text}`);
    const hit = [...scene.taps].reverse().find((region) =>
      typeof region.payload?.id === "number" &&
      label.x >= region.x && label.x <= region.x + region.w &&
      label.y >= region.y && label.y <= region.y + region.h);
    if (!hit) throw new Error(`Missing live tap for: ${text}`);
    return hit;
  }

  test("a VIEWPORT dispatch through the host handoff re-lays out, keeps state, and rebuilds live taps", () => {
    const app = createFrameworkFeelRuntime();
    const commits: string[] = [];
    const handoff = installHostHandoff({ app, commit: (json) => commits.push(json) });
    expect(commits).toHaveLength(1);

    // Mid-journey resize: the host adopts the app after the user already acted.
    const initial = JSON.parse(commits[0]!) as DisplayListScene;
    handoff.dispatch("TAP", JSON.stringify(tapForText(initial, "Complete task").payload));
    expect(JSON.parse(commits[1]!)).toMatchObject({});

    const result = handoff.dispatch("VIEWPORT", JSON.stringify({ width: 360, height: 640 }));
    expect(JSON.parse(result)).toEqual({ route: "today" });
    const resized = JSON.parse(commits.at(-1)!) as DisplayListScene;
    expect(resized.designWidth).toBe(360);
    expect(resized.contentHeight).toBe(640);
    expect(JSON.stringify(resized)).toContain('"text":"1 / 3"');

    // Taps survive the resize against the NEW geometry and keep working.
    handoff.dispatch("TAP", JSON.stringify(topmostTapForText(resized, "View progress").payload));
    const progressScene = JSON.parse(commits.at(-1)!) as DisplayListScene;
    expect(JSON.stringify(progressScene)).toContain("Progress");

    // A second host resize mid-journey re-lays out again without losing the route.
    handoff.dispatch("VIEWPORT", JSON.stringify({ width: 800, height: 600 }));
    const wide = JSON.parse(commits.at(-1)!) as DisplayListScene;
    expect(wide.designWidth).toBe(800);
    expect(JSON.parse(handoff.dispatch("__TENUN_EXPORT", "{}")).route).toBe("progress");
    app.dispose();
  });

  test("state export carries no viewport — surface geometry is host-owned", () => {
    const app = createFrameworkFeelRuntime();
    const handoff = installHostHandoff({ app, commit: () => undefined });
    handoff.dispatch("VIEWPORT", JSON.stringify({ width: 250, height: 400 }));
    const snapshot = JSON.parse(handoff.dispatch("__TENUN_EXPORT", "{}"));
    expect(snapshot.states).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain('"viewport"');
    app.dispose();
  });
});

describe("Day Plan independent scrolling (TN-161)", () => {
  test("the checklist is a bounded scroll region; footer stays pinned in viewport space", () => {
    const app = createFrameworkFeelRuntime();
    const scene = app.render().scene;
    const region = scene.ops.find((op) => op.op === "scroll-region");
    expect(region).toBeDefined();
    expect(region!.id).toBe("today-checklist");
    expect(region!.h).toBeLessThan(1000); // bounded share, not the whole scene
    expect(region!.ops.length).toBeGreaterThan(0); // checklist content nested
    // Footer buttons remain top-level, untagged, pinned at the bottom.
    const footer = scene.taps.filter((t) => !t.scroll);
    expect(footer.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...footer.map((t) => t.y + t.h))).toBeCloseTo(1000 - 24);
    // Viewport changes re-bound the region; state survives.
    app.setViewport({ width: 480, height: 840 });
    const resized = app.render().scene.ops.find((op) => op.op === "scroll-region")!;
    expect(resized.h).toBeLessThan(region!.h);
    expect(JSON.stringify(resized)).toContain("Review layout"); // task content nested
    app.dispose();
  });
});

describe("Day Plan runtime theme switching (TN-170)", () => {
  test("toggling the theme recolors the committed scene and retains journey state", () => {
    const app = createFrameworkFeelRuntime();
    const initial = app.render().scene;
    expect(initial.background).toBe("#F6F7FC"); // light palette surface

    // Journey: complete a task, open Progress, come back.
    app.dispatch("TAP", tapForText(initial, "Complete task").payload);
    app.dispatch("TAP", tapForText(app.render().scene, "View progress").payload);
    expect(JSON.stringify(app.render().scene)).toContain('"text":"Progress"');

    // Toggle on Today: colors swap through the invalidation channel.
    app.dispatch("TAP", tapForText(app.render().scene, "Back to today").payload);
    const beforeToggle = app.render().scene;
    app.dispatch("TAP", tapForText(beforeToggle, "Toggle theme").payload);
    const dark = app.render().scene;
    expect(dark.background).toBe("#101014");
    // The retained session state survived the swap.
    expect(JSON.stringify(dark)).toContain('"text":"1 / 3"');

    // And back to light.
    app.dispatch("TAP", tapForText(dark, "Toggle theme").payload);
    expect(app.render().scene.background).toBe("#F6F7FC");
    expect(JSON.stringify(app.render().scene)).toContain('"text":"1 / 3"');
  });
});

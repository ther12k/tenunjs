import { describe, expect, test } from "bun:test";
import { installHostHandoff, type DisplayListScene, type RectOp, type SerializedTap } from "@tenunjs/widgets";
import { createFrameworkFeelRuntime } from "../src/runtime";

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

      const plan = cardForText(scene, "Plan");
      const completed = cardForText(scene, "Completed");
      expect(plan.w).toBeCloseTo((viewport.width - 48 - 16) / 2);
      expect(completed.w).toBeCloseTo(plan.w);
      expect(completed.y).toBeCloseTo(plan.y);
      expect(completed.h).toBeCloseTo(plan.h);
      const body = cardForText(scene, "Today's checklist");
      expect(body.y).toBeGreaterThan(plan.y + plan.h);
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
      today: { completed: 2 },
      progress: { completed: 2, detailsVisible: true },
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

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

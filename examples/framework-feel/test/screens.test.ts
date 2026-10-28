import { describe, expect, test } from "bun:test";
import { mountScreen } from "@tenunjs-examples/test-support";
import { PLAN_TASKS } from "../src/plan";
import { ProgressScreen } from "../src/screens/progress.screen";
import { TodayScreen } from "../src/screens/today.screen";

describe("Day Plan named actions", () => {
  test("completes only the known tasks and passes current progress to navigation", async () => {
    const navigation: unknown[][] = [];
    const screen = mountScreen(TodayScreen, { services: { navigate: (...args: unknown[]) => navigation.push(args) } });
    expect(screen.state.completed).toBe(0);
    await screen.press("completeTask");
    await screen.press("viewProgress");
    expect(navigation).toEqual([["progress", 1]]);
    for (let index = 0; index < 5; index++) await screen.press("completeTask");
    expect(screen.state.completed).toBe(PLAN_TASKS.length);
    expect(screen.render()).not.toBeNull();
  });

  test("progress data updates without resetting the screen's own disclosure state", async () => {
    const navigation: unknown[][] = [];
    const screen = mountScreen(ProgressScreen, { services: { navigate: (...args: unknown[]) => navigation.push(args) } });
    await screen.press("toggleDetails");
    await screen.press("receiveProgress", 2);
    expect(screen.state).toEqual({ completed: 2, detailsVisible: true });
    await screen.press("backToToday");
    expect(navigation).toEqual([["today", undefined]]);
    expect(screen.render()).not.toBeNull();
  });

  test("invalid progress and missing navigation services fail without corrupting state", async () => {
    const screen = mountScreen(ProgressScreen);
    for (const value of [-1, 4, 1.5, "2", null]) {
      await expect(screen.press("receiveProgress", value)).rejects.toThrow("completion");
      expect(screen.state.completed).toBe(0);
    }
    await expect(screen.press("backToToday")).rejects.toThrow("navigation service");
  });
});
